import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, "/app")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "api"))

from app.mission_content import load_mission


class MissionContentTest(unittest.TestCase):
    def setUp(self):
        path = os.environ.get(
            "MISSION_FILE",
            "/content/missions/primeiro-turno.yaml",
        )
        self.mission = load_mission(path)

    def test_four_steps_and_kinds(self):
        self.assertEqual(len(self.mission["steps"]), 4)
        self.assertEqual(
            [step["kind"] for step in self.mission["steps"]],
            ["quiz", "quiz", "motion", "delivery"],
        )

    def test_answers_are_inside_options(self):
        for step in self.mission["steps"]:
            for key in ("question", "prediction"):
                question = step.get(key)
                if question is None:
                    continue
                self.assertGreaterEqual(question["answerIndex"], 0)
                self.assertLess(
                    question["answerIndex"], len(question["options"])
                )

    def test_insert_commands_are_one_line(self):
        for step in self.mission["steps"]:
            command = step.get("insertCommand")
            if command is not None:
                self.assertNotIn("\n", command)
            for command in step.get("solution", []):
                self.assertNotIn("\n", command)

    def test_delivery_is_explicitly_calibrated(self):
        delivery = self.mission["steps"][3]
        self.assertIn("solution", delivery)
        self.assertGreater(len(delivery["solution"]), 0)
        for key in ("x", "y", "yaw", "tolerance"):
            self.assertIsInstance(delivery["solutionStart"][key], (int, float))

    def test_hook_is_approved(self):
        self.assertEqual(
            self.mission["success"]["hook"],
            "Como o robô saberia que há uma caixa no caminho?",
        )


if __name__ == "__main__":
    unittest.main()
