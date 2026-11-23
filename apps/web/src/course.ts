import type {
  CourseGuide,
  LearnedCommand,
  MissionContent,
  MissionProgress,
  MissionTask,
  Pose,
  PoseSnapshot,
  ScanData,
  TerminalCommand
} from "./types";

export const STOP_LINEAR_MPS = 0.02;
export const STOP_ANGULAR_RPS = 0.05;
export const HOLD_MS = 600;

export type CommandVerdict = "match" | "error" | "other";

export interface Criterion {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

export function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function formatNumber(value: number, digits = 2) {
  return value.toFixed(digits).replace(".", ",");
}

export function normalizeCommand(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).join(" ");
}

export function commandMatches(task: MissionTask, command: string) {
  const normalized = normalizeCommand(command);
  return (task.match ?? []).every((pattern) => {
    try {
      return new RegExp(pattern).test(normalized);
    } catch {
      return false;
    }
  });
}

export function judgeCommand(
  task: MissionTask,
  command: TerminalCommand
): CommandVerdict {
  if (task.kind !== "command" || !commandMatches(task, command.command)) {
    return "other";
  }
  const requireSuccess = task.requireSuccess ?? true;
  if (requireSuccess && command.exit !== 0) {
    return "error";
  }
  return "match";
}

export function normalizeAnswer(text: string) {
  return text.trim().toLowerCase().split(/\s+/).join(" ").replace(/^\/+/, "");
}

export function checkAnswer(task: MissionTask, typed: string) {
  if (task.numeric) {
    const value = Number(typed.trim().replace(",", "."));
    if (!Number.isFinite(value) || typed.trim() === "") {
      return false;
    }
    return Math.abs(value - task.numeric.value) <= task.numeric.tolerance;
  }
  const normalized = normalizeAnswer(typed);
  if (normalized === "") {
    return false;
  }
  return (task.accept ?? []).some(
    (candidate) => normalizeAnswer(candidate) === normalized
  );
}

export function isStopped(pose: Pose | null) {
  return (
    pose !== null &&
    Math.abs(pose.vx) <= STOP_LINEAR_MPS &&
    Math.abs(pose.wz) <= STOP_ANGULAR_RPS
  );
}

export function snapshot(pose: Pose): PoseSnapshot {
  return { x: pose.x, y: pose.y, yaw: pose.yaw };
}

export function poseCriteria(
  task: MissionTask,
  pose: Pose | null,
  start: PoseSnapshot | null
): Criterion[] {
  const criteria: Criterion[] = [];
  if (task.direction && task.minDistanceM !== undefined) {
    const wanted = task.minDistanceM;
    let moved = 0;
    if (pose !== null && start !== null) {
      const projection =
        (pose.x - start.x) * Math.cos(start.yaw) +
        (pose.y - start.y) * Math.sin(start.yaw);
      moved = task.direction === "forward" ? projection : -projection;
    }
    criteria.push({
      id: "distance",
      label:
        task.direction === "forward"
          ? `Avançar ≥ ${formatNumber(wanted)} m`
          : `Recuar ≥ ${formatNumber(wanted)} m`,
      ok: pose !== null && start !== null && moved >= wanted,
      detail:
        start === null
          ? "aguardando a pose inicial"
          : `${formatNumber(Math.max(0, moved))} m`
    });
  }
  if (task.region) {
    const region = task.region;
    const inside =
      pose !== null &&
      pose.x >= region.min[0] &&
      pose.x <= region.max[0] &&
      pose.y >= region.min[1] &&
      pose.y <= region.max[1];
    criteria.push({
      id: "region",
      label: `Dentro da ${region.label}`,
      ok: inside,
      detail:
        pose === null
          ? "sem pose"
          : `x ${formatNumber(pose.x)}, y ${formatNumber(pose.y)}`
    });
  }
  if (task.yawDeg !== undefined && task.yawToleranceDeg !== undefined) {
    const target = toRadians(task.yawDeg);
    const error =
      pose === null ? Infinity : Math.abs(toDegrees(angleDelta(pose.yaw, target)));
    criteria.push({
      id: "yaw",
      label: `Yaw ${task.yawDeg}° ± ${task.yawToleranceDeg}°`,
      ok: error <= task.yawToleranceDeg,
      detail:
        pose === null ? "sem pose" : `${formatNumber(toDegrees(pose.yaw), 0)}°`
    });
  }
  if (task.minRotationDeg !== undefined) {
    const rotated =
      pose === null || start === null
        ? 0
        : Math.abs(toDegrees(angleDelta(pose.yaw, start.yaw)));
    criteria.push({
      id: "rotation",
      label: `Girar ≥ ${task.minRotationDeg}°`,
      ok: start !== null && rotated >= task.minRotationDeg,
      detail: start === null ? "aguardando a pose inicial" : `${formatNumber(rotated, 0)}°`
    });
  }
  criteria.push(stoppedCriterion(pose));
  return criteria;
}

function stoppedCriterion(pose: Pose | null): Criterion {
  return {
    id: "stopped",
    label: "Robô parado",
    ok: isStopped(pose),
    detail:
      pose === null
        ? "sem pose"
        : `v ${formatNumber(Math.abs(pose.vx))} m/s, ω ${formatNumber(Math.abs(pose.wz))} rad/s`
  };
}

