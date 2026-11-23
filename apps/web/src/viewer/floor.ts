import type { MapData } from "../types";
import { roundedRect, type Geo } from "./geo";
import { palette } from "./palette";
import { mulberry32 } from "./prng";

let grainTile: HTMLCanvasElement | null = null;

function grain() {
  if (grainTile === null) {
    const tile = document.createElement("canvas");
    tile.width = 128;
    tile.height = 128;
    const context = tile.getContext("2d");
    if (context !== null) {
      const image = context.createImageData(128, 128);
      const random = mulberry32(7);
      for (let index = 0; index < 128 * 128; index += 1) {
        const value = 128 + (random() - 0.5) * 70;
        image.data[index * 4] = value;
        image.data[index * 4 + 1] = value;
        image.data[index * 4 + 2] = value;
        image.data[index * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    }
    grainTile = tile;
  }
  return grainTile;
}

function floorRect(map: MapData, geo: Geo) {
  const floor = map.warehouse.floor;
  return {
    x: geo.px(floor.min[0]),
    y: geo.py(floor.max[1]),
    width: geo.len(floor.size[0]),
    height: geo.len(floor.size[1])
  };
}

export function drawFloorBase(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const rect = floorRect(map, geo);
  const gradient = context.createLinearGradient(
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y + rect.height
  );
  gradient.addColorStop(0, palette.floorLight);
  gradient.addColorStop(1, palette.floorDark);
  context.fillStyle = gradient;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);

  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();

  const sheen = context.createRadialGradient(
    rect.x + rect.width * 0.4,
    rect.y + rect.height * 0.35,
    0,
    rect.x + rect.width * 0.4,
    rect.y + rect.height * 0.35,
    rect.width * 0.7
  );
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = sheen;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);

  const pattern = context.createPattern(grain(), "repeat");
  if (pattern !== null) {
    context.globalCompositeOperation = "overlay";
    context.globalAlpha = 0.32;
    context.fillStyle = pattern;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
  }

  const random = mulberry32(2024);
  const floor = map.warehouse.floor;
  for (let index = 0; index < 18; index += 1) {
    const x = floor.min[0] + random() * floor.size[0];
    const y = floor.min[1] + random() * floor.size[1];
    const radius = geo.len(0.25 + random() * 0.55);
    const strength = 0.06 + random() * 0.1;
    const stain = context.createRadialGradient(
      geo.px(x),
      geo.py(y),
      0,
      geo.px(x),
      geo.py(y),
      radius
    );
    stain.addColorStop(0, `rgba(8, 12, 16, ${strength})`);
    stain.addColorStop(1, "rgba(8, 12, 16, 0)");
    context.fillStyle = stain;
    context.save();
    context.translate(geo.px(x), geo.py(y));
    context.scale(1, 0.55 + random() * 0.5);
    context.translate(-geo.px(x), -geo.py(y));
    context.fillRect(
      geo.px(x) - radius,
      geo.py(y) - radius * 2,
      radius * 2,
      radius * 4
    );
    context.restore();
  }
  context.restore();
}

export function drawJoints(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const floor = map.warehouse.floor;
  context.save();
  context.lineWidth = Math.max(1, geo.len(0.012));
  for (let x = Math.ceil(floor.min[0] / 2) * 2; x < floor.max[0]; x += 2) {
    context.strokeStyle = palette.joint;
    context.beginPath();
    context.moveTo(geo.px(x), geo.py(floor.min[1]));
    context.lineTo(geo.px(x), geo.py(floor.max[1]));
    context.stroke();
    context.strokeStyle = palette.jointEdge;
    context.beginPath();
    context.moveTo(geo.px(x) + context.lineWidth, geo.py(floor.min[1]));
    context.lineTo(geo.px(x) + context.lineWidth, geo.py(floor.max[1]));
    context.stroke();
  }
  for (let y = Math.ceil(floor.min[1] / 2) * 2; y < floor.max[1]; y += 2) {
    context.strokeStyle = palette.joint;
    context.beginPath();
    context.moveTo(geo.px(floor.min[0]), geo.py(y));
    context.lineTo(geo.px(floor.max[0]), geo.py(y));
    context.stroke();
    context.strokeStyle = palette.jointEdge;
    context.beginPath();
    context.moveTo(geo.px(floor.min[0]), geo.py(y) + context.lineWidth);
    context.lineTo(geo.px(floor.max[0]), geo.py(y) + context.lineWidth);
    context.stroke();
  }
  context.restore();
}

export function drawZebra(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const rect = floorRect(map, geo);
  const band = geo.len(0.13);
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.rect(
    rect.x + band,
    rect.y + band,
    rect.width - band * 2,
    rect.height - band * 2
  );
  context.clip("evenodd");
  context.fillStyle = palette.paintDark;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  const step = geo.len(0.2);
  context.fillStyle = palette.paint;
  const span = rect.width + rect.height;
  for (let offset = -rect.height; offset < span; offset += step * 2) {
    context.beginPath();
    context.moveTo(rect.x + offset, rect.y + rect.height);
    context.lineTo(rect.x + offset + step, rect.y + rect.height);
    context.lineTo(rect.x + offset + step + rect.height, rect.y);
    context.lineTo(rect.x + offset + rect.height, rect.y);
    context.closePath();
    context.fill();
  }
  context.restore();
}

