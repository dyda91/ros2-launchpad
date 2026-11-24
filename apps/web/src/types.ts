export interface CourseExample {
  command: string;
}

export type SessionPhase =
  | "idle"
  | "preparing"
  | "ready"
  | "full"
  | "error"
  | "expired"
  | "invite_required"
  | "pilot_paused"
  | "pilot_closed";

export type PilotState = "disabled" | "open" | "paused" | "closed";

export interface SessionLifecycle {
  idle_expires_in: number;
  hard_expires_in: number;
  warning: boolean;
}

export interface SessionStatus {
  state: SessionPhase;
  stage?: string;
  error?: string | null;
  pilot_state?: PilotState;
  active?: number;
  max?: number;
  session_tag?: string;
  progress?: MissionProgress;
  lifecycle?: SessionLifecycle;
}

export interface PoseSnapshot {
  x: number;
  y: number;
  yaw: number;
}

export interface MissionProgress {
  version: 3;
  stepIndex: number;
  taskIndex: number;
  taskDone: boolean;
  selected: number | null;
  answerWrong: boolean;
  hintsShown: number;
  solutionVisible: boolean;
  taskStart: PoseSnapshot | null;
}

export interface ScanData {
  frame_id: string;
  angle_min: number;
  angle_increment: number;
  range_min: number;
  range_max: number;
  ranges: (number | null)[];
  stamp: number;
  pose?: {
    x: number;
    y: number;
    yaw: number;
    stamp: number;
  } | null;
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

export type ObstacleKind = "crate" | "rack" | "pillar";

export interface BoxObstacle {
  id: string;
  type: "box";
  kind: ObstacleKind;
  center: [number, number];
  size: [number, number, number];
}

export interface CylinderObstacle {
  id: string;
  type: "cylinder";
  kind: ObstacleKind;
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

export interface CourseRegion {
  label: string;
  min: [number, number];
  max: [number, number];
}

export type TaskKind =
  | "command"
  | "answer"
  | "quiz"
  | "pose"
  | "scan"
  | "delivery";

export interface MissionTask {
  id: string;
  kind: TaskKind;
  title: string;
  prompt: string;
  insertCommand?: string;
  observe?: string;
  hints: string[];
  solution?: string[];
  feedback: string;
  match?: string[];
  requireSuccess?: boolean;
  accept?: string[];
  numeric?: { value: number; tolerance: number };
  placeholder?: string;
  question?: MissionQuestion;
  direction?: "forward" | "backward";
  minDistanceM?: number;
  region?: CourseRegion;
  yawDeg?: number;
  yawToleranceDeg?: number;
  minRotationDeg?: number;
  sectorDeg?: number;
  minM?: number;
  maxM?: number;
  strategy?: string[];
  solutionNote?: string;
}

export interface LearnedCommand {
  command: string;
  meaning: string;
}

export interface MissionStep {
  id: string;
  title: string;
  goal: string;
  concept: string;
  why: string;
  example: string[];
  learned: LearnedCommand[];
  tasks: MissionTask[];
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

export interface CourseGuide {
  region?: CourseRegion;
  yawDeg?: number;
  sectorDeg?: number;
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

export interface TerminalCommand {
  seq: number;
  command: string;
  exit: number;
  receivedAt: number;
}

export interface InsertResult {
  ok: boolean;
  reason: string;
}
