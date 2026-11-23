import os
from pathlib import Path
import re
import unittest

ROOT = Path(os.environ.get("LAUNCHPAD_ROOT", Path(__file__).resolve().parents[2]))
URDF = ROOT / "lab/ros_ws/src/launchpad_sim/urdf/robot.urdf.xacro"
ROBOT_TS = ROOT / "apps/web/src/robot.ts"


def ts_constants():
    text = ROBOT_TS.read_text(encoding="utf-8")
    return {
        name: float(value)
        for name, value in re.findall(r"(\w+):\s*(-?\d+(?:\.\d+)?)", text)
    }


def xacro_properties():
    text = URDF.read_text(encoding="utf-8")
    return {
        name: float(value)
        for name, value in re.findall(
            r'<xacro:property name="(\w+)" value="(-?\d+(?:\.\d+)?)"', text
        )
    }


class RobotConstantsTest(unittest.TestCase):
    def test_viewer_matches_urdf(self):
        ts = ts_constants()
        urdf = xacro_properties()
        pairs = {
            "chassisLength": "chassis_length",
            "chassisWidth": "chassis_width",
            "wheelRadius": "wheel_radius",
            "wheelWidth": "wheel_width",
            "wheelSeparation": "wheel_separation",
            "casterRadius": "caster_radius",
        }
        for ts_name, urdf_name in pairs.items():
            self.assertAlmostEqual(ts[ts_name], urdf[urdf_name], places=6, msg=ts_name)

    def test_lidar_and_casters_match_urdf(self):
        ts = ts_constants()
        text = URDF.read_text(encoding="utf-8")
        radius = re.search(
            r'<link name="lidar_link">.*?<cylinder radius="(\d+(?:\.\d+)?)"',
            text,
            re.S,
        )
        self.assertIsNotNone(radius)
        self.assertAlmostEqual(ts["lidarRadius"], float(radius.group(1)), places=6)
        front = re.search(
            r'<joint name="front_caster_joint".*?<origin xyz="(-?[\d.]+) ', text, re.S
        )
        rear = re.search(
            r'<joint name="caster_joint".*?<origin xyz="(-?[\d.]+) ', text, re.S
        )
        self.assertAlmostEqual(ts["casterOffsetX"], float(front.group(1)), places=6)
        self.assertAlmostEqual(ts["casterOffsetX"], -float(rear.group(1)), places=6)


if __name__ == "__main__":
    unittest.main()
