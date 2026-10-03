import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DEFAULT_PROFILE, TASK_SAMPLE, type AppState } from "../lib/contracts";

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL || new URL(baseURL).port !== "3300", "Uses the isolated anonymous public server.");
});

test("anonymous visitors keep separate profile, schedules and API keys", async ({ page, browser, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const initial = await page.goto("/");
  expect(initial?.status()).toBe(200);
  expect(initial?.headers()["www-authenticate"]).toBeUndefined();
  await expect(page.getByText("게스트", { exact: true })).toBeVisible();
  const first = page.context().request;
  const baseline: AppState = await (await first.get("/api/state")).json();
  expect(baseline.settings.accessMode).toBe("anonymous");
  expect(baseline.settings.aiConfigured).toBe(false);
  expect(baseline.settings.telegramConfigured).toBe(false);
  expect(baseline.settings.telegramChatId).toBe("");
  expect(baseline.settings.dataKeys).toEqual({ dataGoKr: null, saramin: null });
  const key = `sk-ant-test-guest-${randomUUID()}`;
  const eventTitle = `guest-event-${randomUUID()}`;
  try {
    const profile = await first.put("/api/profile", { data: { ...DEFAULT_PROFILE, name: "방문자 A" } });
    expect(profile.ok()).toBe(true);
    const saved = await first.put("/api/settings/ai", { data: { apiKey: key } });
    expect(saved.ok()).toBe(true);
    expect(await saved.text()).not.toContain(key);
    const eventResponse = await first.post("/api/events", { data: {
      title: eventTitle, kind: "assignment", date: "2099-01-01", time: null,
      notes: "", source: "", isSample: false, reminders: [],
    } });
    expect(eventResponse.ok()).toBe(true);
    const state: AppState = await eventResponse.json();
    const event = state.events.find((item) => item.title === eventTitle)!;
    expect(event).toBeDefined();

    const second = await browser.newContext({ baseURL });
    try {
      const other: AppState = await (await second.request.get("/api/state")).json();
      expect(other.profile.name).toBe(DEFAULT_PROFILE.name);
      expect(other.events.some((item) => item.id === event.id)).toBe(false);
      expect(other.settings.aiConfigured).toBe(false);
      const unauthorizedDelete = await second.request.delete(`/api/events/${event.id}`);
      expect(unauthorizedDelete.status()).toBe(404);
      await second.request.delete("/api/settings/ai");
      const unchanged: AppState = await (await first.get("/api/state")).json();
      expect(unchanged.settings.aiKeySource).toBe("saved");
      expect(unchanged.events.some((item) => item.id === event.id)).toBe(true);
      const noKey = await second.request.post("/api/analyze", { data: {
        text: "과제 공지입니다.", kind: "assignment", referenceDate: null, classTime: null, sample: false,
      } });
      expect(noKey.status()).toBe(503);
      const sample = await second.request.post("/api/analyze", { data: {
        text: TASK_SAMPLE, kind: "assignment", referenceDate: "2026-10-03", classTime: "09:00", sample: true,
      } });
      expect(sample.ok()).toBe(true);
      expect((await sample.json()).mode).toBe("sample");
    } finally {
      await second.close();
    }

    await page.reload();
    const persisted: AppState = await (await first.get("/api/state")).json();
    expect(persisted.profile.name).toBe("방문자 A");
    expect(persisted.settings.aiKeySource).toBe("saved");
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.getByRole("note", { name: "게스트 데이터 보안" })).toBeVisible();
    await expect(page.getByLabel("ANTHROPIC_API_KEY", { exact: true })).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(Object.values(localStorage)))).not.toContain(key);
    await page.screenshot({ path: testInfo.outputPath("anonymous-settings.png"), fullPage: true });
    expect(errors).toEqual([]);
    await first.delete(`/api/events/${event.id}`);
  } finally {
    await first.delete("/api/settings/ai");
  }
});

test("guest cookies are HttpOnly and cross-site mutations cannot change a session", async ({ page }) => {
  await page.goto("/");
  const cookies = await page.context().cookies();
  const guest = cookies.find((cookie) => cookie.name === "campus_guest")!;
  expect(guest.httpOnly).toBe(true);
  expect(guest.sameSite).toBe("Lax");
  expect(guest.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
  expect(await page.evaluate(() => document.cookie)).not.toContain("campus_guest");
  const request = page.context().request;
  const response = await request.put("/api/profile", {
    headers: { Origin: "https://foreign.example" },
    data: { ...DEFAULT_PROFILE, name: "다른 사이트" },
  });
  expect(response.status()).toBe(403);
  expect((await (await request.get("/api/state")).json()).profile.name).toBe(DEFAULT_PROFILE.name);
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(health.headers()["set-cookie"]).toBeUndefined();
});
