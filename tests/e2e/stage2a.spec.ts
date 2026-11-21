import { expect, test } from "@playwright/test";

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
  const canvasBytes = await page
    .locator("canvas.warehouse-canvas")
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL().length);
  expect(canvasBytes).toBeGreaterThan(2000);

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
