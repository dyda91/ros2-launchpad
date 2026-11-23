import type { MapData } from "../types";
import { worldBounds } from "./camera";

export interface Geo {
  ppm: number;
  px: (x: number) => number;
  py: (y: number) => number;
  len: (meters: number) => number;
}

export function makeGeo(map: MapData, ppm: number): Geo {
  const bounds = worldBounds(map);
  return {
    ppm,
    px: (x) => (x - bounds.minX) * ppm,
    py: (y) => (bounds.maxY - y) * ppm,
    len: (meters) => meters * ppm
  };
}

export function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.closePath();
}
