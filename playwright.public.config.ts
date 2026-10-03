import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3300";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "anonymous-public.spec.ts",
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
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: "3300",
      PUBLIC_ACCESS_MODE: "anonymous",
      PUBLIC_SESSION_DIR: "data/e2e-public-sessions",
      DATABASE_URL: "file:data/e2e-public-owner.db",
      APP_URL: baseURL,
      BASIC_AUTH_USER: "owner",
      BASIC_AUTH_PASSWORD: "owner-test-password",
      ANTHROPIC_API_KEY: "owner-ai-placeholder-do-not-use",
      TELEGRAM_BOT_TOKEN: "123456:owner-token-placeholder-do-not-use",
      TELEGRAM_CHAT_ID: "owner-chat-id-placeholder",
      DATA_GO_KR_API_KEY: "owner-data-placeholder-do-not-use",
      SARAMIN_API_KEY: "owner-saramin-placeholder-do-not-use",
    },
  },
});
