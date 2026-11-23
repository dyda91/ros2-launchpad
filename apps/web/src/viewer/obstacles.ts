import type { BoxObstacle, CylinderObstacle, MapData } from "../types";
import { roundedRect, type Geo } from "./geo";
import { palette } from "./palette";
import { hashString, mulberry32 } from "./prng";

type Point = [number, number];

const SHADOW_SLOPE = 0.34;

function cross(origin: Point, a: Point, b: Point) {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}

function hull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function obstacleHeight(obstacle: BoxObstacle | CylinderObstacle) {
  return obstacle.type === "box" ? obstacle.size[2] : obstacle.height;
}

function outline(obstacle: BoxObstacle | CylinderObstacle): Point[] {
  const [x, y] = obstacle.center;
  if (obstacle.type === "box") {
    const halfX = obstacle.size[0] / 2;
    const halfY = obstacle.size[1] / 2;
    return [
      [x - halfX, y - halfY],
      [x + halfX, y - halfY],
      [x + halfX, y + halfY],
      [x - halfX, y + halfY]
    ];
  }
  const points: Point[] = [];
  for (let index = 0; index < 28; index += 1) {
    const angle = (index / 28) * Math.PI * 2;
    points.push([x + obstacle.radius * Math.cos(angle), y + obstacle.radius * Math.sin(angle)]);
  }
  return points;
}

export function drawShadows(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const floor = map.warehouse.floor;
  context.save();
  context.beginPath();
  context.rect(
    geo.px(floor.min[0]),
    geo.py(floor.max[1]),
    geo.len(floor.size[0]),
    geo.len(floor.size[1])
  );
  context.clip();
  for (const obstacle of map.obstacles) {
    const height = obstacleHeight(obstacle);
    const dx = SHADOW_SLOPE * height;
    const dy = -SHADOW_SLOPE * height;
    const base = outline(obstacle);
    const shape = hull([
      ...base,
      ...base.map((point): Point => [point[0] + dx, point[1] + dy])
    ]);
    const trace = () => {
      context.beginPath();
      shape.forEach((point, index) => {
        const sx = geo.px(point[0]);
        const sy = geo.py(point[1]);
        if (index === 0) {
          context.moveTo(sx, sy);
        } else {
          context.lineTo(sx, sy);
        }
      });
      context.closePath();
    };
    trace();
    context.lineJoin = "round";
    context.strokeStyle = "rgba(0, 0, 0, 0.10)";
    context.lineWidth = geo.len(0.12);
    context.stroke();
    trace();
    context.strokeStyle = "rgba(0, 0, 0, 0.14)";
    context.lineWidth = geo.len(0.05);
    context.stroke();
    context.fillStyle = "rgba(0, 0, 0, 0.34)";
    context.fill();
  }
  context.restore();
}

function drawCrate(
  context: CanvasRenderingContext2D,
  obstacle: BoxObstacle,
  geo: Geo
) {
  const [cx, cy] = obstacle.center;
  const [sizeX, sizeY] = obstacle.size;
  const left = geo.px(cx - sizeX / 2);
  const top = geo.py(cy + sizeY / 2);
  const width = geo.len(sizeX);
  const height = geo.len(sizeY);
  const random = mulberry32(hashString(obstacle.id));

  context.fillStyle = palette.wood;
  context.fillRect(left, top, width, height);
  context.strokeStyle = palette.woodDark;
  context.lineWidth = Math.max(1, geo.len(0.012));
  const slats = Math.max(3, Math.round(sizeY / 0.14));
  for (let index = 1; index < slats; index += 1) {
    const y = top + (height * index) / slats;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(left + width, y);
    context.stroke();
  }

  const columns = Math.max(1, Math.round(sizeX / 0.4));
  const rows = Math.max(1, Math.round(sizeY / 0.4));
  const margin = geo.len(0.03);
  const cellWidth = (width - margin * 2) / columns;
  const cellHeight = (height - margin * 2) / rows;
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = left + margin + column * cellWidth;
      const y = top + margin + row * cellHeight;
      context.fillStyle = palette.cartons[Math.floor(random() * palette.cartons.length)];
      context.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
      context.fillStyle = "rgba(255, 255, 255, 0.10)";
      context.fillRect(x + 1, y + 1, cellWidth - 2, (cellHeight - 2) * 0.45);
      context.fillStyle = palette.tape;
      if (cellWidth >= cellHeight) {
        context.fillRect(x + 1, y + cellHeight / 2 - geo.len(0.02), cellWidth - 2, geo.len(0.04));
      } else {
        context.fillRect(x + cellWidth / 2 - geo.len(0.02), y + 1, geo.len(0.04), cellHeight - 2);
      }
      context.strokeStyle = "rgba(30, 20, 10, 0.55)";
      context.lineWidth = 1;
      context.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    }
  }
  context.strokeStyle = "rgba(20, 14, 8, 0.9)";
  context.lineWidth = Math.max(1.2, geo.len(0.018));
  context.strokeRect(left, top, width, height);
}

