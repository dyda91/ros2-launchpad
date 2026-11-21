import { defineConfig } from "@playwright/test";

const artifacts = process.env.PILOT_E2E_ARTIFACTS === "1";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PILOT_BASE_URL || "http://127.0.0.1:8080",
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: artifacts ? "retain-on-failure" : "off",
    screenshot: artifacts ? "only-on-failure" : "off",
    video: "off"
  }
});