export function frontReading(scan: ScanData | null, sectorDeg: number) {
  if (scan === null) {
    return null;
  }
  const sector = toRadians(sectorDeg);
  let best: number | null = null;
  scan.ranges.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      return;
    }
    if (value < scan.range_min || value > scan.range_max) {
      return;
    }
    const angle = scan.angle_min + index * scan.angle_increment;
    if (Math.abs(angleDelta(angle, 0)) > sector) {
      return;
    }
    if (best === null || value < best) {
      best = value;
    }
  });
  return best;
}

export function scanCriteria(
  task: MissionTask,
  scan: ScanData | null,
  pose: Pose | null
): Criterion[] {
  const sector = task.sectorDeg ?? 10;
  const low = task.minM ?? 0;
  const high = task.maxM ?? Infinity;
  const reading = frontReading(scan, sector);
  return [
    {
      id: "front",
      label: `Frente entre ${formatNumber(low)} e ${formatNumber(high)} m`,
      ok: reading !== null && reading >= low && reading <= high,
      detail:
        scan === null
          ? "aguardando o LiDAR"
          : reading === null
            ? "nada no setor frontal"
            : `${formatNumber(reading)} m`
    },
    stoppedCriterion(pose)
  ];
}

export function needsStart(task: MissionTask) {
  return (
    task.kind === "pose" &&
    (task.direction !== undefined || task.minRotationDeg !== undefined)
  );
}

export function guideFor(task: MissionTask | null): CourseGuide | null {
  if (task === null) {
    return null;
  }
  if (task.kind === "pose") {
    const guide: CourseGuide = {};
    if (task.region) {
      guide.region = task.region;
    }
    if (task.yawDeg !== undefined) {
      guide.yawDeg = task.yawDeg;
    }
    return guide.region || guide.yawDeg !== undefined ? guide : null;
  }
  if (task.kind === "scan") {
    return { sectorDeg: task.sectorDeg ?? 10 };
  }
  return null;
}

export function freshProgress(stepIndex = 0, taskIndex = 0): MissionProgress {
  return {
    version: 3,
    stepIndex,
    taskIndex,
    taskDone: false,
    selected: null,
    answerWrong: false,
    hintsShown: 0,
    solutionVisible: false,
    taskStart: null
  };
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

export function restoreProgress(
  mission: MissionContent,
  initial: unknown
): MissionProgress {
  if (typeof initial !== "object" || initial === null) {
    return freshProgress();
  }
  const raw = initial as Record<string, unknown>;
  if (raw.version !== 3) {
    return freshProgress();
  }
  const stepIndex = raw.stepIndex;
  const taskIndex = raw.taskIndex;
  if (
    typeof stepIndex !== "number" ||
    typeof taskIndex !== "number" ||
    !Number.isInteger(stepIndex) ||
    !Number.isInteger(taskIndex) ||
    stepIndex < 0 ||
    stepIndex >= mission.steps.length ||
    taskIndex < 0 ||
    taskIndex >= mission.steps[stepIndex].tasks.length
  ) {
    return freshProgress();
  }
  const task = mission.steps[stepIndex].tasks[taskIndex];
  const start = raw.taskStart as Record<string, unknown> | null | undefined;
  const hints = typeof raw.hintsShown === "number" ? raw.hintsShown : 0;
  return {
    version: 3,
    stepIndex,
    taskIndex,
    taskDone: raw.taskDone === true && task.kind !== "delivery",
    selected: typeof raw.selected === "number" ? raw.selected : null,
    answerWrong: raw.answerWrong === true,
    hintsShown: Math.max(0, Math.min(hints, task.hints.length)),
    solutionVisible: raw.solutionVisible === true,
    taskStart:
      start && finiteNumber(start.x) && finiteNumber(start.y) && finiteNumber(start.yaw)
        ? { x: start.x as number, y: start.y as number, yaw: start.yaw as number }
        : null
  };
}

export function nextPosition(
  mission: MissionContent,
  stepIndex: number,
  taskIndex: number
) {
  const step = mission.steps[stepIndex];
  if (taskIndex + 1 < step.tasks.length) {
    return { stepIndex, taskIndex: taskIndex + 1, newStep: false };
  }
  if (stepIndex + 1 < mission.steps.length) {
    return { stepIndex: stepIndex + 1, taskIndex: 0, newStep: true };
  }
  return null;
}

export function totalTasks(mission: MissionContent) {
  return mission.steps.reduce((sum, step) => sum + step.tasks.length, 0);
}

export function completedTasks(
  mission: MissionContent,
  progress: Pick<MissionProgress, "stepIndex" | "taskIndex" | "taskDone">
) {
  const before = mission.steps
    .slice(0, progress.stepIndex)
    .reduce((sum, step) => sum + step.tasks.length, 0);
  return before + progress.taskIndex + (progress.taskDone ? 1 : 0);
}

export function learnedUpTo(
  mission: MissionContent,
  stepIndex: number
): LearnedCommand[] {
  const seen = new Set<string>();
  const result: LearnedCommand[] = [];
  for (const step of mission.steps.slice(0, stepIndex + 1)) {
    for (const item of step.learned) {
      if (seen.has(item.command)) {
        continue;
      }
      seen.add(item.command);
      result.push(item);
    }
  }
  return result;
}

export const kindLabels: Record<MissionTask["kind"], string> = {
  command: "Comando",
  answer: "Descubra e responda",
  quiz: "Pergunta",
  pose: "Movimento",
  scan: "Sensor",
  delivery: "Entrega"
};
