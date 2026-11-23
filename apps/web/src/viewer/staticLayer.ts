import type { MapData } from "../types";
import { worldBounds } from "./camera";

export interface StaticOptions {
  grid: boolean;
  markings: boolean;
}

export function renderStatic(
  map: MapData,
  pixelsPerMeter: number,
  options: StaticOptions
) {
  const bounds = worldBounds(map);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((bounds.maxX - bounds.minX) * pixelsPerMeter);
  canvas.height = Math.ceil((bounds.maxY - bounds.minY) * pixelsPerMeter);
  const context = canvas.getContext("2d");
  if (context === null) {
    return canvas;
  }
  const px = (x: number) => (x - bounds.minX) * pixelsPerMeter;
  const py = (y: number) => (bounds.maxY - y) * pixelsPerMeter;
  const floor = map.warehouse.floor;
  const wall = map.warehouse.wall_thickness;

  context.fillStyle = "#1b2631";
  context.fillRect(
    px(floor.min[0]),
    py(floor.max[1]),
    floor.size[0] * pixelsPerMeter,
    floor.size[1] * pixelsPerMeter
  );

  if (options.grid) {
    context.strokeStyle = "#3b4b5a";
    context.lineWidth = 1;
    for (let x = Math.ceil(floor.min[0]); x <= floor.max[0]; x += 1) {
      context.beginPath();
      context.moveTo(px(x), py(floor.min[1]));
      context.lineTo(px(x), py(floor.max[1]));
      context.stroke();
    }
    for (let y = Math.ceil(floor.min[1]); y <= floor.max[1]; y += 1) {
      context.beginPath();
      context.moveTo(px(floor.min[0]), py(y));
      context.lineTo(px(floor.max[0]), py(y));
      context.stroke();
    }
  }

  context.fillStyle = "#7d7461";
  context.fillRect(
    px(floor.min[0] - wall),
    py(floor.max[1] + wall),
    (floor.size[0] + wall * 2) * pixelsPerMeter,
    wall * pixelsPerMeter
  );
  context.fillRect(
    px(floor.min[0] - wall),
    py(floor.min[1]),
    (floor.size[0] + wall * 2) * pixelsPerMeter,
    wall * pixelsPerMeter
  );
  context.fillRect(
    px(floor.min[0] - wall),
    py(floor.max[1]),
    wall * pixelsPerMeter,
    floor.size[1] * pixelsPerMeter
  );
  context.fillRect(
    px(floor.max[0]),
    py(floor.max[1]),
    wall * pixelsPerMeter,
    floor.size[1] * pixelsPerMeter
  );

  const zone = map.zone;
  context.fillStyle = "rgba(45, 212, 137, 0.22)";
  context.strokeStyle = "#34d399";
  context.lineWidth = 2;
  context.fillRect(
    px(zone.bounds.min[0]),
    py(zone.bounds.max[1]),
    zone.size[0] * pixelsPerMeter,
    zone.size[1] * pixelsPerMeter
  );
  context.strokeRect(
    px(zone.bounds.min[0]),
    py(zone.bounds.max[1]),
    zone.size[0] * pixelsPerMeter,
    zone.size[1] * pixelsPerMeter
  );

  context.fillStyle = "#e0a458";
  context.strokeStyle = "#f5d08b";
  for (const obstacle of map.obstacles) {
    if (obstacle.type === "box") {
      const [x, y] = obstacle.center;
      const [sizeX, sizeY] = obstacle.size;
      context.fillRect(
        px(x - sizeX / 2),
        py(y + sizeY / 2),
        sizeX * pixelsPerMeter,
        sizeY * pixelsPerMeter
      );
    } else {
      context.beginPath();
      context.arc(
        px(obstacle.center[0]),
        py(obstacle.center[1]),
        obstacle.radius * pixelsPerMeter,
        0,
        Math.PI * 2
      );
      context.fill();
    }
  }
  return canvas;
}
