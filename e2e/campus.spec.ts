import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AppState, EventInput } from "../lib/contracts";

function nextDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() + 86_400_000));
}

async function state(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function sampleEvent(title: string): EventInput {
  return { title, kind: "assignment", date: nextDay(), time: null, notes: "E2E 샘플", source: "검수용 샘플 공지", isSample: true, reminders: [], idempotencyKey: randomUUID() };
}

test("calendar editing, persistence, completion, deletion and responsive layout", async ({ page, request }, testInfo) => {
  const title = `검수 과제 ${randomUUID().slice(0, 8)}`;
  const response = await request.post("/api/events", { data: sampleEvent(title) });
  expect(response.ok()).toBeTruthy();
  const saved: AppState = await response.json();
  const event = saved.events.find((item) => item.title === title)!;
  expect(event).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "오늘의 캠퍼스" })).toBeVisible();
    await expect.poll(() => page.locator(".campus-photo img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "캘린더", exact: true }).click();
    await page.getByRole("button", { name: "마감순", exact: true }).click();
    await page.locator(".event-title-button").filter({ hasText: title }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("일정 제목", { exact: true }).fill(`${title} 수정`);
    await dialog.getByRole("button", { name: "일정 저장", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "캘린더", exact: true }).click();
    await page.getByRole("button", { name: "마감순", exact: true }).click();
    await expect(page.locator(".event-title-button").filter({ hasText: `${title} 수정` })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("calendar.png"), fullPage: true });
    await page.getByRole("button", { name: `${title} 수정 완료 처리`, exact: true }).click();
    await expect.poll(async () => (await state(request)).events.find((item) => item.id === event.id)?.completed).toBe(true);
    await page.getByLabel("완료 상태 필터").selectOption("completed");
    await page.getByRole("button", { name: `${title} 수정 완료 취소`, exact: true }).click();
    await expect.poll(async () => (await state(request)).events.find((item) => item.id === event.id)?.completed).toBe(false);
    await page.getByLabel("완료 상태 필터").selectOption("active");
    await page.locator(".event-title-button").filter({ hasText: `${title} 수정` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "일정 삭제", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect.poll(async () => (await state(request)).events.some((item) => item.id === event.id)).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await request.delete(`/api/events/${event.id}`);
  }
});

test("sample notice analysis and coaching connect to editable event drafts", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "오늘의 캠퍼스" })).toBeVisible();
  await page.getByRole("button", { name: "공지 입력", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "샘플 분석", exact: true }).click();
  await expect(dialog.locator(".analysis-title")).toBeVisible();
  await expect(dialog.getByText("샘플", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "확인 · 일정 등록", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-label", "새 일정");
  await expect(dialog.getByLabel("일정 제목", { exact: true })).not.toHaveValue("");
  await expect(dialog.getByText("샘플 일정 · 앱 알림만 발송됩니다", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "취업 컨설팅", exact: true }).click();
  await page.getByRole("button", { name: "샘플 컨설팅", exact: true }).click();
  await expect(page.locator(".feedback-item").first()).toBeVisible();
  await expect(page.locator(".coaching-task").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("coaching.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("real reminder worker processes app reminders and keeps delivery records", async ({ page, request }) => {
  const title = `검수 알림 ${randomUUID().slice(0, 8)}`;
  const input = sampleEvent(title);
  input.reminders = [{ at: new Date(Date.now() + 3_000).toISOString(), channel: "app" }];
  const response = await request.post("/api/events", { data: input });
  expect(response.ok()).toBeTruthy();
  const saved: AppState = await response.json();
  const event = saved.events.find((item) => item.title === title)!;
  try {
    await expect.poll(async () => (await state(request)).notifications.find((item) => item.eventId === event.id)?.status, { timeout: 20_000 }).toBe("sent");
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: /^알림함/ }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    const delivered = (await state(request)).notifications.filter((item) => item.eventId === event.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].status).toBe("sent");
    expect(delivered[0].sentAt).toBeTruthy();
  } finally {
    await request.delete(`/api/events/${event.id}`);
  }
});

test("catalogs show samples, credentials stay private and invalid schedules are rejected", async ({ page, request }, testInfo) => {
  const initial = await state(request);
  expect(initial.settings).not.toHaveProperty("telegramToken");
  expect(initial.settings).not.toHaveProperty("token");
  const catalog = await request.get("/api/catalog");
  expect(catalog.ok()).toBeTruthy();
  const { opportunities } = await catalog.json();
  expect(opportunities.filter((item: { kind: string }) => item.kind === "scholarship").length).toBeGreaterThan(0);
  expect(opportunities.filter((item: { kind: string }) => item.kind === "job").length).toBeGreaterThan(0);
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "장학금", exact: true }).click();
  // 장학금 화면의 기본 출처는 국민대 장학공지이므로 샘플 출처로 바꾼다.
  await page.getByRole("group", { name: "공고 출처" }).getByRole("button", { name: "샘플", exact: true }).click();
  await expect(page.locator(".opportunity-card").first()).toBeVisible();
  await expect(page.getByText("샘플 공고", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("scholarships.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const invalid = sampleEvent(`거절 대상 ${randomUUID()}`);
  invalid.date = "2026-02-30";
  const result = await request.post("/api/events", { data: invalid });
  expect(result.status()).toBe(400);
  const hostile = await request.post("/api/events", { headers: { Origin: "https://unrelated.example" }, data: sampleEvent("교차 출처") });
  expect(hostile.status()).toBe(403);
});
