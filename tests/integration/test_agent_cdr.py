import math
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ.get("LAUNCHPAD_ROOT", Path(__file__).resolve().parents[2]))
AGENT = ROOT / "lab" / "image" / "agent"
if not AGENT.is_dir():
    AGENT = Path("/opt/launchpad_agent")
sys.path.insert(0, str(AGENT))

from nav_msgs.msg import Odometry  # noqa: E402
from rclpy.serialization import serialize_message  # noqa: E402
from sensor_msgs.msg import LaserScan  # noqa: E402

from launchpad_agent.cdr import parse_odometry, parse_stamp  # noqa: E402


def odometry(frame, child, x, y, yaw, vx, wz, sec, nanosec):
    message = Odometry()
    message.header.stamp.sec = sec
    message.header.stamp.nanosec = nanosec
    message.header.frame_id = frame
    message.child_frame_id = child
    message.pose.pose.position.x = x
    message.pose.pose.position.y = y
    message.pose.pose.orientation.z = math.sin(yaw / 2.0)
    message.pose.pose.orientation.w = math.cos(yaw / 2.0)
    message.twist.twist.linear.x = vx
    message.twist.twist.angular.z = wz
    return message


class CdrTest(unittest.TestCase):
    def check(self, frame, child):
        message = odometry(frame, child, 1.25, -2.5, 0.7, 0.2, -0.3, 42, 123456789)
        parsed = parse_odometry(serialize_message(message))
        self.assertAlmostEqual(parsed["x"], 1.25)
        self.assertAlmostEqual(parsed["y"], -2.5)
        self.assertAlmostEqual(parsed["qz"], math.sin(0.35))
        self.assertAlmostEqual(parsed["qw"], math.cos(0.35))
        self.assertAlmostEqual(parsed["vx"], 0.2)
        self.assertAlmostEqual(parsed["wz"], -0.3)
        self.assertAlmostEqual(parsed["stamp"], 42.123456789)

    def test_gazebo_frames(self):
        self.check("odom", "base_link")

    def test_other_string_lengths(self):
        for frame, child in (("", ""), ("a", "bb"), ("odom_frame_x", "base"), ("odo", "base_link_1")):
            with self.subTest(frame=frame, child=child):
                self.check(frame, child)

    def test_scan_stamp(self):
        message = LaserScan()
        message.header.stamp.sec = 7
        message.header.stamp.nanosec = 500000000
        message.header.frame_id = "lidar_link"
        message.ranges = [1.0] * 360
        self.assertAlmostEqual(parse_stamp(serialize_message(message)), 7.5)


if __name__ == "__main__":
    unittest.main()
