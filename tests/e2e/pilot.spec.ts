import { expect, test } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.afterEach(async ({ page }) => {
  try {
    await page.request.delete("/api/session");
  } catch {
    return;
  }
});

test("piloto exige convite e recusa código inválido", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("pilot-gate")).toBeVisible();
  await page.getByTestId("invite-code").fill("INVALID-CODE-0000");
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("invite-error")).toBeVisible();
  await expect(page.getByTestId("start-button")).toHaveCount(0);
});

test("convite válido abre a sessão", async ({ page }) => {
  const code = process.env.PILOT_INVITE_CODE;
  test.skip(!code, "PILOT_INVITE_CODE não informado");
  await page.goto("/");
  await expect(page.getByTestId("pilot-gate")).toBeVisible();
  await page.getByTestId("invite-code").fill(code!);
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("start-button")).toBeVisible({
    timeout: 15_000
  });
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("session-state")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 60_000 }
  );
  await expect(page.getByTestId("terminal")).toBeVisible();
  await expect(page.getByTestId("robot-pose")).toBeVisible();
  await page.getByTestId("end-button").click();
  await expect(page.getByTestId("pilot-gate")).toBeVisible({
    timeout: 30_000
  });
});
