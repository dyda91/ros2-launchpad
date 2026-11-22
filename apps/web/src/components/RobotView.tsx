import { useEffect, useRef } from "react";

import type { MapData, Pose } from "../types";

type RayHit = {
  distance: number;
  height: number;
  color: [number, number, number];
};

function rayBox(
  originX: number,
  originY: number,
  directionX: number,
  directionY: number,
  centerX: number,
  centerY: number,
  halfX: number,
  halfY: number
) {
  let near = -Infinity;
  let far = Infinity;
  for (const [origin, direction, half, center] of [
    [originX, directionX, halfX, centerX],
    [originY, directionY, halfY, centerY]
  ]) {
    if (Math.abs(direction) < 1e-9) {
      if (origin < center - half || origin > center + half) {
        return null;
      }
      continue;
    }
    const first = (center - half - origin) / direction;
    const second = (center + half - origin) / direction;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
  }
  if (far < Math.max(near, 0)) {
    return null;
  }
  return near > 0 ? near : far;
}

function castRay(
  map: MapData,
  pose: Pose,
  angle: number
): RayHit | null {
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const { floor } = map.warehouse;
  let best: RayHit | null = null;

  function consider(distance: number | null, height: number, color: [number, number, number]) {
    if (
      distance !== null &&
      distance > 0.02 &&
      (best === null || distance < best.distance)
    ) {
      best = { distance, height, color };
    }
  }

  if (directionX > 1e-9) {
    const distance = (floor.max[0] - pose.x) / directionX;
    const y = pose.y + directionY * distance;
    if (y >= floor.min[1] && y <= floor.max[1]) {
      consider(distance, map.warehouse.wall_height, [125, 116, 97]);
    }
  } else if (directionX < -1e-9) {
    const distance = (floor.min[0] - pose.x) / directionX;
    const y = pose.y + directionY * distance;
    if (y >= floor.min[1] && y <= floor.max[1]) {
      consider(distance, map.warehouse.wall_height, [125, 116, 97]);
    }
  }
  if (directionY > 1e-9) {
    const distance = (floor.max[1] - pose.y) / directionY;
    const x = pose.x + directionX * distance;
    if (x >= floor.min[0] && x <= floor.max[0]) {
      consider(distance, map.warehouse.wall_height, [125, 116, 97]);
    }
  } else if (directionY < -1e-9) {
    const distance = (floor.min[1] - pose.y) / directionY;
    const x = pose.x + directionX * distance;
    if (x >= floor.min[0] && x <= floor.max[0]) {
      consider(distance, map.warehouse.wall_height, [125, 116, 97]);
    }
  }

  for (const obstacle of map.obstacles) {
    if (obstacle.type === "box") {
      const distance = rayBox(
        pose.x,
        pose.y,
        directionX,
        directionY,
        obstacle.center[0],
        obstacle.center[1],
        obstacle.size[0] / 2,
        obstacle.size[1] / 2
      );
      consider(distance, obstacle.size[2], [224, 164, 88]);
    } else {
      const offsetX = pose.x - obstacle.center[0];
      const offsetY = pose.y - obstacle.center[1];
      const a = directionX * directionX + directionY * directionY;
      const b = 2 * (offsetX * directionX + offsetY * directionY);
      const c = offsetX * offsetX + offsetY * offsetY - obstacle.radius ** 2;
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        const first = (-b - root) / (2 * a);
        const second = (-b + root) / (2 * a);
        consider(
          first > 0 ? first : second > 0 ? second : null,
          obstacle.height,
          [224, 164, 88]
        );
      }
    }
  }

  return best;
}

function drawScene(canvas: HTMLCanvasElement, map: MapData, pose: Pose | null) {
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const horizon = height * 0.42;
  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#293744");
  sky.addColorStop(1, "#8b98a3");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);

  const ground = context.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, "#43515d");
  ground.addColorStop(1, "#111820");
  context.fillStyle = ground;
  context.fillRect(0, horizon, width, height - horizon);

  if (pose === null) {
    context.fillStyle = "#cbd5e1";
    context.font = "14px system-ui, sans-serif";
    context.fillText("Aguardando a pose do robô...", 18, horizon + 34);
    return;
  }

  const fieldOfView = (60 * Math.PI) / 180;
  const focal = width / 2 / Math.tan(fieldOfView / 2);
  const cameraHeight = 0.18;
  const columns = Math.max(160, Math.floor(width));
  for (let column = 0; column < columns; column += 1) {
    const normalized = column / (columns - 1) - 0.5;
    const hit = castRay(map, pose, pose.yaw + normalized * fieldOfView);
    if (hit === null) {
      continue;
    }
    const baseY = horizon + (focal * cameraHeight) / hit.distance;
    const topY = baseY - (focal * hit.height) / hit.distance;
    const shade = Math.max(0.25, Math.min(1, 1.4 - hit.distance / 8));
    context.fillStyle = `rgb(${Math.round(hit.color[0] * shade)} ${Math.round(
      hit.color[1] * shade
    )} ${Math.round(hit.color[2] * shade)})`;
    context.fillRect(
      (column / columns) * width,
      topY,
      width / columns + 1,
      Math.max(1, baseY - topY)
    );
  }

  context.strokeStyle = "rgba(255, 255, 255, 0.35)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(width / 2 - 8, horizon);
  context.lineTo(width / 2 + 8, horizon);
  context.moveTo(width / 2, horizon - 6);
  context.lineTo(width / 2, horizon + 6);
  context.stroke();
}

export default function RobotView({
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
      className="robot-view-canvas"
      data-testid="robot-view"
      aria-label="Visão em primeira pessoa do robô"
    />
  );
}
