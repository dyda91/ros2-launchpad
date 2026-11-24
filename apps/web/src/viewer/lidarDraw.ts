import { frontReading } from "../course";
import { screenX, screenY, type View } from "./camera";
import type { ScanFrame, ViewerState } from "./state";

const STOPS: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37]
];

export function rangeColor(range: number, rangeMax: number) {
  const fraction = Math.min(1, Math.max(0, range / rangeMax));
  const position = (1 - fraction * 0.8) * (STOPS.length - 1);
  const low = Math.min(STOPS.length - 2, Math.floor(position));
  const mix = position - low;
  const a = STOPS[low];
  const b = STOPS[low + 1];
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

export function rangeGradient() {
  const parts: string[] = [];
  for (let step = 0; step <= 8; step += 1) {
    parts.push(`${rangeColor((step / 8) * 8, 8)} ${(step / 8) * 100}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

function drawFrame(
  context: CanvasRenderingContext2D,
  view: View,
  frame: ScanFrame,
  alpha: number,
  radius: number
) {
  const count = frame.points.length / 3;
  context.globalAlpha = alpha;
  for (let index = 0; index < count; index += 1) {
    const x = screenX(view, frame.points[index * 3]);
    const y = screenY(view, frame.points[index * 3 + 1]);
    context.fillStyle = "rgba(248, 250, 252, 0.9)";
    context.beginPath();
    context.arc(x, y, radius + 1.1, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = rangeColor(frame.points[index * 3 + 2], frame.rangeMax);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

export function drawScan(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState
) {
  if (!state.showLidar || state.frames.length === 0) {
    return;
  }
  const frames = state.frames.slice(-state.persistence);
  const radius = Math.max(1.8, 0.03 * view.scale);
  context.save();
  if (state.layers.rays) {
    const newest = frames[frames.length - 1];
    context.strokeStyle = "rgba(186, 230, 253, 0.16)";
    context.lineWidth = 1;
    context.beginPath();
    const count = newest.points.length / 3;
    for (let index = 0; index < count; index += 1) {
      context.moveTo(screenX(view, newest.originX), screenY(view, newest.originY));
      context.lineTo(
        screenX(view, newest.points[index * 3]),
        screenY(view, newest.points[index * 3 + 1])
      );
    }
    context.stroke();
  }
  frames.forEach((frame, index) => {
    const age = frames.length - 1 - index;
    const alpha = age === 0 ? 1 : Math.max(0.12, 0.55 * (1 - age / frames.length));
    drawFrame(context, view, frame, alpha, radius);
  });
  context.restore();
}

export function drawSector(
  context: CanvasRenderingContext2D,
  view: View,
  state: ViewerState
) {
  const guided = state.guide?.sectorDeg;
  const visible =
    guided !== undefined || (state.showLidar && state.layers.sector);
  const pose = state.pose;
  if (!visible || pose === null) {
    return;
  }
  const degrees = guided ?? 10;
  const sector = (degrees * Math.PI) / 180;
  const origin = state.scan?.pose ?? pose;
  const reading = state.scan === null ? null : frontReading(state.scan, degrees);
  const reach = reading === null ? 1.5 : Math.min(2.2, reading + 0.25);
  const fill = guided !== undefined ? "rgba(250, 204, 21, 0.2)" : "rgba(56, 189, 248, 0.14)";
  const stroke = guided !== undefined ? "rgba(250, 204, 21, 0.9)" : "rgba(56, 189, 248, 0.75)";
  context.save();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(screenX(view, origin.x), screenY(view, origin.y));
  for (let step = 0; step <= 14; step += 1) {
    const angle = origin.yaw - sector + (2 * sector * step) / 14;
    context.lineTo(
      screenX(view, origin.x + reach * Math.cos(angle)),
      screenY(view, origin.y + reach * Math.sin(angle))
    );
  }
  context.closePath();
  context.fill();
  context.stroke();
  if (reading !== null) {
    const tipX = screenX(view, origin.x + reading * Math.cos(origin.yaw));
    const tipY = screenY(view, origin.y + reading * Math.sin(origin.yaw));
    context.beginPath();
    context.arc(tipX, tipY, 4, 0, Math.PI * 2);
    context.fillStyle = "#f8fafc";
    context.fill();
    context.stroke();
    const text = `${reading.toFixed(2).replace(".", ",")} m`;
    context.font = "700 12px system-ui, sans-serif";
    context.lineWidth = 3;
    context.strokeStyle = "rgba(8, 13, 18, 0.9)";
    context.strokeText(text, tipX + 8, tipY - 6);
    context.fillStyle = "#f8fafc";
    context.fillText(text, tipX + 8, tipY - 6);
  }
  context.restore();
}
