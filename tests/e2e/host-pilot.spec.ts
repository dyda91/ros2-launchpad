import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

function invite(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`defina ${name} para o aceite do host`);
  }
  return value;
}

async function submitInvite(page: Page, code: string) {
  await page.goto("/");
  await expect(page.getByTestId("pilot-gate")).toBeVisible();
  await page.getByTestId("invite-code").fill(code);
  await page.getByTestId("invite-submit").click();
}

async function startWithInvite(page: Page, code: string) {
  await submitInvite(page, code);
  await expect(page.getByTestId("start-button")).toBeVisible({
    timeout: 20_000
  });
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 90_000 }
  );
}

async function invalidCode(page: Page, code: string) {
  await page.goto("/");
  await expect(page.getByTestId("pilot-gate")).toBeVisible();
  await page.getByTestId("invite-code").fill(code);
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("invite-error")).toBeVisible({
    timeout: 15_000
  });
}

async function end(page: Page) {
  try {
    if ((await page.getByTestId("end-button").count()) > 0) {
      await page.getByTestId("end-button").click();
    }
  } catch {
    return;
  }
}

async function closeContext(context: BrowserContext) {
  try {
    await context.request.delete("/api/session");
  } catch {
    return;
  }
  await context.close();
}

test("host: convite, lotação, retry, usado, revogado e reconexão", async ({
  browser
}) => {
  const codeA = invite("PILOT_INVITE_A");
  const codeB = invite("PILOT_INVITE_B");
  const codeC = invite("PILOT_INVITE_C");
  const revoked = invite("PILOT_INVITE_REVOKED");
  const base = new URL(process.env.PILOT_BASE_URL || "http://127.0.0.1:8080");
  const expectedWs = base.protocol === "https:" ? "wss:" : "ws:";
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const contextInvalid = await browser.newContext();
  const contextUsed = await browser.newContext();
  const contextRevoked = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  const pageInvalid = await contextInvalid.newPage();
  const pageUsed = await contextUsed.newPage();
  const pageRevoked = await contextRevoked.newPage();
  const sockets: string[] = [];

  await contextA.addInitScript(() => {
    const Native = window.WebSocket;
    const tracked: WebSocket[] = [];
    (window as unknown as { __hostSockets: WebSocket[] }).__hostSockets =
      tracked;
    class Tracked extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        tracked.push(this);
      }
    }
    window.WebSocket = Tracked as unknown as typeof WebSocket;
  });
  for (const page of [pageA, pageB, pageC]) {
    page.on("websocket", (socket) => sockets.push(socket.url()));
  }

  try {
    await invalidCode(pageInvalid, "INVALID-CODE-0000");
    await invalidCode(pageRevoked, revoked);
    await Promise.all([
      startWithInvite(pageA, codeA),
      startWithInvite(pageB, codeB)
    ]);
    await expect(pageA.getByTestId("terminal")).toBeVisible();
    await expect(pageA.getByTestId("robot-pose")).toBeVisible();
    await expect
      .poll(() => sockets.filter((url) => url.includes("/ws/terminal")).length, {
        timeout: 20_000
      })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => sockets.filter((url) => url.includes("/ws/telemetry")).length, {
        timeout: 20_000
      })
      .toBeGreaterThanOrEqual(2);
    for (const url of sockets) {
      expect(new URL(url).protocol).toBe(expectedWs);
    }

    await submitInvite(pageC, codeC);
    await expect(pageC.getByTestId("session-state")).toHaveAttribute(
      "data-state",
      "full",
      { timeout: 20_000 }
    );
    await expect(pageC.getByText("As duas vagas estão em uso")).toBeVisible();
    const health = (await (
      await pageA.request.get("/api/health")
    ).json()) as { active: number };
    expect(health.active).toBe(2);

    await invalidCode(pageUsed, codeA);

    const terminalA = pageA.locator(".xterm-rows");
    const closeResult = await pageA.evaluate(() => {
      const tracked = (window as unknown as { __hostSockets?: WebSocket[] })
        .__hostSockets;
      const terminal = tracked
        ?.filter(
          (socket) =>
            socket.url.includes("/ws/terminal") &&
            socket.readyState === WebSocket.OPEN
        )
        .pop();
      terminal?.close();
      return Boolean(terminal);
    });
    expect(closeResult).toBe(true);
    await expect(terminalA).toContainText("[reconectado]", {
      timeout: 10_000
    });

    await pageA.getByTestId("end-button").click();
    await expect(pageA.getByTestId("pilot-gate")).toBeVisible({
      timeout: 30_000
    });
    await pageC.getByRole("button", { name: "Verificar novamente" }).click();
    await expect(pageC.getByTestId("start-button")).toBeVisible({
      timeout: 20_000
    });
    await pageC.getByTestId("start-button").click();
    await expect(pageC.getByTestId("session-state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 90_000 }
    );
    await expect(pageB.getByTestId("session-state")).toHaveAttribute(
      "data-state",
      "ready"
    );
  } finally {
    await end(pageA);
    await end(pageB);
    await end(pageC);
    await Promise.all([
      closeContext(contextA),
      closeContext(contextB),
      closeContext(contextC),
      closeContext(contextInvalid),
      closeContext(contextUsed),
      closeContext(contextRevoked)
    ]);
  }
});
