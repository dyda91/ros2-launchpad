import type { MapData } from "../types";

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface View {
  width: number;
  height: number;
  scale: number;
  centerX: number;
  centerY: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
export const VIEW_PADDING = 28;

export function worldBounds(map: MapData): WorldBounds {
  const floor = map.warehouse.floor;
  const wall = map.warehouse.wall_thickness;
  return {
    minX: floor.min[0] - wall,
    maxX: floor.max[0] + wall,
    minY: floor.min[1] - wall,
    maxY: floor.max[1] + wall
  };
}

export function baseScale(bounds: WorldBounds, width: number, height: number) {
  const usableX = Math.max(1, width - VIEW_PADDING * 2);
  const usableY = Math.max(1, height - VIEW_PADDING * 2);
  return Math.min(
    usableX / (bounds.maxX - bounds.minX),
    usableY / (bounds.maxY - bounds.minY)
  );
}

export function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

export function makeView(
  bounds: WorldBounds,
  width: number,
  height: number,
  zoom: number,
  centerX: number,
  centerY: number
): View {
  return {
    width,
    height,
    scale: baseScale(bounds, width, height) * zoom,
    centerX,
    centerY
  };
}

export function screenX(view: View, x: number) {
  return view.width / 2 + (x - view.centerX) * view.scale;
}

export function screenY(view: View, y: number) {
  return view.height / 2 - (y - view.centerY) * view.scale;
}

export function worldX(view: View, sx: number) {
  return view.centerX + (sx - view.width / 2) / view.scale;
}

export function worldY(view: View, sy: number) {
  return view.centerY - (sy - view.height / 2) / view.scale;
}

export function clampPan(
  bounds: WorldBounds,
  panX: number,
  panY: number
): [number, number] {
  const limitX = (bounds.maxX - bounds.minX) / 2 + 0.5;
  const limitY = (bounds.maxY - bounds.minY) / 2 + 0.5;
  return [
    Math.min(limitX, Math.max(-limitX, panX)),
    Math.min(limitY, Math.max(-limitY, panY))
  ];
}

export function pickLevel(pixelsPerMeter: number) {
  const levels = [60, 120, 240, 400];
  for (const level of levels) {
    if (pixelsPerMeter <= level) {
      return level;
    }
  }
  return levels[levels.length - 1];
}
