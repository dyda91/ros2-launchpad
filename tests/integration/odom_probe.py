#!/usr/bin/env python3

import argparse
import json
import math
import time

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node


def yaw_from_quaternion(q):
    return math.atan2(
        2.0 * (q.w * q.z + q.x * q.y),
        1.0 - 2.0 * (q.y * q.y + q.z * q.z),
    )


class OdomProbe(Node):
    def __init__(self):
        super().__init__("odom_probe")
        self.latest = None
        self.create_subscription(Odometry, "/odom", self.on_odom, 10)
        self.publisher = self.create_publisher(Twist, "/cmd_vel", 10)

    def on_odom(self, message):
        self.latest = message

    def wait_for_odom(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            rclpy.spin_once(self, timeout_sec=0.05)
            if self.latest is not None:
                return True
        return False

    def snapshot(self):
        message = self.latest
        position = message.pose.pose.position
        twist = message.twist.twist
        return {
            "x": position.x,
            "y": position.y,
            "yaw": yaw_from_quaternion(message.pose.pose.orientation),
            "vx": twist.linear.x,
            "wz": twist.angular.z,
        }

    def spin_for(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            rclpy.spin_once(self, timeout_sec=0.02)

    def publish_velocity(self, linear, duration):
        command = Twist()
        command.linear.x = float(linear)
        interval = 0.05
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            self.publisher.publish(command)
            rclpy.spin_once(self, timeout_sec=0.01)
            time.sleep(interval)

    def wait_until_stopped(self, timeout, linear_threshold, angular_threshold):
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            rclpy.spin_once(self, timeout_sec=0.02)
            if self.latest is None:
                continue
            twist = self.latest.twist.twist
            if (
                abs(twist.linear.x) <= linear_threshold
                and abs(twist.angular.z) <= angular_threshold
            ):
                return time.monotonic() - start
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["sample", "move"], default="move")
    parser.add_argument("--speed", type=float, default=0.2)
    parser.add_argument("--duration", type=float, default=2.0)
    parser.add_argument("--settle", type=float, default=0.5)
    parser.add_argument("--wait-timeout", type=float, default=30.0)
    parser.add_argument("--stop-timeout", type=float, default=2.0)
    parser.add_argument("--min-displacement", type=float, default=0.15)
    parser.add_argument("--linear-threshold", type=float, default=0.02)
    parser.add_argument("--angular-threshold", type=float, default=0.05)
    args = parser.parse_args()

    rclpy.init(args=[])
    node = OdomProbe()
    try:
        if not node.wait_for_odom(args.wait_timeout):
            print(json.dumps({"ok": False, "error": "no /odom received"}))
            return 1

        node.spin_for(args.settle)
        initial = node.snapshot()

        if args.mode == "sample":
            print(json.dumps({"ok": True, "initial": initial}))
            return 0

        node.publish_velocity(args.speed, args.duration)
        node.spin_for(0.1)
        after_command = node.snapshot()
        stop_latency = node.wait_until_stopped(
            args.stop_timeout,
            args.linear_threshold,
            args.angular_threshold,
        )
        final = node.snapshot()
        displacement = math.hypot(
            final["x"] - initial["x"], final["y"] - initial["y"]
        )
        checks = {
            "odom_received": True,
            "moved": displacement >= args.min_displacement,
            "stopped": (
                abs(final["vx"]) <= args.linear_threshold
                and abs(final["wz"]) <= args.angular_threshold
            ),
            "stop_within_timeout": stop_latency is not None,
        }
        result = {
            "ok": all(checks.values()),
            "checks": checks,
            "initial": initial,
            "after_command": after_command,
            "final": final,
            "displacement_m": displacement,
            "stop_latency_s": stop_latency,
            "command": {"linear_x": args.speed, "duration_s": args.duration},
            "thresholds": {
                "linear": args.linear_threshold,
                "angular": args.angular_threshold,
                "stop_timeout_s": args.stop_timeout,
            },
        }
        print(json.dumps(result, indent=2))
        return 0 if result["ok"] else 1
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
