import { expect, type Locator, type Page } from "@playwright/test";

export type RobotPose = {
  x: number;
  y: number;
  yaw: number;
  speed: number;
};

export type CourseTask = {
  id: string;
  kind: string;
  insertCommand?: string;
  hints: string[];
  solution?: string[];
  accept?: string[];
  question?: { answerIndex: number; options: string[] };
  numeric?: { value: number; tolerance: number };
};

export type CourseMission = {
  steps: { id: string; tasks: CourseTask[] }[];
  success: { hook: string };
};

export async function missionContent(page: Page) {
  return (await (await page.request.get("/api/mission")).json()) as CourseMission;
}

export function findTask(mission: CourseMission, id: string) {
  for (const step of mission.steps) {
    for (const task of step.tasks) {
      if (task.id === id) {
        return task;
      }
    }
  }
  throw new Error(`task ${id} not found`);
}

export async function startSession(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("start-button")).toBeVisible();
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 90_000 }
  );
  await expect(page.getByTestId("mission-panel")).toBeVisible();
  await expect(page.getByTestId("terminal")).toBeVisible();
  await expect(page.getByTestId("robot-pose")).toBeVisible();
  await expect(page.getByTestId("terminal-state")).toHaveAttribute(
    "data-prompt",
    "true",
    { timeout: 30_000 }
  );
}

export async function lastCommandSeq(page: Page) {
  return Number(
    await page.getByTestId("terminal-state").getAttribute("data-last-command-seq")
  );
}

async function waitPrompt(page: Page, timeout = 60_000) {
  const state = page.getByTestId("terminal-state");
  await expect(state).toHaveAttribute("data-running", "false", { timeout });
  await expect(state).toHaveAttribute("data-prompt", "true", { timeout });
  await expect(state).toHaveAttribute("data-line-empty", "true", { timeout });
}

export async function waitCommandAfter(page: Page, before: number, timeout = 60_000) {
  await expect
    .poll(() => lastCommandSeq(page), { timeout })
    .toBeGreaterThan(before);
  await waitPrompt(page, timeout);
}

export async function runCommand(page: Page, command: string, timeout = 60_000) {
  await waitPrompt(page);
  const before = await lastCommandSeq(page);
  await page.getByTestId("focus-terminal").click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await waitCommandAfter(page, before, timeout);
}

export async function insertAndRun(page: Page, preview: Locator) {
  const insert = preview.getByTestId("insert-command");
  await expect(insert).toBeEnabled({ timeout: 30_000 });
  const before = await lastCommandSeq(page);
  await insert.click();
  await page.keyboard.press("Enter");
  await waitCommandAfter(page, before);
}

export async function expectTask(page: Page, taskId: string, timeout = 20_000) {
  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-task",
    taskId,
    { timeout }
  );
}

export async function expectDone(page: Page, timeout = 20_000) {
  await expect(page.getByTestId("task-status")).toHaveAttribute(
    "data-done",
    "true",
    { timeout }
  );
}

export async function goNext(page: Page) {
  await page.getByTestId("next-task").click();
}

export async function answer(page: Page, text: string) {
  const input = page.getByTestId("answer-input");
  await input.fill(text);
  await page.getByTestId("answer-submit").click();
}

export async function robotPose(page: Page): Promise<RobotPose> {
  const robot = page.getByTestId("robot-pose");
  return {
    x: Number(await robot.getAttribute("data-x")),
    y: Number(await robot.getAttribute("data-y")),
    yaw: Number(await robot.getAttribute("data-yaw")),
    speed: Number(await robot.getAttribute("data-speed"))
  };
}

export async function waitStopped(page: Page) {
  await expect
    .poll(async () => (await robotPose(page)).speed, { timeout: 15_000 })
    .toBeLessThan(0.02);
  await page.waitForTimeout(800);
}

export function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function twist(times: number, linear: number, angular: number) {
  return `ros2 topic pub --rate 10 --times ${times} /cmd_vel geometry_msgs/msg/Twist "{linear: {x: ${linear}}, angular: {z: ${angular}}}"`;
}

async function publish(page: Page, times: number, linear: number, angular: number) {
  await runCommand(page, twist(times, linear, angular));
  await waitStopped(page);
}

export async function rotateTo(page: Page, target: number, tolerance = 0.07) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const error = wrap(target - (await robotPose(page)).yaw);
    if (Math.abs(error) <= tolerance) {
      return;
    }
    let done = false;
    for (const speed of [0.8, 0.3, 0.1]) {
      const times = Math.round((Math.abs(error) / speed - 0.5) * 10);
      if (times >= 1) {
        await publish(page, times, 0, Math.sign(error) * speed);
        done = true;
        break;
      }
    }
    if (!done) {
      return;
    }
  }
  throw new Error(`rotation to ${target} did not converge`);
}

export async function driveTo(page: Page, x: number, y: number, tolerance = 0.1) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await robotPose(page);
    const dx = x - current.x;
    const dy = y - current.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= tolerance) {
      return;
    }
    const heading = Math.atan2(dy, dx);
    if (distance > 0.2 && Math.abs(wrap(heading - current.yaw)) > 0.06) {
      await rotateTo(page, heading, 0.04);
      continue;
    }
    const along = Math.min(1.2, distance * Math.cos(wrap(heading - current.yaw)));
    if (along <= 0.05) {
      return;
    }
    const speed = along > 0.5 ? 0.3 : 0.15;
    const times = Math.max(1, Math.round((along / speed - 0.2) * 10));
    await publish(page, times, speed, 0);
  }
  throw new Error(`drive to (${x}, ${y}) did not converge`);
}

export async function stepForward(page: Page, meters: number) {
  const speed = 0.15;
  const times = Math.max(1, Math.round((Math.abs(meters) / speed - 0.2) * 10));
  await publish(page, times, Math.sign(meters) * speed, 0);
}

export async function criterionDetail(page: Page, id: string) {
  return (
    (await page
      .locator(`[data-testid="task-criteria"] [data-criterion="${id}"] .criterion-detail`)
      .textContent()) ?? ""
  );
}

export function parseMeters(text: string) {
  const match = text.replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}
