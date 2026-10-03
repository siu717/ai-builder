import { expect, test, type Page } from "@playwright/test";
import type {
  AnalysisResult,
  AppState,
  BookmarkletPayload,
  KookminImportResult,
  KookminNotice,
  KookminNoticeDetail,
  KookminScheduleItem,
} from "../lib/contracts";

function seoulDay(offsetDays: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

const SCHEDULE_SOURCE = "https://www.kookmin.ac.kr/user/scGuid/scSchedule/index.do";

function scheduleItem(id: string, title: string, startOffset: number, endOffset = startOffset): KookminScheduleItem {
  const startDate = seoulDay(startOffset);
  return { id, title, startDate, endDate: seoulDay(endOffset), year: Number(startDate.slice(0, 4)), source: SCHEDULE_SOURCE };
}

const pastItem = scheduleItem("kmu-e2e-0", "E2E 지난 개강일", -10);
const rangeItem = scheduleItem("kmu-e2e-1", "E2E 수강신청 변경기간", 5, 7);
const examItem = scheduleItem("kmu-e2e-2", "E2E 중간고사", 20);
const scheduleItems = [pastItem, rangeItem, examItem];

async function mockKookmin(page: Page) {
  await page.route("**/api/kookmin/schedule", (route) =>
    route.fulfill({ json: { items: scheduleItems, year: rangeItem.year, fetchedAt: new Date().toISOString(), cached: false } }),
  );
  await page.route("**/api/kookmin/bookmarklet", (route) =>
    route.fulfill({ json: { href: "javascript:void 0", code: "void 0" } }),
  );
}

/** Mirrors the bookmarklet's encoding: base64url of the UTF-8 JSON payload. */
function encodePayload(payload: BookmarkletPayload) {
  return encodeURIComponent(Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
}

async function openKookmin(page: Page) {
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "국민대", exact: true }).click();
  await expect(page.getByRole("heading", { name: "국민대 소식" })).toBeVisible();
}

function tab(page: Page, name: string) {
  return page.getByRole("group", { name: "국민대 소식 종류" }).getByRole("button", { name, exact: true });
}

function rowCheckbox(page: Page, title: string) {
  return page.getByRole("checkbox", { name: `${title} 선택`, exact: true });
}

