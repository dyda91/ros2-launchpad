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

export interface MissionQuestion {
  prompt: string;
  options: string[];
  answerIndex: number;
}

export interface MissionStep {
  id: string;
  kind: "quiz" | "motion" | "delivery";
  title: string;
  concept: string;
  action: string;
  observe?: string;
  insertCommand?: string;
  hints: string[];
  feedback?: string;
  question?: MissionQuestion;
  prediction?: MissionQuestion;
  command?: string;
  minDisplacementM?: number;
  stopSpeedMps?: number;
  solution?: string[];
  solutionStart?: {
    x: number;
    y: number;
    yaw: number;
    tolerance: number;
  };
  hintsNote?: string;
}

export interface MissionContent {
  id: string;
  version: number;
  title: string;
  intro: string;
  steps: MissionStep[];
  success: {
    title: string;
    body: string;
    hook: string;
  };
}

export interface MissionStatus {
  zoneId: string;
  inZone: boolean;
  speedMps: number;
  angularSpeedRps: number;
  stoppedForS: number;
  delivered: boolean;
  pose: { x: number; y: number } | null;
}

export interface TerminalState {
  prompt: boolean;
  lineEmpty: boolean;
  running: boolean;
}

export interface InsertResult {
  ok: boolean;
  reason: string;
}
