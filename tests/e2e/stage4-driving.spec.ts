import { expect, test, type Page } from "@playwright/test";

type Pose = {
  x: number;
  y: number;
  yaw: number;
  speed: number;
};

async function startSession(page: Page) {
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
  await expect(page.getByTestId("terminal-state")).toHaveAttribute(
    "data-prompt",
    "true",
    { timeout: 20_000 }
  );
}

async function pose(page: Page): Promise<Pose> {
  const robot = page.getByTestId("robot-pose");
  return {
    x: Number(await robot.getAttribute("data-x")),
    y: Number(await robot.getAttribute("data-y")),
    yaw: Number(await robot.getAttribute("data-yaw")),
    speed: Number(await robot.getAttribute("data-speed"))
  };
}

async function waitStopped(page: Page) {
  await expect
    .poll(async () => (await pose(page)).speed, { timeout: 10_000 })
    .toBeLessThan(0.02);
}

async function focusTerminal(page: Page) {
  await page.getByTestId("focus-terminal").click();
}

async function runCommand(page: Page, command: string) {
  const state = page.getByTestId("terminal-state");
  await focusTerminal(page);
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await expect(state).toHaveAttribute("data-running", "true", {
    timeout: 10_000
  });
  await expect(state).toHaveAttribute("data-running", "false", {
    timeout: 20_000
  });
  await expect(state).toHaveAttribute("data-prompt", "true", {
    timeout: 10_000
  });
  await expect(state).toHaveAttribute("data-line-empty", "true", {
    timeout: 10_000
  });
}

function dot(ax: number, ay: number, bx: number, by: number) {
  return ax * bx + ay * by;
}

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

test("inserir executa com Enter sem clique adicional no terminal", async ({
  page
}) => {
  await startSession(page);
  const terminal = page.locator(".xterm-rows");
  await page.getByTestId("insert-command").click();
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("/ros_ws", { timeout: 10_000 });
});

test("digitação imediata depois de a sessão ficar pronta", async ({ page }) => {
  await startSession(page);
  const state = page.getByTestId("terminal-state");
  await page.keyboard.type(
    'timeout 1 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.15}}"'
  );
  await page.keyboard.press("Enter");
  await expect(state).toHaveAttribute("data-running", "true", {
    timeout: 10_000
  });
  await expect(state).toHaveAttribute("data-prompt", "true", {
    timeout: 20_000
  });
});

test("Tab completa caminho e subcomando e Ctrl+Shift+E sai do terminal", async ({
  page
}) => {
  await startSession(page);
  const rows = page.locator(".xterm-rows");

  await focusTerminal(page);
  await page.keyboard.type("ls /opt/ros/jazzy/setup.b");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(rows).toContainText("/opt/ros/jazzy/setup.bash", {
    timeout: 10_000
  });

  await focusTerminal(page);
  await page.keyboard.type("ros2 top");
  await page.keyboard.press("Tab");
  await expect(rows).toContainText("ros2 topic", { timeout: 10_000 });
  await page.keyboard.press("Control+c");

  await focusTerminal(page);
  await page.keyboard.type("ls /opt/ros/jazzy/setup.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(rows).toContainText("setup.sh", { timeout: 10_000 });
  await page.keyboard.press("Control+c");

  await focusTerminal(page);
  await page.keyboard.press("Control+Shift+E");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.getAttribute("data-testid")
      )
    )
    .toBe("mission-panel");
});

test("comandos ROS 2 da trilha respondem no terminal", async ({ page }) => {
  await startSession(page);
  const rows = page.locator(".xterm-rows");
  const state = page.getByTestId("terminal-state");
  await focusTerminal(page);
  await page.keyboard.type("ros2 node list");
  await page.keyboard.press("Enter");
  await expect(rows).toContainText("launchpad_session_agent", {
    timeout: 10_000
  });
  await focusTerminal(page);
  await page.keyboard.type("ros2 topic info /cmd_vel");
  await page.keyboard.press("Enter");
  await expect(rows).toContainText("Publisher count", { timeout: 10_000 });
  await focusTerminal(page);
  await page.keyboard.type("ros2 topic type /cmd_vel");
  await page.keyboard.press("Enter");
  await expect(rows).toContainText("geometry_msgs/msg/Twist", {
    timeout: 10_000
  });
  await focusTerminal(page);
  await page.keyboard.type("ros2 interface show geometry_msgs/msg/Twist");
  await page.keyboard.press("Enter");
  await expect(rows).toContainText("linear", { timeout: 10_000 });
  await focusTerminal(page);
  await page.keyboard.type("timeout 2 ros2 topic hz /odom");
  await page.keyboard.press("Enter");
  await expect(state).toHaveAttribute("data-prompt", "true", {
    timeout: 15_000
  });
});

