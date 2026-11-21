import json
import math
import threading

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import String


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
        self._ready = threading.Event()
        self._closed = False
        self._node = None
        self._thread = None
        rclpy.init(args=None)
        self._node = Node("launchpad_session_agent")
        self._node.create_subscription(Odometry, "/odom", self._on_odom, 10)
        self._node.create_subscription(
            String,
            "/launchpad/mission_status",
            self._on_mission,
            10,
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

    def _on_odom(self, message):
        position = message.pose.pose.position
        twist = message.twist.twist
        values = [
            position.x,
            position.y,
            message.pose.pose.orientation.x,
            message.pose.pose.orientation.y,
            message.pose.pose.orientation.z,
            message.pose.pose.orientation.w,
            twist.linear.x,
            twist.linear.y,
            twist.angular.z,
        ]
        if not all(math.isfinite(value) for value in values):
            return
        payload = {
            "x": position.x,
            "y": position.y,
            "yaw": yaw_from_quaternion(message.pose.pose.orientation),
            "vx": twist.linear.x,
            "wz": twist.angular.z,
            "stamp": (
                message.header.stamp.sec
                + message.header.stamp.nanosec / 1_000_000_000.0
            ),
        }
        with self._lock:
            self._latest = payload
        self._ready.set()

    def _on_mission(self, message):
        try:
            payload = json.loads(message.data)
        except (TypeError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return
        with self._lock:
            self._mission = payload

    def ready(self):
        return self._ready.is_set()

    def latest(self):
        with self._lock:
            return dict(self._latest) if self._latest is not None else None

    def latest_mission(self):
        with self._lock:
            return dict(self._mission) if self._mission is not None else None

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
