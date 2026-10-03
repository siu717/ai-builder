import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { AppState, EventInput } from "../lib/contracts";

test("preparation checklist saves edits and progress on desktop and mobile", async ({ page, request }, testInfo) => {
  const title = `준비물 검수 ${randomUUID().slice(0, 8)}`;
  const input: EventInput = {
    title,
    kind: "scholarship",
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(Date.now() + 86_400_000)),
    time: null,
    notes: "",
    source: "체크리스트 검수용 샘플",
    isSample: true,
    reminders: [{ at: new Date(Date.now() + 3_600_000).toISOString(), channel: "app" }],
    idempotencyKey: randomUUID(),
  };
  const response = await request.post("/api/events", { data: input });
  expect(response.ok()).toBeTruthy();
  const initial: AppState = await response.json();
  const saved = initial.events.find((event) => event.title === title)!;
  const reminders = initial.notifications.filter((item) => item.eventId === saved.id);

  async function openEvent() {
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "캘린더", exact: true }).click();
    await page.getByRole("button", { name: "마감순", exact: true }).click();
    await page.locator(".event-title-button").filter({ hasText: title }).click();
  }

  try {
    await page.goto("/");
    await openEvent();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "준비물 추가", exact: true }).click();
    await dialog.getByLabel("준비물 1", { exact: true }).fill("재학증명서 발급");
    await dialog.getByRole("button", { name: "준비물 추가", exact: true }).click();
    await dialog.getByLabel("준비물 2", { exact: true }).fill("신청서 서명");
    await dialog.getByRole("checkbox", { name: "재학증명서 발급 준비 완료", exact: true }).check();
    await expect(dialog.getByText("1/2개 준비 완료", { exact: true })).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath("checklist-editor.png") });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dialog.getByRole("button", { name: "일정 저장", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".event-title-button").filter({ hasText: title }).getByLabel("준비물 2개 중 1개 완료")).toBeVisible();

    await page.reload();
    await openEvent();
    await expect(dialog.getByLabel("준비물 1", { exact: true })).toHaveValue("재학증명서 발급");
    await expect(dialog.getByRole("checkbox", { name: "재학증명서 발급 준비 완료", exact: true })).toBeChecked();
    await dialog.getByLabel("준비물 2", { exact: true }).fill("신청서 서명 후 스캔");
    await dialog.getByRole("button", { name: "준비물 1 삭제", exact: true }).click();
    await expect(dialog.getByLabel("준비물 1", { exact: true })).toHaveValue("신청서 서명 후 스캔");
    await dialog.getByRole("checkbox", { name: "신청서 서명 후 스캔 준비 완료", exact: true }).check();
    await dialog.getByRole("button", { name: "일정 저장", exact: true }).click();
    await expect(dialog).not.toBeVisible();

    const result: AppState = await (await request.get("/api/state")).json();
    const updated = result.events.find((event) => event.id === saved.id)!;
    expect(updated.checklist).toEqual([{ id: expect.any(String), text: "신청서 서명 후 스캔", completed: true }]);
    expect(updated.completed).toBe(false);
    expect(result.notifications.filter((item) => item.eventId === saved.id)).toEqual(reminders);
  } finally {
    await request.delete(`/api/events/${saved.id}`);
  }
});

test("scholarship documents become an editable preparation list before saving", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "장학금", exact: true }).click();
  // 장학금 화면의 기본 출처는 국민대 장학공지이므로 샘플 출처로 바꾼다.
  await page.getByRole("group", { name: "공고 출처" }).getByRole("button", { name: "샘플", exact: true }).click();
  const documents = await page.locator(".opportunity-detail .documents li").allTextContents();
  expect(documents.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "신청 일정 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  for (let index = 0; index < documents.length; index++) {
    await expect(dialog.getByLabel(`준비물 ${index + 1}`, { exact: true })).toHaveValue(documents[index]);
  }
  await expect(dialog.getByText(`0/${documents.length}개 준비 완료`, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});

test("coaching preparation tasks can be collected into one checklist with a user-chosen date", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "취업 컨설팅", exact: true }).click();
  await page.getByRole("button", { name: "샘플 컨설팅", exact: true }).click();
  await expect(page.getByRole("button", { name: "준비 계획 한 번에 등록", exact: true })).toBeVisible();
  const tasks = await page.locator(".coaching-task strong").allTextContents();
  expect(tasks.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "준비 계획 한 번에 등록", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("날짜", { exact: true })).toHaveValue("");
  for (let index = 0; index < tasks.length; index++) {
    await expect(dialog.getByLabel(`준비물 ${index + 1}`, { exact: true })).toHaveValue(tasks[index]);
  }
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});
