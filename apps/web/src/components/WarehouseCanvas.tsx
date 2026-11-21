import { useEffect, useRef } from "react";

import type { MapData, Pose } from "../types";

function drawScene(
  canvas: HTMLCanvasElement,
  map: MapData,
  pose: Pose | null
) {
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const floor = map.warehouse.floor;
  const wall = map.warehouse.wall_thickness;
  const minX = floor.min[0] - wall;
  const maxX = floor.max[0] + wall;
  const minY = floor.min[1] - wall;
  const maxY = floor.max[1] + wall;
  const padding = 28;
  const scale = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - padding * 2) / (maxY - minY)
  );
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;

  const screenX = (x: number) => offsetX + (x - minX) * scale;
  const screenY = (y: number) => height - offsetY - (y - minY) * scale;
  const screenLength = (value: number) => value * scale;

  context.fillStyle = "#080d12";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#1b2631";
  context.fillRect(
    screenX(floor.min[0]),
    screenY(floor.max[1]),
    screenLength(floor.size[0]),
    screenLength(floor.size[1])
  );

  context.strokeStyle = "#3b4b5a";
  context.lineWidth = 1;
  for (let x = Math.ceil(floor.min[0]); x <= floor.max[0]; x += 1) {
    context.beginPath();
    context.moveTo(screenX(x), screenY(floor.min[1]));
    context.lineTo(screenX(x), screenY(floor.max[1]));
    context.stroke();
  }
  for (let y = Math.ceil(floor.min[1]); y <= floor.max[1]; y += 1) {
    context.beginPath();
    context.moveTo(screenX(floor.min[0]), screenY(y));
    context.lineTo(screenX(floor.max[0]), screenY(y));
    context.stroke();
  }

  const wallColor = "#7d7461";
  context.fillStyle = wallColor;
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.max[1] + wall),
    screenLength(floor.size[0] + wall * 2),
    screenLength(wall)
  );
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.min[1]),
    screenLength(floor.size[0] + wall * 2),
    screenLength(wall)
  );
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.max[1]),
    screenLength(wall),
    screenLength(floor.size[1])
  );
  context.fillRect(
    screenX(floor.max[0]),
    screenY(floor.max[1]),
    screenLength(wall),
    screenLength(floor.size[1])
  );

  const zone = map.zone;
  context.fillStyle = "rgba(45, 212, 137, 0.22)";
  context.strokeStyle = "#34d399";
  context.lineWidth = 2;
  context.fillRect(
    screenX(zone.bounds.min[0]),
    screenY(zone.bounds.max[1]),
    screenLength(zone.size[0]),
    screenLength(zone.size[1])
  );
  context.strokeRect(
    screenX(zone.bounds.min[0]),
    screenY(zone.bounds.max[1]),
    screenLength(zone.size[0]),
    screenLength(zone.size[1])
  );

  for (const obstacle of map.obstacles) {
    context.fillStyle = "#e0a458";
    context.strokeStyle = "#f5d08b";
    context.lineWidth = 1.5;
    if (obstacle.type === "box") {
      const [x, y] = obstacle.center;
      const [sizeX, sizeY] = obstacle.size;
      context.beginPath();
      context.roundRect(
        screenX(x - sizeX / 2),
        screenY(y + sizeY / 2),
        screenLength(sizeX),
        screenLength(sizeY),
        4
      );
      context.fill();
      context.stroke();
    } else {
      const [x, y] = obstacle.center;
      context.beginPath();
      context.arc(
        screenX(x),
        screenY(y),
        screenLength(obstacle.radius),
        0,
        Math.PI * 2
      );
      context.fill();
      context.stroke();
    }
  }

  context.fillStyle = "#9fb3c8";
  context.font = "12px system-ui, sans-serif";
  context.fillText(zone.id, screenX(zone.bounds.min[0]) + 6, screenY(zone.bounds.max[1]) + 18);

  if (pose !== null) {
    const robotX = screenX(pose.x);
    const robotY = screenY(pose.y);
    context.save();
    context.translate(robotX, robotY);
    context.rotate(-pose.yaw);
    context.fillStyle = "#60a5fa";
    context.strokeStyle = "#bfdbfe";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(screenLength(0.32), 0);
    context.lineTo(screenLength(-0.2), screenLength(0.18));
    context.lineTo(screenLength(-0.2), screenLength(-0.18));
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(0, 0, Math.max(4, screenLength(0.08)), 0, Math.PI * 2);
    context.fillStyle = "#0b1016";
    context.fill();
    context.restore();
  }
}

export default function WarehouseCanvas({
  map,
  pose
}: {
  map: MapData;
  pose: Pose | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const render = () => drawScene(canvas, map, pose);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [map, pose]);

  return (
    <canvas
      ref={canvasRef}
      className="warehouse-canvas"
      aria-label="Visor 2D do armazém"
    />
  );
}
