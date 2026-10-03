import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { AppState } from "../lib/contracts";

test("manual event creation saves a precise reminder and completion cancels it", async ({ page, request }) => {
  const title = `직접 등록 ${randomUUID().slice(0, 8)}`;
  const tomorrow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() + 86_400_000));
  let eventId: string | undefined;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "일정 추가", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "새 일정" });
    await dialog.getByLabel("일정 제목", { exact: true }).fill(title);
    await dialog.getByLabel("날짜", { exact: true }).fill(tomorrow);
    await dialog.getByRole("button", { name: "1분 뒤", exact: true }).click();
    const beforeSave = Date.now();
    await dialog.getByRole("button", { name: "일정 저장", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const state: AppState = await (await request.get("/api/state")).json();
    const matches = state.events.filter((item) => item.title === title);
    expect(matches).toHaveLength(1);
    eventId = matches[0].id;
    expect(matches[0].isSample).toBe(false);
    expect(matches[0].reminders).toHaveLength(1);
    expect(matches[0].reminders[0].channel).toBe("app");
    expect(new Date(matches[0].reminders[0].at).getTime() - beforeSave).toBeGreaterThan(55_000);
    await page.getByRole("button", { name: `${title} 완료 처리`, exact: true }).click();
    await expect.poll(async () => {
      const current: AppState = await (await request.get("/api/state")).json();
      return current.notifications.find((item) => item.eventId === eventId)?.status;
    }).toBe("cancelled");
  } finally {
    if (eventId) await request.delete(`/api/events/${eventId}`);
    else {
      const state: AppState = await (await request.get("/api/state")).json();
      for (const event of state.events.filter((item) => item.title === title)) {
        await request.delete(`/api/events/${event.id}`);
      }
    }
  }
});

test("profile edits survive reload and unconfigured Telegram cannot be activated", async ({ page, request }, testInfo) => {
  const initial: AppState = await (await request.get("/api/state")).json();
  const name = `검수 학생 ${randomUUID().slice(0, 6)}`;
  try {
    await page.goto("/");
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "설정", exact: true }).click();
    await page.getByLabel("이름", { exact: true }).fill(name);
    await page.getByRole("combobox", { name: "학년", exact: true }).selectOption("3");
    await page.getByLabel("전공", { exact: true }).fill("컴퓨터공학");
    await page.getByRole("button", { name: "프로필 저장", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("학생 프로필을 저장했습니다.");
    await page.reload();
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.getByLabel("이름", { exact: true })).toHaveValue(name);
    await expect(page.getByRole("combobox", { name: "학년", exact: true })).toHaveValue("3");
    await expect(page.getByLabel("Bot Token", { exact: true })).toHaveAttribute("type", "password");
    if (!initial.settings.telegramConfigured) {
      await expect(page.getByRole("button", { name: "테스트 발송", exact: true })).toBeDisabled();
      await page.getByLabel("텔레그램 알림 활성화", { exact: true }).check();
      await page.getByLabel("Chat ID", { exact: true }).fill("123456789");
      await page.getByRole("button", { name: "연결 저장", exact: true }).click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText("봇 토큰과 Chat ID를 설정해주세요.");
      const state: AppState = await (await request.get("/api/state")).json();
      expect(state.settings.telegramEnabled).toBe(initial.settings.telegramEnabled);
    }
    await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await request.put("/api/profile", { data: initial.profile });
  }
});
