import json
import math
import os
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(os.environ.get("LAUNCHPAD_ROOT", Path(__file__).resolve().parents[2]))
SIM_SRC = ROOT / "lab" / "ros_ws" / "src" / "launchpad_sim"
if not SIM_SRC.is_dir():
    SIM_SRC = Path("/ros_ws/src/launchpad_sim")
sys.path.insert(0, str(SIM_SRC))

from launchpad_sim import generate_world as generator  # noqa: E402

WORLD_YAML = ROOT / "content" / "world" / "armazem.yaml"
if not WORLD_YAML.is_file():
    WORLD_YAML = Path("/content/world/armazem.yaml")


def load_map():
    with open(WORLD_YAML, "r", encoding="utf-8") as handle:
        config = generator.load_config(WORLD_YAML)
    return generator.map_payload(config)



class WorldGeometryTest(unittest.TestCase):
    def test_generated_outputs_are_deterministic(self):
        with tempfile.TemporaryDirectory() as first:
            with tempfile.TemporaryDirectory() as second:
                first = Path(first)
                second = Path(second)
                generator.write_outputs(
                    WORLD_YAML,
                    first / "armazem.sdf",
                    first / "map.json",
                )
                generator.write_outputs(
                    WORLD_YAML,
                    second / "armazem.sdf",
                    second / "map.json",
                )
                self.assertEqual(
                    (first / "armazem.sdf").read_bytes(),
                    (second / "armazem.sdf").read_bytes(),
                )
                self.assertEqual(
                    (first / "map.json").read_bytes(),
                    (second / "map.json").read_bytes(),
                )

    def test_map_geometry_is_consistent(self):
        data = load_map()
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["frame"], "odom")
        self.assertEqual(data["world"], "armazem")
        self.assertAlmostEqual(data["spawn"]["x"], 0.0)
        self.assertAlmostEqual(data["spawn"]["y"], 0.0)
        self.assertAlmostEqual(data["spawn"]["z"], 0.15)
        self.assertEqual(data["zone"]["id"], "coleta")
        self.assertEqual(data["zone"]["bounds"]["min"], [12.5, 1.15])
        self.assertEqual(data["zone"]["bounds"]["max"], [13.9, 2.55])
        self.assertEqual(len(data["obstacles"]), 17)
        kinds = {item["id"]: item["kind"] for item in data["obstacles"]}
        self.assertEqual(kinds["caixa_c"], "crate")
        self.assertEqual(kinds["coluna_doca"], "pillar")
        self.assertEqual(kinds["rack_norte_a"], "rack")

    def test_zone_is_inside_warehouse(self):
        data = load_map()
        floor = data["warehouse"]["floor"]
        zone = data["zone"]
        self.assertGreater(zone["bounds"]["min"][0], floor["min"][0])
        self.assertGreater(zone["bounds"]["min"][1], floor["min"][1])
        self.assertLess(zone["bounds"]["max"][0], floor["max"][0])
        self.assertLess(zone["bounds"]["max"][1], floor["max"][1])

    def test_first_route_has_clearance(self):
        data = load_map()
        spawn = (data["spawn"]["x"], data["spawn"]["y"])
        route = [
            spawn,
            (1.0, 0.0),
            (1.0, 3.3),
            (2.2, 3.3),
            (2.2, 1.85),
            (13.2, 1.85),
            tuple(data["zone"]["center"]),
        ]
        clearance = 0.28
        for start, end in zip(route, route[1:]):
            segment_length = math.dist(start, end)
            steps = max(1, int(segment_length / 0.05))
            for step in range(steps + 1):
                ratio = step / steps
                point = (
                    start[0] + (end[0] - start[0]) * ratio,
                    start[1] + (end[1] - start[1]) * ratio,
                )
                for obstacle in data["obstacles"]:
                    distance = generator.point_obstacle_distance(point, obstacle)
                    self.assertGreater(
                        distance,
                        clearance,
                        f"route point {point} is too close to {obstacle['id']}",
                    )

    def test_zone_does_not_overlap_obstacles(self):
        data = load_map()
        zone = data["zone"]
        for obstacle in data["obstacles"]:
            if obstacle["type"] == "cylinder":
                distance = generator.rect_circle_distance(zone, obstacle)
                self.assertGreater(distance, obstacle["radius"] + 0.05)
            else:
                half_x = obstacle["size"][0] / 2.0
                half_y = obstacle["size"][1] / 2.0
                overlap_x = abs(obstacle["center"][0] - zone["center"][0]) < (
                    half_x + zone["size"][0] / 2.0
                )
                overlap_y = abs(obstacle["center"][1] - zone["center"][1]) < (
                    half_y + zone["size"][1] / 2.0
                )
                self.assertFalse(
                    overlap_x and overlap_y,
                    f"{obstacle['id']} overlaps the collection zone",
                )

    def test_sdf_is_local_and_contains_expected_models(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            sdf_path = directory / "armazem.sdf"
            map_path = directory / "map.json"
            generator.write_outputs(WORLD_YAML, sdf_path, map_path)
            tree = ET.parse(sdf_path)
            sdf = tree.getroot()
            self.assertEqual(sdf.attrib["version"], "1.8")
            world = sdf.find("world")
            self.assertIsNotNone(world)
            self.assertEqual(world.attrib["name"], "armazem")
            model_names = {
                model.attrib["name"] for model in world.findall("model")
            }
            self.assertIn("floor", model_names)
            self.assertIn("wall_west", model_names)
            self.assertIn("wall_east", model_names)
            self.assertIn("wall_south", model_names)
            self.assertIn("wall_north", model_names)
            self.assertIn("zona_coleta", model_names)
            self.assertIn("rack_sul_a", model_names)
            self.assertIn("coluna_doca", model_names)
            self.assertIn("caixa_c", model_names)
            self.assertFalse(world.findall(".//include"))
            self.assertFalse(world.findall(".//uri"))
            with open(map_path, "r", encoding="utf-8") as handle:
                generated_map = json.load(handle)
            self.assertEqual(generated_map["world"], "armazem")


if __name__ == "__main__":
    unittest.main()
