import { screenX, screenY, type View } from "./camera";
import { drawHud } from "./hud";
import { drawScan, drawSector } from "./lidarDraw";
import { drawRobot, drawTf, drawVelocity } from "./robotDraw";
import type { ViewerState } from "./state";

const GUIDE_COLOR = "#facc15";
const TRAIL_SECONDS = 30;

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
}

function drawZoneState(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState,
  now: number
) {
  const status = state.missionStatus;
  if (status === null || (!status.inZone && !status.delivered)) {
    return;
  }
  const bounds = state.map.zone.bounds;
  const left = screenX(view, bounds.min[0]);
  const top = screenY(view, bounds.max[1]);
  const width = (bounds.max[0] - bounds.min[0]) * view.scale;
  const height = (bounds.max[1] - bounds.min[1]) * view.scale;
  const pulse = 0.5 + 0.5 * Math.sin(now / 280);
  context.save();
  context.fillStyle = status.delivered
    ? `rgba(34, 197, 94, ${0.3 + pulse * 0.12})`
    : `rgba(34, 197, 94, ${0.14 + pulse * 0.1})`;
  context.fillRect(left, top, width, height);
  context.strokeStyle = status.delivered ? "#bbf7d0" : "#4ade80";
  context.shadowColor = "#22c55e";
  context.shadowBlur = status.delivered ? 18 : 10;
  context.lineWidth = status.delivered ? 4 : 3;
  context.strokeRect(left, top, width, height);
  context.shadowBlur = 0;
  context.fillStyle = "#f0fdf4";
  context.font = "700 13px system-ui, sans-serif";
  context.textBaseline = "bottom";
  context.fillText(
    status.delivered ? "ENTREGUE ✓" : "NA ZONA",
    left + 8,
    top + height - 8
  );
  context.restore();
}

function drawTrail(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState,
  now: number
) {
  const points = state.trail;
  if (points.length < 2) {
    return;
  }
  const buckets = 6;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2.5;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    context.beginPath();
    let open = false;
    for (let index = 1; index < points.length; index += 1) {
      const age = (now - points[index].t) / (TRAIL_SECONDS * 1000);
      const slot = Math.min(buckets - 1, Math.max(0, Math.floor((1 - age) * buckets)));
      if (slot !== bucket || age > 1) {
        open = false;
        continue;
      }
      const previous = points[index - 1];
      if (!open) {
        context.moveTo(screenX(view, previous.x), screenY(view, previous.y));
        open = true;
      }
      context.lineTo(screenX(view, points[index].x), screenY(view, points[index].y));
    }
    context.strokeStyle = `rgba(56, 189, 248, ${0.12 + (bucket / (buckets - 1)) * 0.78})`;
    context.stroke();
  }
  context.restore();
}

export function drawDynamic(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState,
  now: number
) {
  drawZoneState(context, view, state, now);
  if (state.layers.trail) {
    drawTrail(context, view, state, now);
  }
  drawGuides(context, view, state);
  drawScan(context, view, state);
  drawSector(context, view, state);
  if (state.layers.tf) {
    drawTf(context, view, state.pose);
  }
  if (state.pose !== null) {
    drawRobot(context, view, state.pose);
    if (state.layers.velocity) {
      drawVelocity(context, view, state.pose);
    }
  }
  drawHud(context, view);
}
