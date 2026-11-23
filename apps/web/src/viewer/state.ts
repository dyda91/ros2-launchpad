import type {
  CourseGuide,
  MapData,
  MissionStatus,
  Pose,
  ScanData
} from "../types";

export interface Layers {
  grid: boolean;
  tf: boolean;
  scan: boolean;
  trail: boolean;
  velocity: boolean;
  markings: boolean;
  rays: boolean;
  sector: boolean;
}

export const defaultLayers: Layers = {
  grid: true,
  tf: true,
  scan: true,
  trail: true,
  velocity: true,
  markings: true,
  rays: false,
  sector: true
};

export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

export interface ScanFrame {
  stamp: number;
  t: number;
  originX: number;
  originY: number;
  rangeMax: number;
  points: Float32Array;
}

export interface ViewerState {
  map: MapData;
  pose: Pose | null;
  scan: ScanData | null;
  showLidar: boolean;
  zoom: number;
  follow: boolean;
  guide: CourseGuide | null;
  missionStatus: MissionStatus | null;
  layers: Layers;
  persistence: number;
  panX: number;
  panY: number;
  trail: TrailPoint[];
  frames: ScanFrame[];
  cursor: { x: number; y: number } | null;
}
