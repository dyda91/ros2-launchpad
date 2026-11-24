import type { MapData } from "../types";
import { worldBounds } from "./camera";
import {
  drawFloorBase,
  drawGrid,
  drawJoints,
  drawLanes,
  drawWallShadow,
  drawWalls,
  drawZebra
} from "./floor";
import { makeGeo } from "./geo";
import { drawObstacles, drawShadows, drawZone } from "./obstacles";

export interface StaticOptions {
  grid: boolean;
  markings: boolean;
}

export function renderStatic(
  map: MapData,
  pixelsPerMeter: number,
  options: StaticOptions
) {
  const bounds = worldBounds(map);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((bounds.maxX - bounds.minX) * pixelsPerMeter);
  canvas.height = Math.ceil((bounds.maxY - bounds.minY) * pixelsPerMeter);
  const context = canvas.getContext("2d");
  if (context === null) {
    return canvas;
  }
  const geo = makeGeo(map, pixelsPerMeter);
  drawFloorBase(context, map, geo);
  if (options.markings) {
    drawJoints(context, map, geo);
    drawLanes(context, map, geo);
    drawZebra(context, map, geo);
  }
  drawWallShadow(context, map, geo);
  if (options.grid) {
    drawGrid(context, map, geo);
  }
  drawZone(context, map, geo);
  drawShadows(context, map, geo);
  drawObstacles(context, map, geo);
  drawWalls(context, map, geo);
  return canvas;
}
