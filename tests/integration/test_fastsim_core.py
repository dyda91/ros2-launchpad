import math
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ.get("LAUNCHPAD_ROOT", Path(__file__).resolve().parents[2]))
SIM_SRC = ROOT / "lab" / "ros_ws" / "src" / "launchpad_sim"
if not SIM_SRC.is_dir():
    SIM_SRC = Path("/ros_ws/src/launchpad_sim")
sys.path.insert(0, str(SIM_SRC))

from launchpad_sim import fastsim_core as core  # noqa: E402
from launchpad_sim import generate_world as generator  # noqa: E402

WORLD_YAML = ROOT / "content" / "world" / "armazem.yaml"
if not WORLD_YAML.is_file():
    WORLD_YAML = Path("/content/world/armazem.yaml")


def build_world():
    config = generator.load_config(WORLD_YAML)
    return core.FastWorld(generator.map_payload(config))


def drive(robot, linear, angular, seconds, dt=0.02):
    for _ in range(int(round(seconds / dt))):
        robot.step(dt, linear, angular)


class FastSimCoreTest(unittest.TestCase):
    def setUp(self):
        self.world = build_world()

    def test_spawn_is_free(self):
        self.assertFalse(self.world.collides(0.0, 0.0, 0.0))

    def test_scan_shape_matches_gazebo_sensor(self):
        ranges = self.world.scan(0.0, 0.0, 0.0)
        self.assertEqual(len(ranges), 360)
        self.assertAlmostEqual(self.world.angles[0], -math.pi, places=6)
        self.assertAlmostEqual(self.world.angles[-1], math.pi, places=6)
        self.assertAlmostEqual(self.world.angle_increment, 0.017501909, places=7)

    def test_scan_distances_at_spawn(self):
        ranges = self.world.scan(0.0, 0.0, 0.0)
        index = {
            "frente": 180,
            "tras": 0,
            "esquerda": 270,
            "direita": 90,
        }
        self.assertAlmostEqual(ranges[index["frente"]], 3.9, delta=0.03)
        self.assertAlmostEqual(ranges[index["tras"]], 0.6, delta=0.03)
        self.assertAlmostEqual(ranges[index["esquerda"]], 5.4, delta=0.03)
        self.assertAlmostEqual(ranges[index["direita"]], 0.6, delta=0.03)

    def test_scan_follows_yaw(self):
        facing = self.world.scan(0.0, 0.0, math.pi / 2.0)
        self.assertAlmostEqual(facing[180], 5.4, delta=0.03)

    def test_scan_hits_cylinder(self):
        ranges = self.world.scan(4.2, 1.6, math.pi / 2.0)
        self.assertAlmostEqual(ranges[180], 0.75, delta=0.02)

    def test_out_of_range_is_inf(self):
        ranges = self.world.scan(0.0, 2.4, 0.0)
        value = ranges[180]
        self.assertTrue(math.isinf(value) or value <= core.LIDAR_RANGE_MAX)

    def test_straight_drive_distance(self):
        robot = core.FastRobot(self.world)
        drive(robot, 0.2, 0.0, 3.0)
        self.assertAlmostEqual(robot.x, 0.587, delta=0.01)
        self.assertAlmostEqual(robot.y, 0.0, delta=1e-6)

    def test_rotation_in_place(self):
        robot = core.FastRobot(self.world)
        drive(robot, 0.0, 0.8, 2.0)
        self.assertAlmostEqual(robot.yaw, 1.6 - 0.8 * 0.8 / 4.0 / 2.0, delta=0.02)
        self.assertAlmostEqual(robot.x, 0.0, delta=1e-6)

    def test_velocity_limits(self):
        robot = core.FastRobot(self.world)
        drive(robot, 5.0, 9.0, 3.0)
        self.assertLessEqual(robot.linear, core.MAX_LINEAR + 1e-9)
        self.assertLessEqual(robot.angular, core.MAX_ANGULAR + 1e-9)

    def test_stops_at_rack(self):
        robot = core.FastRobot(self.world)
        drive(robot, 0.35, 0.0, 14.0)
        self.assertLess(robot.x, 3.9 - core.ROBOT_HALF_LENGTH + 0.01)
        self.assertGreater(robot.x, 3.4)
        self.assertFalse(self.world.collides(robot.x, robot.y, robot.yaw))

    def test_stops_at_wall(self):
        robot = core.FastRobot(self.world)
        drive(robot, -0.35, 0.0, 6.0)
        self.assertGreaterEqual(robot.x, -0.6 + core.ROBOT_HALF_LENGTH - 0.01)

    def test_stops_at_cylinder(self):
        robot = core.FastRobot(self.world, 4.2, 1.2, math.pi / 2.0)
        drive(robot, 0.3, 0.0, 6.0)
        self.assertLess(robot.y, 2.8 - 0.45 - core.ROBOT_HALF_LENGTH + 0.01)

    def test_slides_along_obstacle(self):
        robot = core.FastRobot(self.world, 3.0, 0.0, 0.0)
        drive(robot, 0.35, 0.0, 6.0)
        blocked_x = robot.x
        robot.yaw = math.pi / 2.0
        drive(robot, 0.2, 0.0, 2.0)
        self.assertGreater(robot.y, 0.3)
        self.assertAlmostEqual(robot.x, blocked_x, delta=0.05)

    def test_zone_is_reachable_without_collision(self):
        robot = core.FastRobot(self.world, 5.8, 3.2, 0.0)
        self.assertFalse(self.world.collides(robot.x, robot.y, robot.yaw))

    def test_blocked_flag(self):
        robot = core.FastRobot(self.world)
        drive(robot, 0.35, 0.0, 14.0)
        self.assertTrue(robot.blocked)

    def test_reset_returns_to_spawn_and_stops(self):
        robot = core.FastRobot(self.world)
        drive(robot, 0.3, 0.0, 2.0)
        self.assertGreater(robot.x, 0.3)
        robot.reset(0.0, 0.0, 0.0)
        self.assertEqual((robot.x, robot.y, robot.yaw), (0.0, 0.0, 0.0))
        self.assertEqual((robot.linear, robot.angular), (0.0, 0.0))

    def test_east_structures_do_not_overlap_each_other(self):
        for item in self.world.boxes:
            self.assertFalse(
                self.world.collides(0.0, 0.0, 0.0), "spawn must stay free"
            )

    def test_wide_floor_has_wall_at_east_end(self):
        robot = core.FastRobot(self.world, 14.0, 2.0, 0.0)
        ranges = self.world.scan(robot.x, robot.y, robot.yaw)
        self.assertLess(float(min(ranges[170:190])), 1.0)


if __name__ == "__main__":
    unittest.main()
