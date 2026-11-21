import { expect, test, type Locator, type Page } from "@playwright/test";

type Question = {
  prompt: string;
  options: string[];
  answerIndex: number;
};

type Step = {
  id: string;
  kind: "quiz" | "motion" | "delivery";
  insertCommand?: string;
  question?: Question;
  prediction?: Question;
  command?: string;
  hints: string[];
  solution?: string[];
};

type Mission = {
  steps: Step[];
  success: { hook: string };
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
  await expect(page.getByTestId("mission-panel")).toBeVisible();
  await expect(page.getByTestId("terminal")).toBeVisible();
  await expect(page.getByTestId("robot-pose")).toBeVisible();
}

async function insertAndRun(page: Page, preview: Locator) {
  const insert = preview.getByTestId("insert-command");
  await expect(insert).toBeEnabled({ timeout: 20_000 });
  await insert.click();
  await page.locator(".xterm").click();
  await page.keyboard.press("Enter");
}

async function answerQuestion(
  page: Page,
  testId: "quiz-option" | "prediction-option",
  answerIndex: number
) {
  await page.getByTestId(testId).nth(answerIndex).click();
}

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

test("Primeiro Turno: seis módulos, zona e reinício", async ({
  page,
  request
}) => {
  const mission = (await (
    await request.get("/api/mission")
  ).json()) as Mission;
  const quiz = mission.steps.filter((step) => step.kind === "quiz");
  const motion = mission.steps.find((step) => step.kind === "motion")!;
  const delivery = mission.steps.find((step) => step.kind === "delivery")!;

  await startSession(page);
  const terminal = page.locator(".xterm-rows");
  const stepOnePreview = page.getByTestId("command-preview");
  const insertButton = stepOnePreview.getByTestId("insert-command");
  const copyButton = stepOnePreview.getByTestId("copy-command");

  await expect(copyButton).toBeVisible();
  await expect(insertButton).toBeEnabled({ timeout: 20_000 });

  await page.locator(".xterm").click();
  await page.keyboard.type("echo TEXTO_NA_LINHA");
  await expect(insertButton).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("TEXTO_NA_LINHA", { timeout: 10_000 });
  await expect(insertButton).toBeEnabled({ timeout: 10_000 });

  await page.keyboard.type("ros2 topic echo /odom");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_000);
  await expect(insertButton).toBeDisabled();
  await page.keyboard.press("Control+c");
  await expect(insertButton).toBeEnabled({ timeout: 10_000 });

  await insertAndRun(page, stepOnePreview);
  await expect(terminal).toContainText("/ros_ws", { timeout: 10_000 });
  await answerQuestion(page, "quiz-option", quiz[0].question!.answerIndex);
  await expect(page.getByTestId("next-step")).toBeVisible();
  await page.getByTestId("next-step").click();

  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "comunicacao"
  );
  const stepTwoPreview = page.getByTestId("command-preview");
  await insertAndRun(page, stepTwoPreview);
  await expect(terminal).toContainText("/cmd_vel", { timeout: 10_000 });
  await expect(terminal).toContainText("/odom", { timeout: 10_000 });
  await page.waitForTimeout(500);
  await answerQuestion(page, "quiz-option", quiz[1].question!.answerIndex);
  await page.getByTestId("next-step").click();

  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "odometria"
  );
  const stepThreePreview = page.getByTestId("command-preview");
  await insertAndRun(page, stepThreePreview);
  await page.waitForTimeout(500);
  await answerQuestion(page, "quiz-option", quiz[2].question!.answerIndex);
  await page.getByTestId("next-step").click();

  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "conducao"
  );
  await answerQuestion(
    page,
    "prediction-option",
    motion.prediction!.answerIndex
  );
  await expect(page.getByTestId("motion-reference")).not.toContainText(
    "Aguardando",
    { timeout: 15_000 }
  );
  const motionPreview = page.getByTestId("command-preview");
  await insertAndRun(page, motionPreview);
  await expect(page.getByTestId("next-step")).toBeVisible({
    timeout: 20_000
  });
  await expect(page.getByTestId("next-step")).toContainText(
    "Próximo módulo"
  );
  await page.getByTestId("next-step").click();

  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "lidar"
  );
  const stepLidarPreview = page.getByTestId("command-preview");
  await insertAndRun(page, stepLidarPreview);
  await expect
    .poll(
      async () =>
        Number(
          await page
            .getByTestId("robot-pose")
            .getAttribute("data-scan-points")
        ),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(20);
  const scanStamp = Number(
    await page.getByTestId("robot-pose").getAttribute("data-scan-stamp")
  );
  const scanPoseStamp = Number(
    await page.getByTestId("robot-pose").getAttribute("data-scan-pose-stamp")
  );
  expect(Math.abs(scanPoseStamp - scanStamp)).toBeLessThan(1);
  const lidarToggle = page.getByTestId("lidar-toggle");
  await expect(lidarToggle).toHaveAttribute("data-enabled", "true");
  await lidarToggle.click();
  await expect(lidarToggle).toHaveAttribute("data-enabled", "false");
  await lidarToggle.click();
  await expect(lidarToggle).toHaveAttribute("data-enabled", "true");
  await answerQuestion(page, "quiz-option", quiz[3].question!.answerIndex);
  await page.getByTestId("next-step").click();

  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "entrega"
  );
  const hintButton = page.getByTestId("hint-button");
  for (let index = 0; index < delivery.hints.length; index += 1) {
    await hintButton.click();
  }
  await page.getByTestId("toggle-solution").click();
  await expect(page.getByTestId("solution-command-0")).toBeVisible();

  const solution = delivery.solution!;
  for (let index = 0; index < solution.length; index += 1) {
    const preview = page.getByTestId(`solution-command-${index}`);
    const insert = preview.getByTestId("insert-command");
    await expect(insert).toBeEnabled({ timeout: 25_000 });
    await insert.click();
    await page.locator(".xterm").click();
    await page.keyboard.press("Enter");
    if (index < solution.length - 1) {
      await expect(
        page
          .getByTestId(`solution-command-${index + 1}`)
          .getByTestId("insert-command")
      ).toBeEnabled({ timeout: 30_000 });
    }
  }

  const status = page.getByTestId("mission-status");
  await expect
    .poll(
      async () => {
        const inZone = await status.getAttribute("data-in-zone");
        const speed = Number(await status.getAttribute("data-speed"));
        return inZone === "true" && speed > 0.02;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  expect(await status.getAttribute("data-delivered")).toBe("false");
  await page.keyboard.press("Control+c");
  await expect(page.getByTestId("mission-success")).toBeVisible({
    timeout: 20_000
  });
  await expect(page.getByTestId("mission-hook")).toHaveText(
    mission.success.hook
  );

  const pose = page.getByTestId("robot-pose");
  const beforeSuccessDrive = {
    x: Number(await pose.getAttribute("data-x")),
    y: Number(await pose.getAttribute("data-y")),
    yaw: Number(await pose.getAttribute("data-yaw"))
  };
  const terminalStateAfterSuccess = page.getByTestId("terminal-state");
  await expect(terminalStateAfterSuccess).toHaveAttribute(
    "data-prompt",
    "true",
    { timeout: 15_000 }
  );
  await expect(terminalStateAfterSuccess).toHaveAttribute(
    "data-running",
    "false"
  );
  await page.getByTestId("focus-terminal").click();
  await page.keyboard.type(
    'timeout 2 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.2}}"'
  );
  await page.keyboard.press("Enter");
  await expect(terminalStateAfterSuccess).toHaveAttribute(
    "data-running",
    "true",
    { timeout: 10_000 }
  );
  await expect
    .poll(
      async () => {
        const x = Number(await pose.getAttribute("data-x"));
        const y = Number(await pose.getAttribute("data-y"));
        const dx = x - beforeSuccessDrive.x;
        const dy = y - beforeSuccessDrive.y;
        return dx * Math.cos(beforeSuccessDrive.yaw) +
          dy * Math.sin(beforeSuccessDrive.yaw);
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0.03);
  await expect
    .poll(
      async () => Number(await pose.getAttribute("data-speed")),
      { timeout: 10_000 }
    )
    .toBeLessThan(0.02);

  await page.getByTestId("restart-button").click();
  await expect(page.getByTestId("mission-step")).toHaveAttribute(
    "data-step",
    "terminal",
    { timeout: 60_000 }
  );
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready"
  );
  await expect
    .poll(
      async () =>
        Math.abs(Number(await page.getByTestId("robot-pose").getAttribute("data-x"))),
      { timeout: 15_000 }
    )
    .toBeLessThan(0.05);

  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({
    timeout: 30_000
  });
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
  await expect(page.getByText("Falha na sessão")).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByText("novo container falhou ao subir")).toBeVisible();
  await page.unroute("**/api/session/restart");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 30_000 }
  );
  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({
    timeout: 30_000
  });
});