function drawRack(
  context: CanvasRenderingContext2D,
  obstacle: BoxObstacle,
  geo: Geo
) {
  const [cx, cy] = obstacle.center;
  const [sizeX, sizeY] = obstacle.size;
  const left = geo.px(cx - sizeX / 2);
  const top = geo.py(cy + sizeY / 2);
  const width = geo.len(sizeX);
  const height = geo.len(sizeY);
  const horizontal = sizeX >= sizeY;
  const random = mulberry32(hashString(obstacle.id));
  const beam = geo.len(0.07);

  context.fillStyle = palette.steel;
  context.fillRect(left, top, width, height);

  const longLength = horizontal ? sizeX : sizeY;
  const bays = Math.max(1, Math.round(longLength / 1.1));
  const bay = longLength / bays;
  for (let index = 0; index < bays; index += 1) {
    const start = index * bay + 0.05;
    const length = bay - 0.1;
    const x = horizontal ? left + geo.len(start) : left + beam;
    const y = horizontal ? top + beam : top + geo.len(start);
    const w = horizontal ? geo.len(length) : width - beam * 2;
    const h = horizontal ? height - beam * 2 : geo.len(length);
    if (random() < 0.28) {
      context.fillStyle = palette.wrap;
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(60, 80, 100, 0.55)";
      context.fillRect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8);
      context.strokeStyle = "rgba(255, 255, 255, 0.5)";
      context.lineWidth = 1;
      context.strokeRect(x, y, w, h);
    } else {
      const columns = horizontal ? Math.max(1, Math.round(length / 0.38)) : Math.max(1, Math.round((sizeX - 0.14) / 0.38));
      const rows = horizontal ? Math.max(1, Math.round((sizeY - 0.14) / 0.38)) : Math.max(1, Math.round(length / 0.38));
      const cellWidth = w / columns;
      const cellHeight = h / rows;
      for (let column = 0; column < columns; column += 1) {
        for (let row = 0; row < rows; row += 1) {
          const cellX = x + column * cellWidth;
          const cellY = y + row * cellHeight;
          context.fillStyle = palette.cartons[Math.floor(random() * palette.cartons.length)];
          context.fillRect(cellX + 1, cellY + 1, cellWidth - 2, cellHeight - 2);
          context.fillStyle = palette.tape;
          if (cellWidth >= cellHeight) {
            context.fillRect(cellX + 1, cellY + cellHeight / 2 - geo.len(0.015), cellWidth - 2, geo.len(0.03));
          } else {
            context.fillRect(cellX + cellWidth / 2 - geo.len(0.015), cellY + 1, geo.len(0.03), cellHeight - 2);
          }
          context.strokeStyle = "rgba(30, 20, 10, 0.5)";
          context.lineWidth = 1;
          context.strokeRect(cellX + 1, cellY + 1, cellWidth - 2, cellHeight - 2);
        }
      }
    }
  }

  context.fillStyle = palette.beam;
  if (horizontal) {
    context.fillRect(left, top, width, beam);
    context.fillRect(left, top + height - beam, width, beam);
  } else {
    context.fillRect(left, top, beam, height);
    context.fillRect(left + width - beam, top, beam, height);
  }

  context.fillStyle = palette.upright;
  const post = geo.len(0.09);
  for (let index = 0; index <= bays; index += 1) {
    const offset = geo.len(index * bay);
    const px = horizontal ? left + Math.min(offset, width - post) : left;
    const py = horizontal ? top : top + Math.min(offset, height - post);
    context.fillRect(px, py, post, post);
    if (horizontal) {
      context.fillRect(px, top + height - post, post, post);
    } else {
      context.fillRect(left + width - post, py, post, post);
    }
  }
  context.strokeStyle = "rgba(10, 14, 18, 0.95)";
  context.lineWidth = Math.max(1.2, geo.len(0.018));
  context.strokeRect(left, top, width, height);
}

