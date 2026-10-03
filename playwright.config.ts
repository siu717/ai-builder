import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { DATABASE_URL: "file:data/e2e.db" },
  },
});
