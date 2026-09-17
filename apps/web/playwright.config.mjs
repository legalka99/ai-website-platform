import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch:
    process.env.KLEO_CONSOLE_LIVE === "1"
      ? "local-smoke.spec.mjs"
      : "console.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    ...(process.env.KLEO_TEST_SYSTEM_BROWSER === "1"
      ? { launchOptions: { executablePath: "/usr/bin/chromium" } }
      : {}),
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 20000,
  },
  reporter: "list",
  outputDir: "test-results",
});
