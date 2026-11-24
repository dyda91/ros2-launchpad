#!/usr/bin/env python3

import argparse
import json
import math
import sys
import time

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node

SCENARIOS = [
    {"name": "reta_020", "linear": 0.20, "angular": 0.0, "seconds": 3.0, "rest": 3.0},
    {"name": "reta_035", "linear": 0.35, "angular": 0.0, "seconds": 3.0, "rest": 3.0},
    {"name": "giro_080", "linear": 0.0, "angular": 0.8, "seconds": 2.0, "rest": 3.0},
    {"name": "giro_030", "linear": 0.0, "angular": 0.3, "seconds": 3.0, "rest": 3.0},
    {"name": "arco", "linear": 0.2, "angular": 0.4, "seconds": 3.0, "rest": 3.0},
    {"name": "re_015", "linear": -0.15, "angular": 0.0, "seconds": 2.0, "rest": 3.0},
]


def yaw_from_quaternion(q):
    return math.atan2(
        2.0 * (q.w * q.z + q.x * q.y),
        1.0 - 2.0 * (q.y * q.y + q.z * q.z),
    )


class Probe(Node):
    def __init__(self):
        super().__init__("dynamics_probe")
        self.latest = None
        self.samples = []
        self.create_subscription(Odometry, "/odom", self.on_odom, 50)
        self.publisher = self.create_publisher(Twist, "/cmd_vel", 10)

    def on_odom(self, message):
        position = message.pose.pose.position
        twist = message.twist.twist
        self.latest = {
            "x": position.x,
            "y": position.y,
            "yaw": yaw_from_quaternion(message.pose.pose.orientation),
            "vx": twist.linear.x,
            "wz": twist.angular.z,
        }
        self.samples.append((time.monotonic(), self.latest))

    def spin_for(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            rclpy.spin_once(self, timeout_sec=0.01)

    def publish_for(self, linear, angular, seconds, rate=10.0):
        command = Twist()
        command.linear.x = float(linear)
        command.angular.z = float(angular)
        deadline = time.monotonic() + seconds
        period = 1.0 / rate
        next_send = time.monotonic()
        while time.monotonic() < deadline:
            now = time.monotonic()
            if now >= next_send:
                self.publisher.publish(command)
                next_send += period
            rclpy.spin_once(self, timeout_sec=0.005)


def run_scenario(probe, scenario, step):
    probe.spin_for(0.5)
    probe.samples = []
    origin = probe.latest
    start = time.monotonic()
    probe.publish_for(scenario["linear"], scenario["angular"], scenario["seconds"])
    probe.spin_for(scenario["rest"])
    series = []
    last = -1.0
    for stamp, data in probe.samples:
        t = stamp - start
        if t - last < step:
            continue
        last = t
        series.append(
            {
                "t": round(t, 3),
                "dx": round(data["x"] - origin["x"], 5),
                "dy": round(data["y"] - origin["y"], 5),
                "dyaw": round(
                    math.atan2(
                        math.sin(data["yaw"] - origin["yaw"]),
                        math.cos(data["yaw"] - origin["yaw"]),
                    ),
                    5,
                ),
                "vx": round(data["vx"], 5),
                "wz": round(data["wz"], 5),
            }
        )
    return {**scenario, "series": series}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="")
    parser.add_argument("--step", type=float, default=0.05)
    args = parser.parse_args()
    rclpy.init()
    probe = Probe()
    deadline = time.monotonic() + 30.0
    while probe.latest is None and time.monotonic() < deadline:
        rclpy.spin_once(probe, timeout_sec=0.1)
    if probe.latest is None:
        print("sem /odom", file=sys.stderr)
        return 1
    result = [run_scenario(probe, scenario, args.step) for scenario in SCENARIOS]
    payload = json.dumps({"scenarios": result}, separators=(",", ":"))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(payload)
    else:
        print(payload)
    probe.destroy_node()
    rclpy.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
