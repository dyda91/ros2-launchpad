import { expect, test } from "@playwright/test";

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

test("Etapa 2A: terminal real, visor e ciclo da sessão", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-button")).toBeVisible();
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 60_000 }
  );
  await expect(page.getByTestId("terminal")).toBeVisible();
  await expect(page.getByTestId("robot-pose")).toBeVisible();

  await page.setViewportSize({ width: 1600, height: 1000 });
  const wideMission = await page.getByTestId("mission-panel").boundingBox();
  const wideViewport = await page.getByTestId("robot-pose").boundingBox();
  const wideTerminal = await page.getByTestId("terminal").boundingBox();
  expect(wideMission).not.toBeNull();
  expect(wideViewport).not.toBeNull();
  expect(wideTerminal).not.toBeNull();
  expect(wideMission!.x).toBeLessThan(wideViewport!.x);
  expect(Math.abs(wideViewport!.x - wideTerminal!.x)).toBeLessThan(12);
  expect(wideViewport!.y).toBeLessThan(wideTerminal!.y);

  await page.setViewportSize({ width: 1280, height: 900 });
  const mediumMission = await page.getByTestId("mission-panel").boundingBox();
  const mediumViewport = await page.getByTestId("robot-pose").boundingBox();
  const mediumTerminal = await page.getByTestId("terminal").boundingBox();
  expect(mediumMission).not.toBeNull();
  expect(mediumViewport).not.toBeNull();
  expect(mediumTerminal).not.toBeNull();
  expect(mediumMission!.x).toBeLessThan(mediumViewport!.x);
  expect(Math.abs(mediumViewport!.x - mediumTerminal!.x)).toBeLessThan(12);
  expect(mediumViewport!.y).toBeLessThan(mediumTerminal!.y);

  await page.setViewportSize({ width: 800, height: 900 });
  const narrowMission = await page.getByTestId("mission-panel").boundingBox();
  const narrowViewport = await page.getByTestId("robot-pose").boundingBox();
  const narrowTerminal = await page.getByTestId("terminal").boundingBox();
  expect(narrowMission).not.toBeNull();
  expect(narrowViewport).not.toBeNull();
  expect(narrowTerminal).not.toBeNull();
  expect(narrowMission!.y).toBeLessThan(narrowViewport!.y);
  expect(narrowViewport!.y).toBeLessThan(narrowTerminal!.y);
  await page.setViewportSize({ width: 1280, height: 800 });
  const terminalBox = await page.getByTestId("terminal").boundingBox();
  expect(terminalBox).not.toBeNull();
  expect(terminalBox!.y + terminalBox!.height).toBeLessThanOrEqual(801);
  const verticalOverflow = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight
  );
  expect(verticalOverflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });

  const canvasBytes = await page
    .locator("canvas.warehouse-canvas")
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL().length);
  expect(canvasBytes).toBeGreaterThan(2000);
  await expect(page.locator(".map-legend")).toBeVisible();
  await page.getByTestId("zoom-in").click();
  await expect(page.getByTestId("robot-pose")).toHaveAttribute(
    "data-zoom",
    "1.25"
  );
  await page.getByTestId("recenter").click();
  await expect(page.getByTestId("robot-pose")).toHaveAttribute(
    "data-zoom",
    "1"
  );

  const terminal = page.locator(".xterm-rows");
  await page.locator(".xterm").click();

  await page.keyboard.type("ros2 topic list");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("/cmd_vel", { timeout: 10_000 });
  await expect(terminal).toContainText("/odom", { timeout: 10_000 });

  await page.keyboard.type("ros2 topic echo /odom");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_200);
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(400);
  await page.keyboard.type("echo PROMPT_OK");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("PROMPT_OK", { timeout: 10_000 });

  const pose = page.getByTestId("robot-pose");
  const before = Number(await pose.getAttribute("data-x"));
  await page.keyboard.type(
    'timeout 3 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.2}}"'
  );
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => Number(await pose.getAttribute("data-x")), {
      timeout: 15_000
    })
    .toBeGreaterThan(before + 0.15);
  await expect
    .poll(
      async () => Math.abs(Number(await pose.getAttribute("data-speed"))),
      { timeout: 8_000 }
    )
    .toBeLessThan(0.02);

  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({
    timeout: 30_000
  });

  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 60_000 }
  );
  await expect(page.getByTestId("robot-pose")).toBeVisible();
  const initialX = Number(
    await page.getByTestId("robot-pose").getAttribute("data-x")
  );
  expect(Math.abs(initialX)).toBeLessThan(0.05);

  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({
    timeout: 30_000
  });
});
