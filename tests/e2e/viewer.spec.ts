import { expect, test, type Page } from "@playwright/test";

import {
  expectDone,
  expectTask,
  goNext,
  insertAndRun,
  robotPose,
  runCommand,
  startSession,
  twist,
  waitStopped
} from "./course-helpers";

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

async function attribute(page: Page, name: string) {
  return Number(await page.getByTestId("warehouse-canvas").getAttribute(name));
}

test("visor: camadas, câmera, rastro e leitura ao vivo", async ({ page }) => {
  await startSession(page);
  await expect(page.getByTestId("robot-view")).toHaveCount(0);
  const canvas = page.getByTestId("warehouse-canvas");
  await expect(canvas).toBeVisible();

  const readout = page.getByTestId("readout");
  await expect(readout).toContainText("Fixed Frame: odom");
  await expect(page.getByTestId("displays-panel")).toBeVisible();
  await expect(page.getByTestId("range-legend")).toBeVisible();

  await runCommand(page, twist(30, 0.3, 0));
  await waitStopped(page);
  const pose = await robotPose(page);
  expect(pose.x).toBeGreaterThan(0.5);
  await expect(readout).toContainText(
    pose.x.toFixed(2).replace(".", ",").slice(0, 3)
  );
  await expect.poll(() => attribute(page, "data-trail-points")).toBeGreaterThan(5);
  await expect.poll(() => attribute(page, "data-scan-frames")).toBeGreaterThan(0);

  await page.getByTestId("clear-trail").click();
  await expect
    .poll(() => attribute(page, "data-trail-points"), { timeout: 5_000 })
    .toBeLessThan(3);

  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await expect(page.getByTestId("cursor-readout")).toContainText("cursor: (");
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () =>
      Number(await page.getByTestId("robot-pose").getAttribute("data-zoom"))
    )
    .toBeGreaterThan(1.2);
  await page.mouse.down();
  await page.mouse.move(center.x + 60, center.y + 20, { steps: 4 });
  await page.mouse.up();

  await page.getByTestId("recenter").click();
  await expect(page.getByTestId("robot-pose")).toHaveAttribute("data-zoom", "1");

  await page.getByTestId("follow-robot").click();
  await expect(page.getByTestId("follow-robot")).toHaveAttribute(
    "data-enabled",
    "true"
  );
  await page.getByTestId("follow-robot").click();

  await page.getByTestId("layer-trail").uncheck();
  await page.getByTestId("layer-grid").uncheck();
  await page.getByTestId("layer-markings").uncheck();
  await page.getByTestId("layer-tf").uncheck();
  await page.getByTestId("layer-velocity").uncheck();
  await page.getByTestId("layer-rays").check();
  await page.getByTestId("persistence-5").click();
  await page.getByTestId("layer-scan").uncheck();
  await expect(page.getByTestId("lidar-toggle")).toHaveAttribute(
    "data-enabled",
    "false"
  );
  await page.getByTestId("layer-scan").check();
  await expect(page.getByTestId("lidar-toggle")).toHaveAttribute(
    "data-enabled",
    "true"
  );
  await page.getByTestId("displays-toggle").click();
  await expect(page.getByTestId("layer-grid")).toHaveCount(0);

  const stats = {
    frameMs: await attribute(page, "data-frame-ms"),
    frames: await attribute(page, "data-frames")
  };
  expect(stats.frames).toBeGreaterThan(10);
  expect(stats.frameMs).toBeLessThan(16);
  await expect(page.getByTestId("terminal-state")).toHaveAttribute(
    "data-prompt",
    "true"
  );
});

test("raios do LiDAR ligados por padrão e botão de resetar o robô", async ({ page }) => {
  await startSession(page);
  await expect(page.getByTestId("layer-rays")).toBeChecked();

  await runCommand(page, twist(30, 0.3, 0));
  await waitStopped(page);
  expect((await robotPose(page)).x).toBeGreaterThan(0.5);

  await page.getByTestId("reset-robot").click();
  await expect
    .poll(async () => {
      const pose = await robotPose(page);
      return Math.hypot(pose.x, pose.y);
    }, { timeout: 15_000 })
    .toBeLessThan(0.1);
  await expect
    .poll(async () => Math.abs((await robotPose(page)).yaw), { timeout: 5_000 })
    .toBeLessThan(0.1);
});

test("campo de resposta do curso mantém o foco ao clicar", async ({ page }) => {
  await startSession(page);
  await expectTask(page, "terminal-pwd");
  await insertAndRun(page, page.getByTestId("task-card"));
  await expectDone(page);
  await goNext(page);
  await expectTask(page, "terminal-ls-ros");
  await runCommand(page, "ls /opt/ros");
  await expectDone(page);
  await goNext(page);
  await expectTask(page, "terminal-distro");

  const input = page.getByTestId("answer-input");
  await input.click();
  await page.keyboard.type("jazzy", { delay: 40 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("jazzy");
});