test("condução repetida na mesma sessão: frente, parada, curvas e ré", async ({
  page
}) => {
  await startSession(page);
  const start = await pose(page);

  await runCommand(
    page,
    'timeout 2 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.2}}"'
  );
  await waitStopped(page);
  const forward = await pose(page);
  expect(dot(forward.x - start.x, forward.y - start.y, 1, 0)).toBeGreaterThan(
    0.08
  );
  expect(Math.abs(forward.yaw - start.yaw)).toBeLessThan(0.2);

  await runCommand(
    page,
    'timeout 1.5 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{angular: {z: 0.8}}"'
  );
  await waitStopped(page);
  const left = await pose(page);
  expect(left.yaw).toBeGreaterThan(forward.yaw + 0.2);

  await runCommand(
    page,
    'timeout 1.5 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.15}}"'
  );
  await waitStopped(page);
  const secondForward = await pose(page);
  const headingX = Math.cos(left.yaw);
  const headingY = Math.sin(left.yaw);
  expect(
    dot(
      secondForward.x - left.x,
      secondForward.y - left.y,
      headingX,
      headingY
    )
  ).toBeGreaterThan(0.06);

  await runCommand(
    page,
    'timeout 1.5 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{angular: {z: -0.8}}"'
  );
  await waitStopped(page);
  const right = await pose(page);
  expect(right.yaw).toBeLessThan(secondForward.yaw - 0.2);

  const beforeReverse = await pose(page);
  await runCommand(
    page,
    'timeout 1.5 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: -0.15}}"'
  );
  await waitStopped(page);
  const reversed = await pose(page);
  expect(
    dot(
      reversed.x - beforeReverse.x,
      reversed.y - beforeReverse.y,
      Math.cos(beforeReverse.yaw),
      Math.sin(beforeReverse.yaw)
    )
  ).toBeLessThan(-0.05);
  expect(reversed.speed).toBeLessThan(0.02);
});

test("focar terminal mantém a condução após avançar um desafio", async ({
  page
}) => {
  await startSession(page);
  const mission = await (await page.request.get("/api/mission")).json();
  const answer = mission.steps[0].question.answerIndex;
  await page.getByTestId("quiz-option").nth(answer).click();
  await page.getByTestId("next-step").click();
  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "comunicacao"
  );
  const before = await pose(page);
  await runCommand(
    page,
    'timeout 1.5 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.15}}"'
  );
  await waitStopped(page);
  const after = await pose(page);
  expect(
    dot(after.x - before.x, after.y - before.y, 1, 0)
  ).toBeGreaterThan(0.05);
});

test("digitação livre depois de navegar sem clicar no terminal", async ({
  page
}) => {
  await startSession(page);
  const mission = await (await page.request.get("/api/mission")).json();
  await page.locator(".mission-title").click();
  await page.keyboard.type("echo ANTES_DA_NAVEGACAO");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "ANTES_DA_NAVEGACAO",
    { timeout: 10_000 }
  );
  const answer = mission.steps[0].question.answerIndex;
  await page.getByTestId("quiz-option").nth(answer).click();
  await page.getByTestId("next-step").click();
  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "comunicacao"
  );
  const state = page.getByTestId("terminal-state");
  await page.keyboard.type(
    'timeout 1.5 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.15}}"'
  );
  await page.keyboard.press("Enter");
  await expect(state).toHaveAttribute("data-running", "true", {
    timeout: 10_000
  });
  await expect(state).toHaveAttribute("data-prompt", "true", {
    timeout: 20_000
  });
});

test("publicação contínua, Ctrl+C e comando seguinte", async ({ page }) => {
  await startSession(page);
  const terminal = page.locator(".xterm-rows");
  const state = page.getByTestId("terminal-state");
  await focusTerminal(page);
  await page.keyboard.type(
    'ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.1}}"'
  );
  await page.keyboard.press("Enter");
  await expect(state).toHaveAttribute("data-running", "true", {
    timeout: 10_000
  });
  await expect
    .poll(async () => (await pose(page)).speed, { timeout: 10_000 })
    .toBeGreaterThan(0.02);
  await page.getByTestId("interrupt-button").click();
  await expect(state).toHaveAttribute("data-running", "false", {
    timeout: 10_000
  });
  await expect(state).toHaveAttribute("data-prompt", "true", {
    timeout: 10_000
  });
  await waitStopped(page);
  await focusTerminal(page);
  await page.keyboard.type("echo DEPOIS_DO_CTRL_C");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("DEPOIS_DO_CTRL_C", {
    timeout: 10_000
  });
});
