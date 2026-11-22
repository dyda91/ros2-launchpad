#!/usr/bin/env python3

import argparse
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import yaml


def as_float(value, field):
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric: {value!r}") from exc


def pair(value, field):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError(f"{field} must be a list of two numbers")
    return [as_float(value[0], field), as_float(value[1], field)]


def triple(value, field):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{field} must be a list of three numbers")
    return [as_float(value[i], field) for i in range(3)]


def load_config(path):
    with open(path, "r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle)
    if not isinstance(raw, dict):
        raise ValueError("world config must be a mapping")

    floor = raw["warehouse"]["floor"]
    min_xy = pair(floor["min"], "warehouse.floor.min")
    max_xy = pair(floor["max"], "warehouse.floor.max")
    if max_xy[0] <= min_xy[0] or max_xy[1] <= min_xy[1]:
        raise ValueError("warehouse floor max must be greater than min")

    thickness = as_float(floor.get("thickness", 0.1), "warehouse.floor.thickness")
    wall_height = as_float(raw["warehouse"]["wall_height"], "warehouse.wall_height")
    wall_thickness = as_float(
        raw["warehouse"]["wall_thickness"], "warehouse.wall_thickness"
    )
    if thickness <= 0 or wall_height <= 0 or wall_thickness <= 0:
        raise ValueError("warehouse dimensions must be positive")

    spawn_raw = raw["spawn"]
    spawn = {
        "x": as_float(spawn_raw["x"], "spawn.x"),
        "y": as_float(spawn_raw["y"], "spawn.y"),
        "z": as_float(spawn_raw["z"], "spawn.z"),
        "yaw": as_float(spawn_raw.get("yaw", 0.0), "spawn.yaw"),
    }

    zone_raw = raw["zone"]
    zone = {
        "id": str(zone_raw["id"]),
        "center": pair(zone_raw["center"], "zone.center"),
        "size": pair(zone_raw["size"], "zone.size"),
    }
    if zone["size"][0] <= 0 or zone["size"][1] <= 0:
        raise ValueError("zone size must be positive")

    obstacles = []
    for index, item in enumerate(raw.get("obstacles", [])):
        obstacle_type = item.get("type")
        obstacle = {
            "id": str(item["id"]),
            "type": obstacle_type,
            "center": pair(item["center"], f"obstacles[{index}].center"),
        }
        if obstacle_type == "box":
            obstacle["size"] = triple(item["size"], f"obstacles[{index}].size")
            if min(obstacle["size"]) <= 0:
                raise ValueError(f"obstacles[{index}].size must be positive")
        elif obstacle_type == "cylinder":
            obstacle["radius"] = as_float(
                item["radius"], f"obstacles[{index}].radius"
            )
            obstacle["height"] = as_float(
                item["height"], f"obstacles[{index}].height"
            )
            if obstacle["radius"] <= 0 or obstacle["height"] <= 0:
                raise ValueError(f"obstacles[{index}] dimensions must be positive")
        else:
            raise ValueError(f"unsupported obstacle type: {obstacle_type!r}")
        obstacles.append(obstacle)

    config = {
        "version": int(raw.get("version", 1)),
        "name": str(raw["name"]),
        "frame": str(raw.get("frame", "odom")),
        "warehouse": {
            "floor": {
                "min": min_xy,
                "max": max_xy,
                "thickness": thickness,
            },
            "wall_height": wall_height,
            "wall_thickness": wall_thickness,
        },
        "spawn": spawn,
        "zone": zone,
        "obstacles": obstacles,
    }
    validate_config(config)
    return config


def inside_floor(config, x, y, margin=0.0):
    floor = config["warehouse"]["floor"]
    return (
        floor["min"][0] + margin <= x <= floor["max"][0] - margin
        and floor["min"][1] + margin <= y <= floor["max"][1] - margin
    )


def point_obstacle_distance(point, obstacle):
    px, py = point
    cx, cy = obstacle["center"]
    if obstacle["type"] == "cylinder":
        return math.hypot(px - cx, py - cy) - obstacle["radius"]
    half_x = obstacle["size"][0] / 2.0
    half_y = obstacle["size"][1] / 2.0
    dx = max(abs(px - cx) - half_x, 0.0)
    dy = max(abs(py - cy) - half_y, 0.0)
    return math.hypot(dx, dy)


def rect_circle_distance(zone, obstacle):
    center = obstacle["center"]
    half_x = zone["size"][0] / 2.0
    half_y = zone["size"][1] / 2.0
    nearest_x = min(
        max(center[0], zone["center"][0] - half_x),
        zone["center"][0] + half_x,
    )
    nearest_y = min(
        max(center[1], zone["center"][1] - half_y),
        zone["center"][1] + half_y,
    )
    return math.hypot(center[0] - nearest_x, center[1] - nearest_y)


def validate_config(config):
    floor = config["warehouse"]["floor"]
    if config["version"] != 1:
        raise ValueError("unsupported world config version")

    spawn = config["spawn"]
    if not inside_floor(config, spawn["x"], spawn["y"], margin=0.3):
        raise ValueError("spawn must be at least 0.3 m inside the warehouse floor")
    for obstacle in config["obstacles"]:
        if point_obstacle_distance((spawn["x"], spawn["y"]), obstacle) < 0.35:
            raise ValueError(f"spawn is too close to obstacle {obstacle['id']}")

    zone = config["zone"]
    zone_min = [
        zone["center"][0] - zone["size"][0] / 2.0,
        zone["center"][1] - zone["size"][1] / 2.0,
    ]
    zone_max = [
        zone["center"][0] + zone["size"][0] / 2.0,
        zone["center"][1] + zone["size"][1] / 2.0,
    ]
    if not (
        inside_floor(config, zone_min[0], zone_min[1], margin=0.05)
        and inside_floor(config, zone_max[0], zone_max[1], margin=0.05)
    ):
        raise ValueError("collection zone must be inside the warehouse floor")
    for obstacle in config["obstacles"]:
        distance = rect_circle_distance(zone, obstacle)
        radius = obstacle.get("radius", 0.0)
        if obstacle["type"] == "box":
            half_x = obstacle["size"][0] / 2.0
            half_y = obstacle["size"][1] / 2.0
            overlap_x = abs(obstacle["center"][0] - zone["center"][0]) < (
                half_x + zone["size"][0] / 2.0
            )
            overlap_y = abs(obstacle["center"][1] - zone["center"][1]) < (
                half_y + zone["size"][1] / 2.0
            )
            if overlap_x and overlap_y:
                raise ValueError(
                    f"obstacle {obstacle['id']} overlaps the collection zone"
                )
        elif distance <= radius + 0.05:
            raise ValueError(
                f"obstacle {obstacle['id']} overlaps the collection zone"
            )

    for obstacle in config["obstacles"]:
        if not inside_floor(config, obstacle["center"][0], obstacle["center"][1]):
            raise ValueError(f"obstacle {obstacle['id']} is outside the floor")

    floor["size"] = [
        round(floor["max"][0] - floor["min"][0], 6),
        round(floor["max"][1] - floor["min"][1], 6),
    ]


def map_payload(config):
    zone = config["zone"]
    zone_min = [
        round(zone["center"][0] - zone["size"][0] / 2.0, 6),
        round(zone["center"][1] - zone["size"][1] / 2.0, 6),
    ]
    zone_max = [
        round(zone["center"][0] + zone["size"][0] / 2.0, 6),
        round(zone["center"][1] + zone["size"][1] / 2.0, 6),
    ]
    return {
        "version": config["version"],
        "name": config["name"],
        "world": config["name"],
        "frame": config["frame"],
        "warehouse": config["warehouse"],
        "spawn": config["spawn"],
        "zone": {
            **zone,
            "bounds": {"min": zone_min, "max": zone_max},
        },
        "obstacles": config["obstacles"],
    }


def add_text(parent, tag, text):
    element = ET.SubElement(parent, tag)
    element.text = str(text)
    return element


def pose_text(x, y, z, roll=0.0, pitch=0.0, yaw=0.0):
    return f"{x:.6f} {y:.6f} {z:.6f} {roll:.6f} {pitch:.6f} {yaw:.6f}"


def add_material(parent, color, emissive=None, transparency=None):
    material = ET.SubElement(parent, "material")
    add_text(material, "ambient", " ".join(f"{value:.3f}" for value in color[:3]) + " 1")
    add_text(material, "diffuse", " ".join(f"{value:.3f}" for value in color[:3]) + " 1")
    add_text(material, "specular", "0.100 0.100 0.100 1")
    if emissive is not None:
        add_text(
            material,
            "emissive",
            " ".join(f"{value:.3f}" for value in emissive[:3]) + " 1",
        )
    if transparency is not None:
        add_text(parent, "transparency", f"{transparency:.3f}")


def add_static_model(world, name, x, y, z, yaw=0.0):
    model = ET.SubElement(world, "model", {"name": name})
    add_text(model, "static", "true")
    add_text(model, "pose", pose_text(x, y, z, yaw=yaw))
    link = ET.SubElement(model, "link", {"name": "link"})
    add_text(link, "pose", pose_text(0.0, 0.0, 0.0))
    return link


def add_box_model(
    world,
    name,
    center,
    size,
    color,
    collision=True,
    transparency=None,
    emissive=None,
):
    link = add_static_model(world, name, center[0], center[1], center[2])
    geometry = ET.SubElement(link, "collision", {"name": "collision"})
    add_text(geometry, "pose", pose_text(0.0, 0.0, 0.0))
    box = ET.SubElement(ET.SubElement(geometry, "geometry"), "box")
    add_text(box, "size", " ".join(f"{value:.6f}" for value in size))
    visual = ET.SubElement(link, "visual", {"name": "visual"})
    add_text(visual, "pose", pose_text(0.0, 0.0, 0.0))
    box = ET.SubElement(ET.SubElement(visual, "geometry"), "box")
    add_text(box, "size", " ".join(f"{value:.6f}" for value in size))
    add_material(visual, color, emissive=emissive, transparency=transparency)
    if not collision:
        link.remove(geometry)
    return link


def add_cylinder_model(world, name, center, radius, height, color):
    link = add_static_model(world, name, center[0], center[1], center[2])
    collision = ET.SubElement(link, "collision", {"name": "collision"})
    add_text(collision, "pose", pose_text(0.0, 0.0, 0.0))
    cylinder = ET.SubElement(ET.SubElement(collision, "geometry"), "cylinder")
    add_text(cylinder, "radius", f"{radius:.6f}")
    add_text(cylinder, "length", f"{height:.6f}")
    visual = ET.SubElement(link, "visual", {"name": "visual"})
    add_text(visual, "pose", pose_text(0.0, 0.0, 0.0))
    cylinder = ET.SubElement(ET.SubElement(visual, "geometry"), "cylinder")
    add_text(cylinder, "radius", f"{radius:.6f}")
    add_text(cylinder, "length", f"{height:.6f}")
    add_material(visual, color)


def build_world(config):
    sdf = ET.Element("sdf", {"version": "1.8"})
    world = ET.SubElement(sdf, "world", {"name": config["name"]})

    physics = ET.SubElement(world, "physics", {"name": "physics", "type": "ode"})
    add_text(physics, "max_step_size", "0.002")
    add_text(physics, "real_time_factor", "1.0")
    add_text(physics, "real_time_update_rate", "500")
    add_text(world, "gravity", "0 0 -9.81")

    scene = ET.SubElement(world, "scene")
    add_text(scene, "ambient", "0.35 0.35 0.35 1")
    add_text(scene, "background", "0.70 0.80 0.90 1")
    add_text(scene, "shadows", "true")

    light = ET.SubElement(world, "light", {"type": "directional", "name": "sun"})
    add_text(light, "cast_shadows", "true")
    add_text(light, "pose", pose_text(0.0, 0.0, 10.0))
    add_text(light, "diffuse", "0.85 0.85 0.85 1")
    add_text(light, "specular", "0.20 0.20 0.20 1")
    attenuation = ET.SubElement(light, "attenuation")
    add_text(attenuation, "range", "1000")
    add_text(attenuation, "constant", "0.9")
    add_text(attenuation, "linear", "0.01")
    add_text(attenuation, "quadratic", "0.001")
    add_text(light, "direction", "-0.5 0.4 -0.9")

    for plugin_name, filename in (
        ("Physics", "gz-sim-physics-system"),
        ("UserCommands", "gz-sim-user-commands-system"),
        ("SceneBroadcaster", "gz-sim-scene-broadcaster-system"),
        ("Sensors", "gz-sim-sensors-system"),
    ):
        plugin = ET.SubElement(
            world,
            "plugin",
            {"filename": filename, "name": f"gz::sim::systems::{plugin_name}"},
        )
        if plugin_name == "Sensors":
            add_text(plugin, "render_engine", "ogre2")

    floor_cfg = config["warehouse"]["floor"]
    min_x, min_y = floor_cfg["min"]
    max_x, max_y = floor_cfg["max"]
    width = max_x - min_x
    depth = max_y - min_y
    thickness = floor_cfg["thickness"]
    center = [(min_x + max_x) / 2.0, (min_y + max_y) / 2.0, -thickness / 2.0]
    add_box_model(
        world,
        "floor",
        center,
        [width, depth, thickness],
        [0.55, 0.55, 0.55],
    )

    wall_height = config["warehouse"]["wall_height"]
    wall_thickness = config["warehouse"]["wall_thickness"]
    wall_color = [0.78, 0.74, 0.64]
    add_box_model(
        world,
        "wall_west",
        [min_x - wall_thickness / 2.0, (min_y + max_y) / 2.0, wall_height / 2.0],
        [wall_thickness, depth + 2.0 * wall_thickness, wall_height],
        wall_color,
    )
    add_box_model(
        world,
        "wall_east",
        [max_x + wall_thickness / 2.0, (min_y + max_y) / 2.0, wall_height / 2.0],
        [wall_thickness, depth + 2.0 * wall_thickness, wall_height],
        wall_color,
    )
    add_box_model(
        world,
        "wall_south",
        [(min_x + max_x) / 2.0, min_y - wall_thickness / 2.0, wall_height / 2.0],
        [width + 2.0 * wall_thickness, wall_thickness, wall_height],
        wall_color,
    )
    add_box_model(
        world,
        "wall_north",
        [(min_x + max_x) / 2.0, max_y + wall_thickness / 2.0, wall_height / 2.0],
        [width + 2.0 * wall_thickness, wall_thickness, wall_height],
        wall_color,
    )

    palette = [
        [0.84, 0.45, 0.14],
        [0.20, 0.42, 0.72],
        [0.34, 0.60, 0.30],
    ]
    for index, obstacle in enumerate(config["obstacles"]):
        color = palette[index % len(palette)]
        if obstacle["type"] == "box":
            size = obstacle["size"]
            add_box_model(
                world,
                obstacle["id"],
                [
                    obstacle["center"][0],
                    obstacle["center"][1],
                    size[2] / 2.0,
                ],
                size,
                color,
            )
        else:
            add_cylinder_model(
                world,
                obstacle["id"],
                [
                    obstacle["center"][0],
                    obstacle["center"][1],
                    obstacle["height"] / 2.0,
                ],
                obstacle["radius"],
                obstacle["height"],
                color,
            )

    zone = config["zone"]
    add_box_model(
        world,
        "zona_coleta",
        [zone["center"][0], zone["center"][1], 0.006],
        [zone["size"][0], zone["size"][1], 0.012],
        [0.10, 0.85, 0.30],
        collision=False,
        transparency=0.35,
        emissive=[0.05, 0.30, 0.08],
    )
    border = 0.06
    for suffix, offset, size in (
        (
            "sul",
            [0.0, -zone["size"][1] / 2.0],
            [zone["size"][0] + border, border, 0.02],
        ),
        (
            "norte",
            [0.0, zone["size"][1] / 2.0],
            [zone["size"][0] + border, border, 0.02],
        ),
        (
            "oeste",
            [-zone["size"][0] / 2.0, 0.0],
            [border, zone["size"][1] + border, 0.02],
        ),
        (
            "leste",
            [zone["size"][0] / 2.0, 0.0],
            [border, zone["size"][1] + border, 0.02],
        ),
    ):
        add_box_model(
            world,
            f"zona_coleta_borda_{suffix}",
            [zone["center"][0] + offset[0], zone["center"][1] + offset[1], 0.02],
            size,
            [0.05, 0.65, 0.20],
            collision=False,
            emissive=[0.02, 0.20, 0.05],
        )

    return sdf


def write_outputs(config_path, world_out, map_out):
    config = load_config(config_path)
    sdf = build_world(config)
    ET.indent(sdf, space="  ")
    world_out = Path(world_out)
    map_out = Path(map_out)
    world_out.parent.mkdir(parents=True, exist_ok=True)
    map_out.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(sdf).write(
        world_out, encoding="utf-8", xml_declaration=True
    )
    with open(world_out, "a", encoding="utf-8") as handle:
        handle.write("\n")
    with open(map_out, "w", encoding="utf-8") as handle:
        json.dump(map_payload(config), handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--world-out", required=True)
    parser.add_argument("--map-out", required=True)
    args = parser.parse_args()
    config = write_outputs(args.config, args.world_out, args.map_out)
    print(
        f"generated world {config['name']} with "
        f"{len(config['obstacles'])} obstacles"
    )


if __name__ == "__main__":
    main()
