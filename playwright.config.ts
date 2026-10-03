import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
// Playwright 번들 Chromium을 내려받지 않은 PC에서는 설치된 브라우저로 실행한다.
// 예: E2E_BROWSER_CHANNEL=chrome 또는 msedge. 비워 두면 번들 Chromium을 사용한다.
const channel = process.env.E2E_BROWSER_CHANNEL || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL,
    channel,
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
    // E2E_BASE_URL의 포트로 서버를 띄운다. 지정하지 않으면 next dev가 3000에서 뜨고 url 대기가 시간 초과된다.
    env: { DATABASE_URL: "file:data/e2e.db", PORT: new URL(baseURL).port || "3000" },
  },
});
