import { expect, test, type Page } from "@playwright/test";

import {
  answer,
  criterionDetail,
  driveTo,
  expectDone,
  expectTask,
  goNext,
  insertAndRun,
  missionContent,
  parseMeters,
  robotPose,
  rotateTo,
  runCommand,
  startSession,
  stepForward,
  type CourseTask
} from "./course-helpers";

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

async function isDone(page: Page) {
  return (
    (await page.getByTestId("task-status").getAttribute("data-done")) === "true"
  );
}

async function approachBox(page: Page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await isDone(page)) {
      return;
    }
    const reading = parseMeters(await criterionDetail(page, "front"));
    if (Number.isNaN(reading)) {
      await stepForward(page, 0.8);
      continue;
    }
    const target = 0.52;
    if (Math.abs(reading - target) <= 0.1) {
      await page.waitForTimeout(1000);
      continue;
    }
    await stepForward(page, Math.max(-0.3, Math.min(1.0, reading - target)));
  }
  throw new Error("front reading did not reach the range");
}

async function solveTask(page: Page, task: CourseTask) {
  const card = page.getByTestId("task-card");
  if (task.kind === "command") {
    if (task.insertCommand) {
      await insertAndRun(page, page.getByTestId("command-preview"));
    } else {
      await runCommand(page, task.solution![0]);
    }
    return;
  }
  if (task.kind === "answer") {
    await answer(
      page,
      task.numeric ? String(task.numeric.value) : task.accept![0]
    );
    return;
  }
  if (task.kind === "quiz") {
    await page.getByTestId("quiz-option").nth(task.question!.answerIndex).click();
    return;
  }
  switch (task.id) {
    case "movimento-faixa-a":
      await insertAndRun(page, card);
      return;
    case "movimento-re":
      await runCommand(page, task.solution![0]);
      return;
    case "rotacao-90":
      await rotateTo(page, Math.PI / 2, 0.08);
      return;
    case "rotacao-faixa-b":
      await driveTo(page, 1.0, 2.0);
      await rotateTo(page, Math.PI / 2, 0.05);
      return;
    case "lidar-frente":
      await approachBox(page);
      return;
    case "entrega-zona": {
      const current = await robotPose(page);
      await driveTo(page, 2.2, current.y);
      await driveTo(page, 2.2, 3.6);
      await driveTo(page, 5.8, 3.6);
      return;
    }
    default:
      throw new Error(`unhandled task ${task.id}`);
  }
}