function drawPillar(
  context: CanvasRenderingContext2D,
  obstacle: CylinderObstacle,
  geo: Geo
) {
  const x = geo.px(obstacle.center[0]);
  const y = geo.py(obstacle.center[1]);
  const radius = geo.len(obstacle.radius);
  const guard = geo.len(0.09);
  const segments = 24;
  for (let index = 0; index < segments; index += 1) {
    context.beginPath();
    context.arc(
      x,
      y,
      radius,
      (index / segments) * Math.PI * 2,
      ((index + 1) / segments) * Math.PI * 2
    );
    context.arc(
      x,
      y,
      radius - guard,
      ((index + 1) / segments) * Math.PI * 2,
      (index / segments) * Math.PI * 2,
      true
    );
    context.closePath();
    context.fillStyle = index % 2 === 0 ? palette.paint : palette.paintDark;
    context.fill();
  }
  const concrete = context.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.3,
    radius * 0.1,
    x,
    y,
    radius - guard
  );
  concrete.addColorStop(0, "#c4cbd0");
  concrete.addColorStop(1, palette.concreteDark);
  context.fillStyle = concrete;
  context.beginPath();
  context.arc(x, y, radius - guard, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(20, 24, 28, 0.8)";
  context.lineWidth = Math.max(1, geo.len(0.015));
  context.stroke();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(10, 14, 18, 0.95)";
  context.lineWidth = Math.max(1.2, geo.len(0.018));
  context.stroke();
}

export function drawObstacles(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  for (const obstacle of map.obstacles) {
    if (obstacle.type === "cylinder") {
      drawPillar(context, obstacle, geo);
    } else if (obstacle.kind === "rack") {
      drawRack(context, obstacle, geo);
    } else {
      drawCrate(context, obstacle, geo);
    }
  }
}

export function drawZone(
  context: CanvasRenderingContext2D,
  map: MapData,
  geo: Geo
) {
  const zone = map.zone;
  const left = geo.px(zone.bounds.min[0]);
  const top = geo.py(zone.bounds.max[1]);
  const width = geo.len(zone.size[0]);
  const height = geo.len(zone.size[1]);
  context.save();
  context.fillStyle = palette.zoneSoft;
  context.fillRect(left, top, width, height);

  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  context.strokeStyle = "rgba(34, 197, 94, 0.5)";
  context.lineWidth = Math.max(2, geo.len(0.05));
  context.lineCap = "round";
  context.lineJoin = "round";
  const reach = geo.len(0.14);
  for (let column = 0; column < 4; column += 1) {
    const x = left + width * (0.2 + column * 0.2);
    for (let row = 0; row < 3; row += 1) {
      const y = top + height * (0.34 + row * 0.22);
      context.beginPath();
      context.moveTo(x - reach, y - reach);
      context.lineTo(x, y);
      context.lineTo(x - reach, y + reach);
      context.stroke();
    }
  }
  context.restore();

  context.strokeStyle = palette.zone;
  context.lineWidth = Math.max(2, geo.len(0.06));
  roundedRect(context, left, top, width, height, geo.len(0.04));
  context.stroke();
  const corner = geo.len(0.28);
  context.lineWidth = Math.max(3, geo.len(0.1));
  context.lineCap = "butt";
  for (const [cx, cy, sx, sy] of [
    [left, top, 1, 1],
    [left + width, top, -1, 1],
    [left, top + height, 1, -1],
    [left + width, top + height, -1, -1]
  ] as const) {
    context.beginPath();
    context.moveTo(cx + sx * corner, cy);
    context.lineTo(cx, cy);
    context.lineTo(cx, cy + sy * corner);
    context.stroke();
  }

  context.fillStyle = "rgba(220, 252, 231, 0.92)";
  context.font = `700 ${Math.max(11, geo.len(0.17))}px system-ui, sans-serif`;
  context.textBaseline = "top";
  context.fillText("COLETA", left + geo.len(0.12), top + geo.len(0.1));
  context.restore();
}
