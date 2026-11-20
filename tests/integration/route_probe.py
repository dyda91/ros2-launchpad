#!/usr/bin/env python3

import argparse
import json
import math
import time

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import String


def wrap_angle(angle):
    return math.atan2(math.sin(angle), math.cos(angle))


def yaw_from_quaternion(q):
    return math.atan2(
        2.0 * (q.w * q.z + q.x * q.y),
        1.0 - 2.0 * (q.y * q.y + q.z * q.z),
    )


def clamp(value, limit):
    return max(-limit, min(limit, value))


class RouteProbe(Node):
    def __init__(self):
        super().__init__("route_probe")
        self.odom = None
        self.mission = None
        self.create_subscription(Odometry, "/odom", self.on_odom, 10)
        self.create_subscription(
            String, "/launchpad/mission_status", self.on_mission, 10
        )
        self.publisher = self.create_publisher(Twist, "/cmd_vel", 10)

    def on_odom(self, message):
        self.odom = message

    def on_mission(self, message):
        try:
            self.mission = json.loads(message.data)
        except json.JSONDecodeError:
            self.mission = None

    def pose(self):
        position = self.odom.pose.pose.position
        return (
            position.x,
            position.y,
            yaw_from_quaternion(self.odom.pose.pose.orientation),
        )

    def spin_once(self):
        rclpy.spin_once(self, timeout_sec=0.02)

    def wait_for_odom(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.spin_once()
            if self.odom is not None:
                return True
        return False

    def drive(self, command_linear, command_angular, duration):
        command = Twist()
        command.linear.x = float(command_linear)
        command.angular.z = float(command_angular)
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            self.publisher.publish(command)
            self.spin_once()
            time.sleep(0.02)

    def stop(self, duration=0.3):
        self.drive(0.0, 0.0, duration)

    def go_to(self, target, timeout=45.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.spin_once()
            x, y, yaw = self.pose()
            dx = target[0] - x
            dy = target[1] - y
            distance = math.hypot(dx, dy)
            if distance <= 0.10:
                self.stop()
                return True
            desired = math.atan2(dy, dx)
            error = wrap_angle(desired - yaw)
            if abs(error) > 0.25:
                angular = clamp(1.4 * error, 0.8)
                linear = 0.0
            else:
                angular = clamp(1.0 * error, 0.5)
                linear = 0.25 * max(0.0, math.cos(error))
                if distance < 0.35:
                    linear = min(linear, 0.12)
            self.drive(linear, angular, 0.05)
        self.stop()
        return False

    def wait_for_delivery(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.stop(0.05)
            if self.mission is not None and self.mission.get("delivered"):
                return True
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--waypoint", action="append", type=float, nargs=2)
    parser.add_argument("--wait-timeout", type=float, default=30.0)
    parser.add_argument("--delivery-timeout", type=float, default=6.0)
    args = parser.parse_args()
    waypoints = args.waypoint or [
        [3.2, 0.0],
        [3.2, 3.6],
        [5.8, 3.6],
    ]

    rclpy.init(args=[])
    node = RouteProbe()
    try:
        if not node.wait_for_odom(args.wait_timeout):
            print(json.dumps({"ok": False, "error": "no /odom received"}))
            return 1
        node.stop(0.5)
        initial = node.pose()
        reached = []
        for waypoint in waypoints:
            reached.append(node.go_to(waypoint))
            if not reached[-1]:
                break
        node.stop(0.5)
        delivered = node.wait_for_delivery(args.delivery_timeout)
        final = node.pose()
        mission = node.mission
        result = {
            "ok": all(reached) and delivered,
            "waypoints": waypoints,
            "reached": reached,
            "initial": {"x": initial[0], "y": initial[1], "yaw": initial[2]},
            "final": {"x": final[0], "y": final[1], "yaw": final[2]},
            "mission": mission,
        }
        print(json.dumps(result, indent=2))
        return 0 if result["ok"] else 1
    finally:
        node.stop(0.2)
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
