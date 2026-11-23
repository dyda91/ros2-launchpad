#!/usr/bin/env python3

import argparse
import json
import math
import time

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import LaserScan


def yaw_from_quaternion(q):
    return math.atan2(
        2.0 * (q.w * q.z + q.x * q.y),
        1.0 - 2.0 * (q.y * q.y + q.z * q.z),
    )


def front_reading(scan, sector_deg):
    sector = math.radians(sector_deg)
    best = None
    for index, value in enumerate(scan.ranges):
        angle = scan.angle_min + index * scan.angle_increment
        if abs(math.atan2(math.sin(angle), math.cos(angle))) > sector:
            continue
        if not math.isfinite(value):
            continue
        if value < scan.range_min or value > scan.range_max:
            continue
        if best is None or value < best:
            best = value
    return best


class CourseProbe(Node):
    def __init__(self):
        super().__init__("course_probe")
        self.odom = None
        self.scan = None
        self.create_subscription(Odometry, "/odom", self.on_odom, 10)
        self.create_subscription(
            LaserScan, "/scan", self.on_scan, qos_profile_sensor_data
        )

    def on_odom(self, message):
        self.odom = message

    def on_scan(self, message):
        self.scan = message


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sector-deg", type=float, default=10.0)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()
    rclpy.init()
    node = CourseProbe()
    try:
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline and (
            node.odom is None or node.scan is None
        ):
            rclpy.spin_once(node, timeout_sec=0.05)
        if node.odom is None or node.scan is None:
            print(json.dumps({"ok": False}))
            return
        pose = node.odom.pose.pose
        twist = node.odom.twist.twist
        print(
            json.dumps(
                {
                    "ok": True,
                    "x": round(pose.position.x, 4),
                    "y": round(pose.position.y, 4),
                    "yaw_deg": round(
                        math.degrees(yaw_from_quaternion(pose.orientation)), 2
                    ),
                    "vx": round(twist.linear.x, 4),
                    "wz": round(twist.angular.z, 4),
                    "front_m": (
                        None
                        if front_reading(node.scan, args.sector_deg) is None
                        else round(front_reading(node.scan, args.sector_deg), 3)
                    ),
                    "scan_samples": len(node.scan.ranges),
                    "range_max": node.scan.range_max,
                }
            )
        )
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
