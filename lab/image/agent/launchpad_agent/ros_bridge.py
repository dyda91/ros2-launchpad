import json
import math
import threading
from collections import deque

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.serialization import deserialize_message
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String

from launchpad_agent.cdr import parse_odometry, parse_stamp


def yaw_from_quaternion(quaternion):
    return math.atan2(
        2.0 * (quaternion.w * quaternion.z + quaternion.x * quaternion.y),
        1.0 - 2.0 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z),
    )


class RosBridge:
    def __init__(self):
        self._lock = threading.Lock()
        self._latest = None
        self._mission = None
        self._scan = None
        self._poses = deque(maxlen=400)
        self._ready = threading.Event()
        self._closed = False
        self._node = None
        self._thread = None
        rclpy.init(args=None)
        self._node = Node(
            "launchpad_session_agent",
            start_parameter_services=False,
            enable_rosout=False,
        )
        self._raw_mission = None
        self._raw_scan = None
        self._scan_cache = None
        self._node.create_subscription(
            Odometry, "/odom", self._on_odom, 10, raw=True
        )
        self._node.create_subscription(
            String,
            "/launchpad/mission_status",
            self._on_mission,
            10,
            raw=True,
        )
        self._node.create_subscription(
            LaserScan, "/scan", self._on_scan, 10, raw=True
        )
        self._thread = threading.Thread(
            target=self._spin,
            name="launchpad-ros-bridge",
            daemon=True,
        )
        self._thread.start()

    def _spin(self):
        try:
            rclpy.spin(self._node)
        except Exception:
            pass

    def _on_odom(self, data):
        try:
            parsed = parse_odometry(bytes(data))
        except Exception:
            return
        if parsed is None:
            return
        values = [parsed[key] for key in ("x", "y", "qx", "qy", "qz", "qw", "vx", "wz")]
        if not all(math.isfinite(value) for value in values):
            return
        payload = {
            "x": parsed["x"],
            "y": parsed["y"],
            "yaw": math.atan2(
                2.0 * (parsed["qw"] * parsed["qz"] + parsed["qx"] * parsed["qy"]),
                1.0
                - 2.0 * (parsed["qy"] * parsed["qy"] + parsed["qz"] * parsed["qz"]),
            ),
            "vx": parsed["vx"],
            "wz": parsed["wz"],
            "stamp": parsed["stamp"],
        }
        with self._lock:
            self._latest = payload
            self._poses.append(payload)
        self._ready.set()

    def _on_mission(self, data):
        with self._lock:
            self._raw_mission = bytes(data)

    def ready(self):
        return self._ready.is_set()

    def latest(self):
        with self._lock:
            return dict(self._latest) if self._latest is not None else None

    def latest_mission(self):
        with self._lock:
            raw = self._raw_mission
            cached = self._mission
        if raw is None:
            return None
        if cached is not None and cached[0] is raw:
            return dict(cached[1])
        try:
            payload = json.loads(deserialize_message(raw, String).data)
        except (TypeError, ValueError):
            return None
        if not isinstance(payload, dict):
            return None
        with self._lock:
            self._mission = (raw, payload)
        return dict(payload)

    def _nearest_pose(self, stamp):
        if not self._poses:
            return None
        nearest = min(
            self._poses,
            key=lambda item: abs(item["stamp"] - stamp),
        )
        return {
            "x": nearest["x"],
            "y": nearest["y"],
            "yaw": nearest["yaw"],
            "stamp": nearest["stamp"],
        }

    def _on_scan(self, data):
        raw = bytes(data)
        try:
            stamp = parse_stamp(raw)
        except Exception:
            return
        with self._lock:
            self._raw_scan = (raw, stamp, self._nearest_pose(stamp))

    def latest_scan(self):
        with self._lock:
            entry = self._raw_scan
            cached = self._scan_cache
        if entry is None:
            return None
        if cached is not None and cached[0] is entry:
            return dict(cached[1])
        raw, stamp, pose = entry
        message = deserialize_message(raw, LaserScan)
        payload = {
            "frame_id": message.header.frame_id,
            "angle_min": message.angle_min,
            "angle_increment": message.angle_increment,
            "range_min": message.range_min,
            "range_max": message.range_max,
            "ranges": [
                round(value, 4) if math.isfinite(value) else None
                for value in message.ranges
            ],
            "stamp": stamp,
            "pose": pose,
        }
        with self._lock:
            self._scan_cache = (entry, payload)
        return dict(payload)

    def close(self):
        if self._closed:
            return
        self._closed = True
        if rclpy.ok():
            rclpy.shutdown()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        if self._node is not None:
            self._node.destroy_node()
