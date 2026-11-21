export type SessionPhase =
  | "idle"
  | "preparing"
  | "ready"
  | "full"
  | "error";

export interface SessionStatus {
  state: SessionPhase;
  stage?: string;
  error?: string | null;
}

export interface Pose {
  type?: string;
  x: number;
  y: number;
  yaw: number;
  vx: number;
  wz: number;
  stamp: number;
}

export interface BoxObstacle {
  id: string;
  type: "box";
  center: [number, number];
  size: [number, number, number];
}

export interface CylinderObstacle {
  id: string;
  type: "cylinder";
  center: [number, number];
  radius: number;
  height: number;
}

export type Obstacle = BoxObstacle | CylinderObstacle;

export interface MapData {
  version: number;
  name: string;
  world: string;
  frame: string;
  warehouse: {
    floor: {
      min: [number, number];
      max: [number, number];
      thickness: number;
      size: [number, number];
    };
    wall_height: number;
    wall_thickness: number;
  };
  spawn: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  zone: {
    id: string;
    center: [number, number];
    size: [number, number];
    bounds: {
      min: [number, number];
      max: [number, number];
    };
  };
  obstacles: Obstacle[];
}