test("Primeiro Turno: nove módulos, zona e reinício", async ({ page }) => {
  test.setTimeout(900_000);
  const mission = await missionContent(page);
  const total = mission.steps.reduce((sum, step) => sum + step.tasks.length, 0);
  expect(mission.steps).toHaveLength(9);
  expect(total).toBe(23);

  await startSession(page);
  const terminal = page.locator(".xterm-rows");
  const insertButton = page.getByTestId("command-preview").getByTestId("insert-command");
  await expect(page.getByTestId("copy-command")).toBeVisible();
  await expect(insertButton).toBeEnabled({ timeout: 20_000 });

  await page.getByTestId("focus-terminal").click();
  await page.keyboard.type("echo TEXTO_NA_LINHA");
  await expect(insertButton).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("TEXTO_NA_LINHA", { timeout: 10_000 });
  await expect(insertButton).toBeEnabled({ timeout: 10_000 });

  let doneCount = 0;
  for (const step of mission.steps) {
    for (const [index, task] of step.tasks.entries()) {
      await expectTask(page, task.id);
      await expect(page.getByTestId("mission-step")).toHaveAttribute(
        "data-step",
        step.id
      );
      await expect(page.getByTestId("course-progress")).toHaveAttribute(
        "data-done",
        String(doneCount)
      );
      if (task.id === "lidar-frente") {
        await expect(page.getByTestId("lidar-toggle")).toHaveAttribute(
          "data-enabled",
          "true"
        );
      }
      await solveTask(page, task);
      if (task.kind === "delivery") {
        await expect(page.getByTestId("mission-success")).toBeVisible({
          timeout: 40_000
        });
      } else {
        await expectDone(page, 30_000);
      }
      doneCount += 1;
      if (task.id === "lidar-frente") {
        const robot = page.getByTestId("robot-pose");
        expect(Number(await robot.getAttribute("data-scan-points"))).toBeGreaterThan(20);
        const scanStamp = Number(await robot.getAttribute("data-scan-stamp"));
        const poseStamp = Number(await robot.getAttribute("data-scan-pose-stamp"));
        expect(Math.abs(poseStamp - scanStamp)).toBeLessThan(1);
        const toggle = page.getByTestId("lidar-toggle");
        await toggle.click();
        await expect(toggle).toHaveAttribute("data-enabled", "false");
        await toggle.click();
        await expect(toggle).toHaveAttribute("data-enabled", "true");
      }
      const last = step === mission.steps.at(-1) && index === step.tasks.length - 1;
      if (!last) {
        await goNext(page);
      }
    }
  }

  await expect(page.getByTestId("mission-success")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("mission-hook")).toHaveText(mission.success.hook);
  await expect(page.getByTestId("course-progress")).toHaveAttribute(
    "data-done",
    String(total)
  );

  const pose = page.getByTestId("robot-pose");
  const before = await robotPose(page);
  const state = page.getByTestId("terminal-state");
  await expect(state).toHaveAttribute("data-prompt", "true", { timeout: 15_000 });
  await expect(state).toHaveAttribute("data-running", "false");
  await page.getByTestId("focus-terminal").click();
  await page.keyboard.type(
    'ros2 topic pub --rate 10 --times 20 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: -0.2}}"'
  );
  await page.keyboard.press("Enter");
  await expect(state).toHaveAttribute("data-running", "true", { timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const dx = Number(await pose.getAttribute("data-x")) - before.x;
        const dy = Number(await pose.getAttribute("data-y")) - before.y;
        return dx * Math.cos(before.yaw) + dy * Math.sin(before.yaw);
      },
      { timeout: 15_000 }
    )
    .toBeLessThan(-0.03);
  await expect
    .poll(async () => Number(await pose.getAttribute("data-speed")), {
      timeout: 10_000
    })
    .toBeLessThan(0.02);

  await page.getByTestId("restart-button").click();
  await expectTask(page, "terminal-pwd", 60_000);
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready"
  );
  await expect(page.getByTestId("course-progress")).toHaveAttribute(
    "data-done",
    "0"
  );
  await expect
    .poll(async () => Math.abs((await robotPose(page)).x), { timeout: 15_000 })
    .toBeLessThan(0.05);

  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({ timeout: 30_000 });
});

test("comando errado não conclui o desafio e mostra retorno", async ({ page }) => {
  await startSession(page);
  await runCommand(page, "ls /opt");
  await expect(page.getByTestId("command-feedback")).toHaveAttribute(
    "data-verdict",
    "other"
  );
  await expect(page.getByTestId("task-status")).toHaveAttribute("data-done", "false");
  await runCommand(page, "pwd");
  await expect(page.getByTestId("command-feedback")).toHaveAttribute(
    "data-verdict",
    "match"
  );
  await expectDone(page);
  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({ timeout: 30_000 });
});

test("falha ao reiniciar mostra erro e permite tentar novamente", async ({
  page
}) => {
  await startSession(page);
  await page.route("**/api/session/restart", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        state: "error",
        error: "novo container falhou ao subir"
      })
    });
  });
  await page.getByTestId("restart-button-top").click();
  await expect(page.getByText("Falha na sessão")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("novo container falhou ao subir")).toBeVisible();
  await page.unroute("**/api/session/restart");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 30_000 }
  );
  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({ timeout: 30_000 });
});
