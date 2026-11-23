import { screenX, screenY, type View } from "./camera";
import type { ViewerState } from "./state";

const GUIDE_COLOR = "#facc15";

function degrees(value: number) {
  return (value * Math.PI) / 180;
}

function drawGuides(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState
) {
  const guide = state.guide;
  const pose = state.pose;
  if (guide === null) {
    return;
  }
  if (guide.region) {
    const region = guide.region;
    const left = screenX(view, region.min[0]);
    const top = screenY(view, region.max[1]);
    const width = (region.max[0] - region.min[0]) * view.scale;
    const height = (region.max[1] - region.min[1]) * view.scale;
    context.save();
    context.setLineDash([6, 4]);
    context.strokeStyle = GUIDE_COLOR;
    context.fillStyle = "rgba(250, 204, 21, 0.12)";
    context.lineWidth = 2;
    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);
    context.setLineDash([]);
    context.fillStyle = "#fde68a";
    context.font = "12px system-ui, sans-serif";
    context.fillText(region.label, left + 4, top - 6);
    context.restore();
  }
  if (guide.yawDeg !== undefined && pose !== null) {
    const target = degrees(guide.yawDeg);
    context.save();
    context.setLineDash([8, 6]);
    context.strokeStyle = GUIDE_COLOR;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(screenX(view, pose.x), screenY(view, pose.y));
    context.lineTo(
      screenX(view, pose.x + 1.2 * Math.cos(target)),
      screenY(view, pose.y + 1.2 * Math.sin(target))
    );
    context.stroke();
    context.restore();
  }
  if (guide.sectorDeg !== undefined && pose !== null) {
    const sector = degrees(guide.sectorDeg);
    const origin = state.scan?.pose ?? pose;
    context.save();
    context.fillStyle = "rgba(250, 204, 21, 0.18)";
    context.strokeStyle = "rgba(250, 204, 21, 0.8)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(screenX(view, origin.x), screenY(view, origin.y));
    for (let index = 0; index <= 12; index += 1) {
      const angle = origin.yaw - sector + (2 * sector * index) / 12;
      context.lineTo(
        screenX(view, origin.x + 2 * Math.cos(angle)),
        screenY(view, origin.y + 2 * Math.sin(angle))
      );
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }
}

function drawScan(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState
) {
  const scan = state.scan;
  const pose = state.pose;
  if (!state.showLidar || scan === null || pose === null) {
    return;
  }
  const origin = scan.pose ?? pose;
  context.fillStyle = "rgba(96, 165, 250, 0.9)";
  for (let index = 0; index < scan.ranges.length; index += 1) {
    const range = scan.ranges[index];
    if (range === null || range < scan.range_min || range > scan.range_max) {
      continue;
    }
    const angle = origin.yaw + scan.angle_min + index * scan.angle_increment;
    context.beginPath();
    context.arc(
      screenX(view, origin.x + range * Math.cos(angle)),
      screenY(view, origin.y + range * Math.sin(angle)),
      Math.max(1.5, 0.03 * view.scale),
      0,
      Math.PI * 2
    );
    context.fill();
  }
}

function drawRobot(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState
) {
  const pose = state.pose;
  if (pose === null) {
    return;
  }
  context.save();
  context.translate(screenX(view, pose.x), screenY(view, pose.y));
  context.rotate(-pose.yaw);
  context.scale(view.scale, -view.scale);
  context.fillStyle = "#60a5fa";
  context.strokeStyle = "#bfdbfe";
  context.lineWidth = 1.5 / view.scale;
  context.beginPath();
  context.moveTo(0.32, 0);
  context.lineTo(-0.2, 0.18);
  context.lineTo(-0.2, -0.18);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

export function drawDynamic(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState
) {
  drawGuides(context, view, state);
  drawScan(context, view, state);
  drawRobot(context, view, state);
}
