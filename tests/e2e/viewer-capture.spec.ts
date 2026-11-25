import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  driveTo,
  robotPose,
  runCommand,
  startSession,
  twist,
  waitStopped
} from "./course-helpers";

const outputDir = process.env.CAPTURE_DIR ?? "";

test.skip(outputDir === "", "defina CAPTURE_DIR para gerar as capturas");

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

async function capture(page: Page, name: string) {
  mkdirSync(outputDir, { recursive: true });
  await page.waitForTimeout(500);
  await page.getByTestId("robot-pose").screenshot({
    path: join(outputDir, name)
  });
}

async function frameStats(page: Page) {
  const canvas = page.getByTestId("warehouse-canvas");
  return {
    frameMs: Number(await canvas.getAttribute("data-frame-ms")),
    frames: Number(await canvas.getAttribute("data-frames"))
  };
}

test("capturas do visor e tempo de frame", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await startSession(page);
  await expect(page.getByTestId("warehouse-canvas")).toBeVisible();
  await capture(page, "visor-inicio.png");

  const idle = await frameStats(page);

  await runCommand(page, twist(25, 0.3, 0));
  await waitStopped(page);
  await page.getByTestId("focus-terminal").click();
  await page.keyboard.type(twist(150, 0.15, 0.25));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-state")).toHaveAttribute(
    "data-running",
    "true"
  );
  const before = await frameStats(page);
  const started = Date.now();
  await page.waitForTimeout(9000);
  const after = await frameStats(page);
  const seconds = (Date.now() - started) / 1000;
  await capture(page, "visor-lidar-rastro.png");
  const moving = {
    frameMs: after.frameMs,
    fps: (after.frames - before.frames) / seconds
  };
  await page.keyboard.press("Control+c");
  await waitStopped(page);

  await page.getByTestId("restart-button-top").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 90_000 }
  );
  await expect(page.getByTestId("terminal-state")).toHaveAttribute(
    "data-prompt",
    "true",
    { timeout: 30_000 }
  );
  await driveTo(page, 2.2, 0.0);
  await driveTo(page, 2.2, 1.85);
  await driveTo(page, 13.2, 1.85);
  await expect(page.getByTestId("mission-status")).toHaveAttribute(
    "data-in-zone",
    "true",
    { timeout: 20_000 }
  ).catch(() => undefined);
  await capture(page, "visor-zona.png");
  const final = await robotPose(page);

  writeFileSync(
    join(outputDir, "visor-desempenho.json"),
    JSON.stringify({ idle, moving, final }, null, 2)
  );
});
