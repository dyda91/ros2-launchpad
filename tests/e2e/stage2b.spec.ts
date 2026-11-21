import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Question = {
  answerIndex: number;
  options: string[];
};

type Step = {
  id: string;
  question?: Question;
};

type Mission = {
  steps: Step[];
};

async function missionContent(page: Page) {
  const response = await page.request.get("/api/mission");
  return (await response.json()) as Mission;
}

async function startPage(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("start-button")).toBeVisible();
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 90_000 }
  );
}

async function sessionTag(page: Page) {
  const response = await page.request.get("/api/session");
  const payload = (await response.json()) as { session_tag?: string };
  return payload.session_tag ?? "";
}

async function touch(page: Page) {
  await page.request.post("/api/session/touch");
}

async function closeSessions(context: BrowserContext) {
  try {
    await context.request.delete("/api/session");
  } catch {
    return;
  }
}

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

test("duas sessões, terceira cheia, progresso, reload e reconexão", async ({
  browser
}) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await contextA.addInitScript(() => {
    const Native = window.WebSocket;
    const sockets: WebSocket[] = [];
    (window as unknown as { __sockets: WebSocket[] }).__sockets = sockets;
    class Tracked extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    }
    window.WebSocket = Tracked as unknown as typeof WebSocket;
  });

  try {
    await Promise.all([startPage(pageA), startPage(pageB)]);
    const tagA = await sessionTag(pageA);
    const tagB = await sessionTag(pageB);
    expect(tagA).not.toBe("");
    expect(tagB).not.toBe("");
    expect(tagA).not.toBe(tagB);

    const health = (await (
      await pageA.request.get("/api/health")
    ).json()) as { active: number; max: number };
    expect(health.active).toBe(2);
    expect(health.max).toBe(2);

    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    await pageC.goto("/");
    await expect(pageC.getByText("As duas vagas estão em uso")).toBeVisible();
    await contextC.close();

    const mission = await missionContent(pageA);
    const firstAnswer = mission.steps[0].question!.answerIndex;
    await pageB.getByTestId("quiz-option").nth(firstAnswer).click();
    await expect(pageB.getByTestId("next-step")).toBeVisible();
    await touch(pageB);
    await pageA.getByTestId("quiz-option").nth(firstAnswer).click();
    await pageA.getByTestId("next-step").click();
    await expect(pageA.getByTestId("mission-step")).toHaveAttribute(
      "data-step",
      "odometria"
    );
    await expect(pageB.getByTestId("mission-step")).toHaveAttribute(
      "data-step",
      "topicos"
    );
    await touch(pageB);

    const marker = `RELOAD_${Date.now()}`;
    const terminalA = pageA.locator(".xterm-rows");
    await pageA.locator(".xterm").click();
    await pageA.keyboard.type(`echo ${marker}`);
    await pageA.keyboard.press("Enter");
    await expect(terminalA).toContainText(marker, { timeout: 10_000 });

    await touch(pageB);
    await pageA.reload();
    await expect(pageA.getByTestId("session-state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 60_000 }
    );
    expect(await sessionTag(pageA)).toBe(tagA);
    await expect(pageA.getByTestId("mission-step")).toHaveAttribute(
      "data-step",
      "odometria",
      { timeout: 20_000 }
    );
    await expect(terminalA).toContainText(marker, { timeout: 20_000 });
    await touch(pageB);

    await pageA.evaluate(() => {
      const sockets = (window as unknown as { __sockets?: WebSocket[] })
        .__sockets;
      const terminal = sockets
        ?.filter(
          (socket) =>
            socket.url.includes("/ws/terminal") &&
            socket.readyState === WebSocket.OPEN
        )
        .pop();
      terminal?.close();
    });
    await expect(terminalA).toContainText("[reconectado]", {
      timeout: 10_000
    });
    const reconnectMarker = `RECONNECT_${Date.now()}`;
    await pageA.locator(".xterm").click();
    await pageA.keyboard.type(`echo ${reconnectMarker}`);
    await pageA.keyboard.press("Enter");
    await expect(terminalA).toContainText(reconnectMarker, {
      timeout: 10_000
    });
    await touch(pageB);

    await pageA.getByTestId("restart-button-top").click();
    await expect(pageA.getByTestId("session-state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 60_000 }
    );
    expect(await sessionTag(pageA)).toBe(tagA);
    await expect(pageA.getByTestId("mission-step")).toHaveAttribute(
      "data-step",
      "topicos"
    );
    await expect
      .poll(
        async () =>
          Math.abs(
            Number(
              await pageA
                .getByTestId("robot-pose")
                .getAttribute("data-x")
            )
          ),
        { timeout: 15_000 }
      )
      .toBeLessThan(0.05);
    await touch(pageB);
    await expect(pageB.getByTestId("session-state")).toHaveAttribute(
      "data-state",
      "ready"
    );
  } finally {
    await closeSessions(contextA);
    await closeSessions(contextB);
    await contextA.close();
    await contextB.close();
  }
});

test("inatividade avisa, expira, libera a vaga e permite nova sessão", async ({
  page
}) => {
  await startPage(page);
  const oldTag = await sessionTag(page);
  await expect(page.getByTestId("lifecycle-warning")).toBeVisible({
    timeout: 25_000
  });
  await expect(page.getByTestId("expired-start-button")).toBeVisible({
    timeout: 25_000
  });
  const health = (await (
    await page.request.get("/api/health")
  ).json()) as { active: number };
  expect(health.active).toBe(0);
  await page.getByTestId("expired-start-button").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 90_000 }
  );
  const newTag = await sessionTag(page);
  expect(newTag).not.toBe("");
  expect(newTag).not.toBe(oldTag);
  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("start-button")).toBeVisible({
    timeout: 30_000
  });
});
