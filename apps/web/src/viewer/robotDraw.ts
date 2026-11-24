import { ROBOT } from "../robot";
import type { Pose } from "../types";
import { screenX, screenY, type View } from "./camera";
import { roundedRect } from "./geo";

const AXIS_X = "#ef4444";
const AXIS_Y = "#22c55e";

function pixels(view: View, count: number) {
  return count / view.scale;
}

function label(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string
) {
  context.save();
  context.font = "600 11px system-ui, sans-serif";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(8, 13, 18, 0.85)";
  context.strokeText(text, x, y);
  context.fillStyle = color;
  context.fillText(text, x, y);
  context.restore();
}

export function drawRobot(
  context: CanvasRenderingContext2D,
  view: View,
  pose: Pose
) {
  context.save();
  context.translate(screenX(view, pose.x), screenY(view, pose.y));
  context.rotate(-pose.yaw);
  context.scale(view.scale, -view.scale);

  const glow = context.createRadialGradient(0, 0, 0.1, 0, 0, 0.6);
  glow.addColorStop(0, "rgba(56, 189, 248, 0.32)");
  glow.addColorStop(1, "rgba(56, 189, 248, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(0, 0, 0.6, 0, Math.PI * 2);
  context.fill();

  const halfSeparation = ROBOT.wheelSeparation / 2;
  context.lineWidth = pixels(view, 1);
  for (const side of [-1, 1]) {
    context.fillStyle = "#06090d";
    context.strokeStyle = "#94a3b8";
    context.beginPath();
    context.rect(
      -ROBOT.wheelRadius,
      side * halfSeparation - ROBOT.wheelWidth / 2,
      ROBOT.wheelRadius * 2,
      ROBOT.wheelWidth
    );
    context.fill();
    context.stroke();
    context.strokeStyle = "rgba(148, 163, 184, 0.55)";
    for (let step = -3; step <= 3; step += 1) {
      const x = (step / 3.4) * ROBOT.wheelRadius;
      context.beginPath();
      context.moveTo(x, side * halfSeparation - ROBOT.wheelWidth / 2);
      context.lineTo(x, side * halfSeparation + ROBOT.wheelWidth / 2);
      context.stroke();
    }
  }

  context.fillStyle = "#cbd5e1";
  context.strokeStyle = "#0f172a";
  for (const side of [-1, 1]) {
    context.beginPath();
    context.arc(side * ROBOT.casterOffsetX, 0, ROBOT.casterRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  const length = ROBOT.chassisLength;
  const width = ROBOT.chassisWidth;
  const body = context.createLinearGradient(0, width / 2, 0, -width / 2);
  body.addColorStop(0, "#3b82f6");
  body.addColorStop(1, "#1d4ed8");
  context.fillStyle = body;
  roundedRect(context, -length / 2, -width / 2, length, width, 0.05);
  context.fill();
  context.lineWidth = pixels(view, 2);
  context.strokeStyle = "#e0f2fe";
  context.stroke();

  context.fillStyle = "#22d3ee";
  roundedRect(context, length / 2 - 0.07, -width / 2 + 0.03, 0.07, width - 0.06, 0.03);
  context.fill();
  context.fillStyle = "#fef08a";
  for (const side of [-1, 1]) {
    context.beginPath();
    context.arc(length / 2 - 0.03, side * (width / 2 - 0.045), 0.018, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = "#f8fafc";
  context.lineWidth = pixels(view, 2);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(0.04, 0.085);
  context.lineTo(0.15, 0);
  context.lineTo(0.04, -0.085);
  context.stroke();

  context.fillStyle = "#ef4444";
  context.strokeStyle = "#fecaca";
  context.lineWidth = pixels(view, 1.2);
  context.beginPath();
  context.arc(0, 0, ROBOT.lidarRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(ROBOT.lidarRadius, 0);
  context.stroke();
  context.restore();
}

function drawAxes(
  context: CanvasRenderingContext2D,
  view: View,
  x: number,
  y: number,
  yaw: number,
  length: number,
  name: string
) {
  const width = Math.max(2, view.scale * 0.022);
  context.save();
  context.translate(screenX(view, x), screenY(view, y));
  context.rotate(-yaw);
  context.scale(view.scale, -view.scale);
  context.lineCap = "round";
  const head = 0.07;
  for (const [angle, color] of [
    [0, AXIS_X],
    [Math.PI / 2, AXIS_Y]
  ] as const) {
    context.save();
    context.rotate(angle);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = width / view.scale;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(length - head * 0.6, 0);
    context.stroke();
    context.beginPath();
    context.moveTo(length, 0);
    context.lineTo(length - head, head * 0.45);
    context.lineTo(length - head, -head * 0.45);
    context.closePath();
    context.fill();
    context.restore();
  }
  context.restore();
  label(
    context,
    "x",
    screenX(view, x + (length + 0.06) * Math.cos(yaw)) - 3,
    screenY(view, y + (length + 0.06) * Math.sin(yaw)) + 4,
    AXIS_X
  );
  label(
    context,
    "y",
    screenX(view, x + (length + 0.06) * Math.cos(yaw + Math.PI / 2)) - 3,
    screenY(view, y + (length + 0.06) * Math.sin(yaw + Math.PI / 2)) + 4,
    AXIS_Y
  );
  label(
    context,
    name,
    screenX(view, x) + 8,
    screenY(view, y) + 16,
    "#e2e8f0"
  );
}

export function drawTf(
  context: CanvasRenderingContext2D,
  view: View,
  pose: Pose | null
) {
  drawAxes(context, view, 0, 0, 0, 0.5, "odom");
  if (pose === null) {
    return;
  }
  context.save();
  context.setLineDash([5, 4]);
  context.strokeStyle = "rgba(253, 224, 71, 0.75)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(screenX(view, 0), screenY(view, 0));
  context.lineTo(screenX(view, pose.x), screenY(view, pose.y));
  context.stroke();
  context.restore();
  drawAxes(context, view, pose.x, pose.y, pose.yaw, 0.32, "base_link");
}

export function drawVelocity(
  context: CanvasRenderingContext2D,
  view: View,
  pose: Pose
) {
  const linear = pose.vx;
  const angular = pose.wz;
  context.save();
  context.translate(screenX(view, pose.x), screenY(view, pose.y));
  context.rotate(-pose.yaw);
  context.scale(view.scale, -view.scale);
  context.lineCap = "round";
  context.lineJoin = "round";
  if (Math.abs(linear) > 0.01) {
    const direction = Math.sign(linear);
    const startX = direction * (ROBOT.chassisLength / 2 + 0.03);
    const reach = Math.min(0.9, Math.abs(linear) * 1.6);
    const endX = startX + direction * reach;
    context.strokeStyle = "#f472b6";
    context.fillStyle = "#f472b6";
    context.lineWidth = pixels(view, 3);
    context.beginPath();
    context.moveTo(startX, 0);
    context.lineTo(endX - direction * 0.05, 0);
    context.stroke();
    context.beginPath();
    context.moveTo(endX, 0);
    context.lineTo(endX - direction * 0.11, 0.06);
    context.lineTo(endX - direction * 0.11, -0.06);
    context.closePath();
    context.fill();
  }
  if (Math.abs(angular) > 0.03) {
    const span = Math.max(-2.2, Math.min(2.2, angular * 0.9));
    const radius = 0.42;
    context.strokeStyle = "#fb923c";
    context.fillStyle = "#fb923c";
    context.lineWidth = pixels(view, 3);
    context.beginPath();
    context.arc(0, 0, radius, 0, span, span < 0);
    context.stroke();
    const tipX = radius * Math.cos(span);
    const tipY = radius * Math.sin(span);
    const tangent = span + (span > 0 ? Math.PI / 2 : -Math.PI / 2);
    context.beginPath();
    context.moveTo(tipX + 0.07 * Math.cos(tangent), tipY + 0.07 * Math.sin(tangent));
    context.lineTo(
      tipX + 0.06 * Math.cos(tangent + 2.5),
      tipY + 0.06 * Math.sin(tangent + 2.5)
    );
    context.lineTo(
      tipX + 0.06 * Math.cos(tangent - 2.5),
      tipY + 0.06 * Math.sin(tangent - 2.5)
    );
    context.closePath();
    context.fill();
  }
  context.restore();
  if (Math.abs(linear) > 0.01 || Math.abs(angular) > 0.03) {
    label(
      context,
      `v ${linear.toFixed(2)} m/s  ω ${angular.toFixed(2)} rad/s`,
      screenX(view, pose.x) + 22,
      screenY(view, pose.y) - 22,
      "#fbcfe8"
    );
  }
}
