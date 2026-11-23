import { useEffect, useRef } from "react";

import type { CourseGuide, MapData, Pose, ScanData } from "../types";

function drawScene(
  canvas: HTMLCanvasElement,
  map: MapData,
  pose: Pose | null,
  scan: ScanData | null,
  showLidar: boolean,
  zoom: number,
  guide: CourseGuide | null
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
  const scaleX = ((width - padding * 2) / (maxX - minX)) * zoom;
  const scaleY = ((height - padding * 2) / (maxY - minY)) * zoom;
  const offsetX = (width - (maxX - minX) * scaleX) / 2;
  const offsetY = (height - (maxY - minY) * scaleY) / 2;

  const screenX = (x: number) => offsetX + (x - minX) * scaleX;
  const screenY = (y: number) => height - offsetY - (y - minY) * scaleY;
  const screenWidth = (value: number) => value * scaleX;
  const screenHeight = (value: number) => value * scaleY;
  const screenLength = (value: number) => value * Math.min(scaleX, scaleY);

  context.fillStyle = "#080d12";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#1b2631";
  context.fillRect(
    screenX(floor.min[0]),
    screenY(floor.max[1]),
    screenWidth(floor.size[0]),
    screenHeight(floor.size[1])
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
    screenWidth(floor.size[0] + wall * 2),
    screenHeight(wall)
  );
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.min[1]),
    screenWidth(floor.size[0] + wall * 2),
    screenHeight(wall)
  );
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.max[1]),
    screenWidth(wall),
    screenHeight(floor.size[1])
  );
  context.fillRect(
    screenX(floor.max[0]),
    screenY(floor.max[1]),
    screenWidth(wall),
    screenHeight(floor.size[1])
  );

  const zone = map.zone;
  context.fillStyle = "rgba(45, 212, 137, 0.22)";
  context.strokeStyle = "#34d399";
  context.lineWidth = 2;
  context.fillRect(
    screenX(zone.bounds.min[0]),
    screenY(zone.bounds.max[1]),
    screenWidth(zone.size[0]),
    screenHeight(zone.size[1])
  );
  context.strokeRect(
    screenX(zone.bounds.min[0]),
    screenY(zone.bounds.max[1]),
    screenWidth(zone.size[0]),
    screenHeight(zone.size[1])
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
        screenWidth(sizeX),
        screenHeight(sizeY),
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

  if (guide?.region) {
    const region = guide.region;
    context.save();
    context.setLineDash([6, 4]);
    context.strokeStyle = "#facc15";
    context.fillStyle = "rgba(250, 204, 21, 0.12)";
    context.lineWidth = 2;
    const left = screenX(region.min[0]);
    const top = screenY(region.max[1]);
    const regionWidth = screenWidth(region.max[0] - region.min[0]);
    const regionHeight = screenHeight(region.max[1] - region.min[1]);
    context.fillRect(left, top, regionWidth, regionHeight);
    context.strokeRect(left, top, regionWidth, regionHeight);
    context.setLineDash([]);
    context.fillStyle = "#fde68a";
    context.font = "12px system-ui, sans-serif";
    context.fillText(region.label, left + 4, top - 6);
    context.restore();
  }

  if (guide?.yawDeg !== undefined && pose !== null) {
    const target = (guide.yawDeg * Math.PI) / 180;
    const length = 1.2;
    context.save();
    context.setLineDash([8, 6]);
    context.strokeStyle = "#facc15";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(screenX(pose.x), screenY(pose.y));
    context.lineTo(
      screenX(pose.x + length * Math.cos(target)),
      screenY(pose.y + length * Math.sin(target))
    );
    context.stroke();
    context.restore();
  }

  if (guide?.sectorDeg !== undefined && pose !== null) {
    const sector = (guide.sectorDeg * Math.PI) / 180;
    const length = 2.0;
    const scanPose = scan?.pose ?? pose;
    context.save();
    context.fillStyle = "rgba(250, 204, 21, 0.18)";
    context.strokeStyle = "rgba(250, 204, 21, 0.8)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(screenX(scanPose.x), screenY(scanPose.y));
    const steps = 12;
    for (let index = 0; index <= steps; index += 1) {
      const angle = scanPose.yaw - sector + (2 * sector * index) / steps;
      context.lineTo(
        screenX(scanPose.x + length * Math.cos(angle)),
        screenY(scanPose.y + length * Math.sin(angle))
      );
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  if (showLidar && scan !== null && pose !== null) {
    const scanPose = scan.pose ?? pose;
    context.fillStyle = "rgba(96, 165, 250, 0.9)";
    for (let index = 0; index < scan.ranges.length; index += 1) {
      const range = scan.ranges[index];
      if (range === null || range < scan.range_min || range > scan.range_max) {
        continue;
      }
      const angle = scan.angle_min + index * scan.angle_increment;
      const worldX = scanPose.x + range * Math.cos(scanPose.yaw + angle);
      const worldY = scanPose.y + range * Math.sin(scanPose.yaw + angle);
      context.beginPath();
      context.arc(
        screenX(worldX),
        screenY(worldY),
        Math.max(1.5, screenLength(0.018)),
        0,
        Math.PI * 2
      );
      context.fill();
    }
  }

  context.fillStyle = wallColor;
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.max[1] + wall),
    screenWidth(floor.size[0] + wall * 2),
    screenHeight(wall)
  );
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.min[1]),
    screenWidth(floor.size[0] + wall * 2),
    screenHeight(wall)
  );
  context.fillRect(
    screenX(floor.min[0] - wall),
    screenY(floor.max[1]),
    screenWidth(wall),
    screenHeight(floor.size[1])
  );
  context.fillRect(
    screenX(floor.max[0]),
    screenY(floor.max[1]),
    screenWidth(wall),
    screenHeight(floor.size[1])
  );
  context.strokeStyle = "#a29378";
  context.lineWidth = 2;
  context.strokeRect(
    screenX(floor.min[0]),
    screenY(floor.max[1]),
    screenWidth(floor.size[0]),
    screenHeight(floor.size[1])
  );
  for (const obstacle of map.obstacles) {
    context.strokeStyle = "rgba(245, 208, 139, 0.9)";
    context.lineWidth = 1.5;
    if (obstacle.type === "box") {
      const [x, y] = obstacle.center;
      const [sizeX, sizeY] = obstacle.size;
      context.strokeRect(
        screenX(x - sizeX / 2),
        screenY(y + sizeY / 2),
        screenWidth(sizeX),
        screenHeight(sizeY)
      );
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
      context.stroke();
    }
  }

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
  pose,
  scan,
  showLidar,
  zoom,
  guide = null
}: {
  map: MapData;
  pose: Pose | null;
  scan: ScanData | null;
  showLidar: boolean;
  zoom: number;
  guide?: CourseGuide | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const render = () =>
      drawScene(canvas, map, pose, scan, showLidar, zoom, guide);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [map, pose, scan, showLidar, zoom, guide]);

  return (
    <canvas
      ref={canvasRef}
      className="warehouse-canvas"
      aria-label="Visor 2D do armazém"
      data-testid="warehouse-canvas"
      data-guide-region={guide?.region?.label ?? ""}
      data-guide-yaw={guide?.yawDeg ?? ""}
      data-guide-sector={guide?.sectorDeg ?? ""}
    />
  );
}