test("academic schedule can be filtered, selected and imported into the calendar", async ({ page, request }) => {
  await mockKookmin(page);
  const stateResponse = await request.get("/api/state");
  expect(stateResponse.ok()).toBeTruthy();
  const state: AppState = await stateResponse.json();
  const posted: { items: { reminders: { at: string; channel: string }[] }[] }[] = [];
  await page.route("**/api/kookmin/import", async (route) => {
    posted.push(route.request().postDataJSON());
    const result: KookminImportResult = { created: 1, skipped: 0, failed: [], state };
    await route.fulfill({ json: result });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "오늘의 캠퍼스" })).toBeVisible();
  const widget = page.getByRole("region", { name: "국민대 학사일정" });
  await expect(widget.getByText(rangeItem.title)).toBeVisible();
  await expect(widget.getByText(pastItem.title)).toHaveCount(0);
  await widget.getByRole("button", { name: "모두 보기" }).click();
  await expect(page.getByRole("heading", { name: "국민대 소식" })).toBeVisible();

  await expect(tab(page, "학사일정")).toHaveAttribute("aria-pressed", "true");
  await expect(tab(page, "학교 공지")).toHaveAttribute("aria-pressed", "false");
  await expect(tab(page, "eCampus 과제")).toHaveAttribute("aria-pressed", "false");

  // 지난 일정은 "다가오는 일정만"을 끄면 보인다.
  await expect(rowCheckbox(page, rangeItem.title)).toBeVisible();
  await expect(rowCheckbox(page, pastItem.title)).toHaveCount(0);
  await page.getByLabel("다가오는 일정만").uncheck();
  await expect(rowCheckbox(page, pastItem.title)).toBeVisible();
  await page.getByLabel("다가오는 일정만").check();
  await expect(rowCheckbox(page, pastItem.title)).toHaveCount(0);

  // 월 필터는 시작일이 속한 달의 일정만 남긴다.
  const examMonth = examItem.startDate.slice(0, 7);
  await page.getByLabel("월 필터").selectOption(examMonth);
  await expect(rowCheckbox(page, examItem.title)).toBeVisible();
  await expect(rowCheckbox(page, rangeItem.title)).toHaveCount(rangeItem.startDate.startsWith(examMonth) ? 1 : 0);
  await page.getByLabel("월 필터").selectOption("all");

  const importButton = page.getByRole("button", { name: /선택 항목 캘린더에 가져오기/ });
  await expect(importButton).toBeDisabled();
  await rowCheckbox(page, rangeItem.title).check();
  await expect(importButton).toBeEnabled();
  await importButton.click();

  await expect(page.locator(".toast")).toContainText("학사일정 1개를 가져왔습니다");
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    items: [{
      kind: "academic",
      title: rangeItem.title,
      date: rangeItem.startDate,
      time: null,
      notes: `기간: ${rangeItem.startDate} ~ ${rangeItem.endDate}`,
      source: SCHEDULE_SOURCE,
      idempotencyKey: rangeItem.id,
    }],
  });
  // 기본 알림은 D-1 오전 9시(서울) 앱 알림 하나다.
  const reminders = posted[0].items[0].reminders;
  expect(reminders).toHaveLength(1);
  expect(reminders[0].channel).toBe("app");
  expect(new Date(reminders[0].at).getTime()).toBe(new Date(`${rangeItem.startDate}T09:00:00+09:00`).getTime() - 86_400_000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("bookmarklet hash opens the eCampus preview table", async ({ page }) => {
  await mockKookmin(page);
  const payload: BookmarkletPayload = {
    v: 1,
    source: "ecampus-bookmarklet",
    exportedAt: new Date().toISOString(),
    items: [
      { uid: "e2e-101", title: "E2E 운영체제 과제 3", course: "운영체제", date: seoulDay(4), time: "23:59", description: "PDF 제출", url: "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=101" },
      { uid: "e2e-102", title: "E2E 알고리즘 퀴즈", course: null, date: seoulDay(6), time: null, description: null, url: null },
    ],
  };
  await page.goto(`/#kmu-import=${encodePayload(payload)}`);
  await expect(page.getByRole("heading", { name: "국민대 소식" })).toBeVisible();
  await expect(tab(page, "eCampus 과제")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("eCampus에서 과제 2개를 가져왔습니다. 가져올 항목을 선택하세요")).toBeVisible();
  const table = page.locator(".kmu-table");
  await expect(table.getByText("E2E 운영체제 과제 3")).toBeVisible();
  await expect(table.getByText("시간 확인 필요")).toBeVisible();
  await expect(page.getByRole("button", { name: /선택 항목 가져오기 \(2\)/ })).toBeEnabled();
  await rowCheckbox(page, "E2E 알고리즘 퀴즈").uncheck();
  await expect(page.getByRole("button", { name: /선택 항목 가져오기 \(1\)/ })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");

  // 북마클릿 주소는 React가 막는 `javascript:` URL이라 DOM에 직접 넣는다.
  const bookmarklet = page.locator(".kmu-bookmarklet");
  await expect(bookmarklet).toHaveText("📌 국민대 과제 가져오기");
  await expect(bookmarklet).toHaveAttribute("href", "javascript:void 0");
  await expect(page.getByText("주소는 서버에 저장하지 않습니다")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("school notices open the event editor directly or through AI analysis", async ({ page }) => {
  await mockKookmin(page);
  const notice: KookminNotice = {
    id: "kmu-notice-academic-1001",
    board: "academic",
    articleNo: "1001",
    title: "E2E 수강신청 변경 안내",
    date: seoulDay(-1),
    url: "https://www.kookmin.ac.kr/user/kmuNews/notice/4/1001/view.do",
  };
  const detail: KookminNoticeDetail = { ...notice, text: "다음 주 금요일까지 수강신청 변경을 완료해 주세요." };
  const analysis: AnalysisResult = {
    mode: "live", title: "E2E 수강신청 변경 마감", kind: "assignment", date: seoulDay(8), time: null,
    subject: "", submission: "", summary: "수강신청 변경 마감 안내입니다.", missing: ["마감 시간 확인 필요"], documents: [], conditions: [],
  };
  let analyzeBody: unknown = null;
  await page.route(/\/api\/kookmin\/notices\?/, (route) =>
    route.fulfill({ json: { items: [notice], board: "academic", page: 1, hasMore: false, fetchedAt: new Date().toISOString() } }),
  );
  await page.route(/\/api\/kookmin\/notices\/academic\/1001$/, (route) => route.fulfill({ json: { item: detail } }));
  await page.route("**/api/analyze", async (route) => {
    analyzeBody = route.request().postDataJSON();
    await route.fulfill({ json: analysis });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "오늘의 캠퍼스" })).toBeVisible();
  await openKookmin(page);
  await tab(page, "학교 공지").click();
  await expect(page.getByRole("link", { name: notice.title })).toHaveAttribute("href", notice.url);

  // 일정 등록: 날짜는 비워 두고 사용자가 확인한다.
  await page.getByRole("button", { name: `${notice.title} 일정 등록`, exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-label", "새 일정");
  await expect(dialog.getByLabel("일정 제목", { exact: true })).toHaveValue(notice.title);
  await expect(dialog.getByRole("combobox", { name: "종류", exact: true })).toHaveValue("academic");
  await expect(dialog.getByLabel("날짜", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // AI 분석: 상대 날짜의 기준일로 공지 작성일을 보낸다.
  await page.getByRole("button", { name: `${notice.title} AI로 분석`, exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-label", "국민대 공지 AI 분석");
  await expect(dialog.getByRole("textbox", { name: "공지 내용", exact: true })).toHaveValue(detail.text);
  await dialog.getByRole("button", { name: "분석", exact: true }).click();
  await expect(dialog.locator(".analysis-title")).toHaveText(analysis.title);
  expect(analyzeBody).toEqual({ text: detail.text, kind: "assignment", referenceDate: notice.date, classTime: null, sample: false });
  await dialog.getByRole("button", { name: "확인 · 일정 등록", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-label", "새 일정");
  await expect(dialog.getByLabel("일정 제목", { exact: true })).toHaveValue(analysis.title);
  await expect(dialog.getByLabel("날짜", { exact: true })).toHaveValue(analysis.date!);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
