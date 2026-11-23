import copy
import math
import os
from pathlib import Path
import re
import sys
import unittest

import yaml

ROOT = Path(os.environ.get("LAUNCHPAD_REPO", Path(__file__).resolve().parents[2]))
sys.path.insert(0, "/app")
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.mission_content import validate_mission

MISSION_FILE = Path(
    os.environ.get("MISSION_FILE", ROOT / "content" / "missions" / "primeiro-turno.yaml")
)
SIM = ROOT / "lab" / "ros_ws" / "src" / "launchpad_sim"
CLEARANCE_M = 0.29

NEAR_MISSES = {
    "terminal-pwd": ["pwdd", "ls", "echo pwd"],
    "terminal-ls-ros": ["ls /opt", "ls /opt/ros/jazzy", "cd /opt/ros", "ls"],
    "nos-list": ["ros2 topic list", "ros2 node", "ros2 node info /odom_merge"],
    "nos-watchdog": ["ros2 node info /mission_monitor", "ros2 node list", "ros2 node info"],
    "topicos-list": ["ros2 node list", "ros2 topic"],
    "topicos-info": [
        "ros2 topic info /odom",
        "ros2 topic info -v /scan",
        "ros2 topic info -v /odom_raw",
    ],
    "mensagens-type": ["ros2 topic type /odom", "ros2 topic info /cmd_vel"],
    "mensagens-show": [
        "ros2 interface show geometry_msgs/msg/Twist2",
        "ros2 interface list",
        "ros2 interface show geometry_msgs/msg/TwistStamped",
    ],
    "odometria-echo": ["ros2 topic echo /odom", "ros2 topic echo --once /scan"],
    "odometria-field": [
        "ros2 topic echo --once /odom",
        "ros2 topic echo --once /odom --field pose.pose.orientation",
        "ros2 topic echo /odom --field pose.pose.position",
    ],
}

ACCEPTED_VARIANTS = {
    "terminal-ls-ros": ["ls  /opt/ros/", "ls -l /opt/ros"],
    "topicos-list": ["ros2 topic list -t"],
    "topicos-info": ["ros2 topic info --verbose /odom", "ros2  topic info /odom -v"],
    "odometria-echo": ["ros2 topic echo /odom --once"],
    "odometria-field": ["ros2 topic echo /odom --once --field pose.pose.position"],
}


def normalize_command(text):
    return " ".join(text.split())


def normalize_answer(text):
    return " ".join(text.strip().lower().split()).lstrip("/")


def command_matches(task, command):
    normalized = normalize_command(command)
    return all(re.search(pattern, normalized) for pattern in task["match"])


def all_tasks(mission):
    for step in mission["steps"]:
        for task in step["tasks"]:
            yield step, task


def rect_distance(a_min, a_max, b_min, b_max):
    dx = max(b_min[0] - a_max[0], a_min[0] - b_max[0], 0.0)
    dy = max(b_min[1] - a_max[1], a_min[1] - b_max[1], 0.0)
    return math.hypot(dx, dy)


def rect_point_distance(r_min, r_max, point):
    dx = max(r_min[0] - point[0], 0.0, point[0] - r_max[0])
    dy = max(r_min[1] - point[1], 0.0, point[1] - r_max[1])
    return math.hypot(dx, dy)


class MissionContentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with MISSION_FILE.open(encoding="utf-8") as handle:
            cls.raw = yaml.safe_load(handle)
        cls.mission = validate_mission(copy.deepcopy(cls.raw))
        cls.tasks = {task["id"]: task for _, task in all_tasks(cls.mission)}

    def test_module_order(self):
        self.assertEqual(
            [step["id"] for step in self.mission["steps"]],
            [
                "terminal",
                "nos",
                "topicos",
                "mensagens",
                "odometria",
                "movimento",
                "rotacao",
                "lidar",
                "entrega",
            ],
        )
        self.assertGreaterEqual(len(self.tasks), 20)
        self.assertLessEqual(len(self.tasks), 26)

    def test_trail_is_practical(self):
        kinds = [task["kind"] for task in self.tasks.values()]
        self.assertLessEqual(kinds.count("quiz"), 2)
        self.assertGreaterEqual(kinds.count("command"), 9)
        self.assertGreaterEqual(kinds.count("pose"), 4)
        self.assertEqual(kinds.count("scan"), 1)
        self.assertEqual(kinds[-1], "delivery")
        for step in self.mission["steps"]:
            self.assertTrue(step["learned"], step["id"])

    def test_solutions_and_inserts_match_their_own_task(self):
        for task in self.tasks.values():
            if task["kind"] != "command":
                continue
            candidates = list(task.get("solution", []))
            if task.get("insertCommand"):
                candidates.append(task["insertCommand"])
            self.assertTrue(candidates, task["id"])
            for command in candidates:
                self.assertTrue(command_matches(task, command), (task["id"], command))
            for command in ACCEPTED_VARIANTS.get(task["id"], []):
                self.assertTrue(command_matches(task, command), (task["id"], command))

    def test_near_misses_are_rejected(self):
        for task_id, commands in NEAR_MISSES.items():
            task = self.tasks[task_id]
            for command in commands:
                self.assertFalse(command_matches(task, command), (task_id, command))

    def test_every_command_task_has_a_near_miss(self):
        command_ids = {
            task["id"] for task in self.tasks.values() if task["kind"] == "command"
        }
        self.assertEqual(command_ids, set(NEAR_MISSES))

    def test_answers_match_the_lab_sources(self):
        dockerfile = (ROOT / "lab" / "image" / "Dockerfile").read_text()
        self.assertIn("ROS_DISTRO=jazzy", dockerfile)
        self.assertEqual(self.tasks["terminal-distro"]["accept"], ["jazzy"])

        monitor = (SIM / "launchpad_sim" / "mission_monitor.py").read_text()
        self.assertIn('super().__init__("mission_monitor")', monitor)
        self.assertIn("mission_monitor", map(normalize_answer, self.tasks["nos-monitor"]["accept"]))

        watchdog = (SIM / "launchpad_sim" / "cmd_vel_watchdog.py").read_text()
        self.assertIn('super().__init__("cmd_vel_watchdog")', watchdog)

        merge = (SIM / "launchpad_sim" / "odom_merge.py").read_text()
        self.assertIn('super().__init__("odom_merge")', merge)
        self.assertIn('"/odom"', merge)
        self.assertEqual(self.tasks["topicos-publisher"]["accept"], ["odom_merge"])

        urdf = (SIM / "urdf" / "robot.urdf.xacro").read_text()
        self.assertIn("<frame_id>odom</frame_id>", urdf)
        self.assertEqual(self.tasks["odometria-frame"]["accept"], ["odom"])
        self.assertIn("<samples>360</samples>", urdf)
        range_max = float(re.search(r"<max>([\d.]+)</max>", urdf).group(1))
        self.assertEqual(range_max, 8.0)
        numeric = self.tasks["lidar-range-max"]["numeric"]
        self.assertAlmostEqual(numeric["value"], range_max)
        self.assertLessEqual(numeric["tolerance"], 0.1)

        self.assertIn("angular.z", self.tasks["mensagens-angular"]["accept"])

    def test_answer_normalization(self):
        accept = set(map(normalize_answer, self.tasks["nos-monitor"]["accept"]))
        for typed in ("/mission_monitor", "  Mission_Monitor ", "mission_monitor"):
            self.assertIn(normalize_answer(typed), accept)
        self.assertNotIn(normalize_answer("monitor"), accept)

    def test_regions_are_reachable_and_clear(self):
        world = yaml.safe_load((ROOT / "content" / "world" / "armazem.yaml").read_text())
        floor = world["warehouse"]["floor"]
        regions = [
            task["region"] for task in self.tasks.values() if task.get("region")
        ]
        self.assertGreaterEqual(len(regions), 2)
        for region in regions:
            for axis in (0, 1):
                self.assertGreaterEqual(
                    region["min"][axis], floor["min"][axis] + CLEARANCE_M, region
                )
                self.assertLessEqual(
                    region["max"][axis], floor["max"][axis] - CLEARANCE_M, region
                )
            for obstacle in world["obstacles"]:
                center = obstacle["center"]
                if obstacle["type"] == "box":
                    half = (obstacle["size"][0] / 2, obstacle["size"][1] / 2)
                    distance = rect_distance(
                        region["min"],
                        region["max"],
                        (center[0] - half[0], center[1] - half[1]),
                        (center[0] + half[0], center[1] + half[1]),
                    )
                else:
                    distance = (
                        rect_point_distance(region["min"], region["max"], center)
                        - obstacle["radius"]
                    )
                self.assertGreater(
                    distance, CLEARANCE_M, (region["label"], obstacle["id"])
                )

    def test_scan_and_yaw_targets(self):
        scan = self.tasks["lidar-frente"]
        self.assertGreaterEqual(scan["minM"], 0.12 + 0.2)
        self.assertLess(scan["maxM"], 8.0)
        yaw = self.tasks["rotacao-90"]
        self.assertEqual(yaw["yawDeg"], 90)
        self.assertLessEqual(yaw["yawToleranceDeg"], 20)

    def test_hook_is_approved(self):
        self.assertEqual(
            self.mission["success"]["hook"],
            "Como o robô saberia que há uma caixa no caminho?",
        )


class InvalidSchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with MISSION_FILE.open(encoding="utf-8") as handle:
            cls.raw = yaml.safe_load(handle)

    def mutated(self, change):
        data = copy.deepcopy(self.raw)
        change(data)
        return data

    def assertInvalid(self, change):
        with self.assertRaises(ValueError):
            validate_mission(self.mutated(change))

    def find(self, data, task_id):
        for step in data["steps"]:
            for task in step["tasks"]:
                if task["id"] == task_id:
                    return task
        raise KeyError(task_id)

    def test_version_must_be_three(self):
        self.assertInvalid(lambda d: d.update(version=2))

    def test_step_count_limits(self):
        self.assertInvalid(lambda d: d.update(steps=d["steps"][-3:]))
        self.assertInvalid(lambda d: d.update(steps=d["steps"][:-1] * 2 + d["steps"][-1:]))

    def test_bad_regex(self):
        self.assertInvalid(lambda d: self.find(d, "nos-list").update(match=["(unclosed"]))

    def test_empty_match(self):
        self.assertInvalid(lambda d: self.find(d, "nos-list").update(match=[]))

    def test_unknown_kind(self):
        self.assertInvalid(lambda d: self.find(d, "nos-list").update(kind="motion"))

    def test_delivery_must_be_last_and_unique(self):
        def two(d):
            d["steps"][0]["tasks"].append(copy.deepcopy(d["steps"][-1]["tasks"][-1]))
            d["steps"][0]["tasks"][-1]["id"] = "outra-entrega"

        self.assertInvalid(two)
        self.assertInvalid(lambda d: d["steps"][-1]["tasks"].append(
            {**copy.deepcopy(self.find(d, "nos-list")), "id": "depois"}
        ))

    def test_answer_needs_exactly_one_rule(self):
        self.assertInvalid(
            lambda d: self.find(d, "terminal-distro").update(
                numeric={"value": 1, "tolerance": 0.1}
            )
        )
        self.assertInvalid(lambda d: self.find(d, "terminal-distro").pop("accept"))
        self.assertInvalid(
            lambda d: self.find(d, "lidar-range-max").update(
                numeric={"value": 8, "tolerance": 0}
            )
        )

    def test_pose_needs_a_criterion(self):
        def strip(d):
            task = self.find(d, "rotacao-90")
            task.pop("yawDeg")
            task.pop("yawToleranceDeg")

        self.assertInvalid(strip)
        self.assertInvalid(
            lambda d: self.find(d, "movimento-faixa-a")["region"].update(min=[2, 0], max=[1, 1])
        )
        self.assertInvalid(lambda d: self.find(d, "movimento-re").update(direction="up"))

    def test_scan_limits(self):
        self.assertInvalid(lambda d: self.find(d, "lidar-frente").update(minM=1.0, maxM=0.5))

    def test_duplicate_task_id(self):
        self.assertInvalid(lambda d: self.find(d, "nos-monitor").update(id="nos-list"))

    def test_multiline_insert(self):
        self.assertInvalid(lambda d: self.find(d, "nos-list").update(insertCommand="a\nb"))

    def test_hook_is_locked(self):
        self.assertInvalid(lambda d: d["success"].update(hook="Outra pergunta?"))


if __name__ == "__main__":
    unittest.main()
