import type { View } from "./camera";

const CANDIDATES = [0.25, 0.5, 1, 2, 5];

export function drawHud(context: CanvasRenderingContext2D, view: View) {
  let meters = CANDIDATES[0];
  for (const candidate of CANDIDATES) {
    if (candidate * view.scale <= 150) {
      meters = candidate;
    }
  }
  const length = meters * view.scale;
  const left = 16;
  const baseline = view.height - 16;
  context.save();
  context.lineWidth = 3;
  context.strokeStyle = "rgba(8, 13, 18, 0.85)";
  context.beginPath();
  context.moveTo(left, baseline - 5);
  context.lineTo(left, baseline);
  context.lineTo(left + length, baseline);
  context.lineTo(left + length, baseline - 5);
  context.stroke();
  context.lineWidth = 1.6;
  context.strokeStyle = "#e2e8f0";
  context.stroke();
  context.font = "600 11px system-ui, sans-serif";
  context.textBaseline = "bottom";
  const text = `${String(meters).replace(".", ",")} m`;
  context.lineWidth = 3;
  context.strokeStyle = "rgba(8, 13, 18, 0.85)";
  context.strokeText(text, left, baseline - 8);
  context.fillStyle = "#e2e8f0";
  context.fillText(text, left, baseline - 8);

  const centerX = left + 12;
  const tip = baseline - 76;
  context.lineWidth = 3;
  context.strokeStyle = "rgba(8, 13, 18, 0.85)";
  context.beginPath();
  context.moveTo(centerX, baseline - 34);
  context.lineTo(centerX, tip);
  context.moveTo(centerX - 5, tip + 8);
  context.lineTo(centerX, tip);
  context.lineTo(centerX + 5, tip + 8);
  context.stroke();
  context.lineWidth = 1.6;
  context.strokeStyle = "#22c55e";
  context.stroke();
  context.fillStyle = "#bbf7d0";
  context.textBaseline = "bottom";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(8, 13, 18, 0.85)";
  context.strokeText("N (+y)", left - 2, tip - 4);
  context.fillText("N (+y)", left - 2, tip - 4);
  context.restore();
}