export function drawLanes(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const rect = floorRect(map, geo);
  const inset = geo.len(0.17);
  const clearance = 0.42;
  context.save();
  context.beginPath();
  context.rect(
    rect.x + inset,
    rect.y + inset,
    rect.width - inset * 2,
    rect.height - inset * 2
  );
  context.clip();
  context.strokeStyle = palette.paint;
  context.globalAlpha = 0.85;
  context.lineWidth = Math.max(1.5, geo.len(0.045));
  for (const obstacle of map.obstacles) {
    if (obstacle.type === "box") {
      const [x, y] = obstacle.center;
      const halfX = obstacle.size[0] / 2 + clearance;
      const halfY = obstacle.size[1] / 2 + clearance;
      roundedRect(
        context,
        geo.px(x - halfX),
        geo.py(y + halfY),
        geo.len(halfX * 2),
        geo.len(halfY * 2),
        geo.len(0.12)
      );
      context.stroke();
    } else {
      context.beginPath();
      context.arc(
        geo.px(obstacle.center[0]),
        geo.py(obstacle.center[1]),
        geo.len(obstacle.radius + clearance),
        0,
        Math.PI * 2
      );
      context.stroke();
    }
  }
  context.restore();
}

export function drawWallShadow(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const rect = floorRect(map, geo);
  const depth = geo.len(0.22);
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  const edges: [number, number, number, number, number, number][] = [
    [rect.x, rect.y, rect.x, rect.y + depth, rect.width, depth],
    [rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - depth, rect.width, depth],
    [rect.x, rect.y, rect.x + depth, rect.y, depth, rect.height],
    [rect.x + rect.width, rect.y, rect.x + rect.width - depth, rect.y, depth, rect.height]
  ];
  for (const [x0, y0, x1, y1, width, height] of edges) {
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.42)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    const left = Math.min(x0, x1) === x0 ? x0 : x1;
    const top = Math.min(y0, y1) === y0 ? y0 : y1;
    context.fillRect(left, top, width, height);
  }
  context.restore();
}

export function drawGrid(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const floor = map.warehouse.floor;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    context.beginPath();
    context.moveTo(geo.px(x0), geo.py(y0));
    context.lineTo(geo.px(x1), geo.py(y1));
    context.stroke();
  };
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = palette.gridFine;
  for (let x = Math.ceil(floor.min[0] * 2) / 2; x <= floor.max[0]; x += 0.5) {
    if (Math.abs(x - Math.round(x)) > 1e-6) {
      line(x, floor.min[1], x, floor.max[1]);
    }
  }
  for (let y = Math.ceil(floor.min[1] * 2) / 2; y <= floor.max[1]; y += 0.5) {
    if (Math.abs(y - Math.round(y)) > 1e-6) {
      line(floor.min[0], y, floor.max[0], y);
    }
  }
  context.strokeStyle = palette.grid;
  for (let x = Math.ceil(floor.min[0]); x <= floor.max[0]; x += 1) {
    line(x, floor.min[1], x, floor.max[1]);
  }
  for (let y = Math.ceil(floor.min[1]); y <= floor.max[1]; y += 1) {
    line(floor.min[0], y, floor.max[0], y);
  }
  context.restore();
}

export function drawWalls(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const floor = map.warehouse.floor;
  const wall = map.warehouse.wall_thickness;
  const segments: [number, number, number, number][] = [
    [floor.min[0] - wall, floor.max[1], floor.size[0] + wall * 2, wall],
    [floor.min[0] - wall, floor.min[1] - wall, floor.size[0] + wall * 2, wall],
    [floor.min[0] - wall, floor.max[1], wall, floor.size[1]],
    [floor.max[0], floor.max[1], wall, floor.size[1]]
  ];
  context.save();
  for (const [x, yTop, width, height] of segments) {
    const left = geo.px(x);
    const top = geo.py(yTop + (height === wall ? wall : 0));
    const pxWidth = geo.len(width);
    const pxHeight = geo.len(height);
    context.fillStyle = palette.wall;
    context.fillRect(left, top, pxWidth, pxHeight);
    context.strokeStyle = palette.wallSeam;
    context.lineWidth = 1;
    if (pxWidth >= pxHeight) {
      for (let offset = 0; offset < width; offset += 0.4) {
        context.beginPath();
        context.moveTo(left + geo.len(offset), top);
        context.lineTo(left + geo.len(offset), top + pxHeight);
        context.stroke();
      }
    } else {
      for (let offset = 0; offset < height; offset += 0.4) {
        context.beginPath();
        context.moveTo(left, top + geo.len(offset));
        context.lineTo(left + pxWidth, top + geo.len(offset));
        context.stroke();
      }
    }
    context.strokeStyle = palette.wallEdge;
    context.lineWidth = Math.max(1, geo.len(0.012));
    context.strokeRect(left, top, pxWidth, pxHeight);
  }
  context.restore();
}
