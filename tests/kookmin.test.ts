import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import vm from "node:vm";
import type { BookmarkletPayload, EcampusAssignment, KookminImportItem, KookminNotice, KookminScheduleItem } from "../lib/contracts";
import { EVENT_KINDS, KIND_LABELS } from "../lib/contracts";
import { createDatabase } from "../lib/db";
import { RouteError } from "../lib/http";
import { buildBookmarklet, buildBookmarkletCode, decodeBookmarkletPayload, encodeBookmarkletPayload, readBookmarkletHash } from "../lib/kookmin/bookmarklet";
import { normalizeEcampusExportUrl, previewEcampus } from "../lib/kookmin/ecampus";
import { fetchText, UpstreamError } from "../lib/kookmin/http";
import { IcsFormatError, parseIcs, unfoldIcs } from "../lib/kookmin/ics";
import { assignmentToImportItem, noticeToImportItem, presetReminders, scheduleToImportItem } from "../lib/kookmin/mapping";
import { clearNoticeCache, getNoticeDetail, getNotices, parseNoticeDetail, parseNoticeList, parseNoticePaging } from "../lib/kookmin/notices";
import { clearScheduleCache, detectAcademicYear, getSchedule, parseSchedule, seoulAcademicYear } from "../lib/kookmin/schedule";
import { importEvents } from "../lib/store";

const fixture = (name: string) => readFile(join(import.meta.dirname, "fixtures", name), "utf8");
const htmlResponse = (body: string) => new Response(body, { headers: { "Content-Type": "text/html;charset=utf-8" } });

async function database(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-kookmin-"));
  const db = await createDatabase(`file:${join(directory, "private", "campus.db")}`);
  // Windows는 닫은 직후의 SQLite 파일을 잠깐 잡고 있어 삭제를 다시 시도한다.
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined); });
  return db;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error) { return error; }
  assert.fail("expected a rejection");
}

test("academic kind is part of the event contract", () => {
  assert.ok(EVENT_KINDS.includes("academic"));
  assert.equal(KIND_LABELS.academic, "학사 일정");
});

test("schedule parser reads ranges, single days and infers the year from the academic year", async () => {
  const html = await fixture("kookmin-schedule.html");
  assert.equal(detectAcademicYear(html), 2026);
  const items = parseSchedule(html, 2026);
  assert.equal(items.length, 7);
  const byTitle = (title: string) => items.find((item) => item.title === title);
  assert.deepEqual([byTitle("1학기 개강일")?.startDate, byTitle("1학기 개강일")?.endDate], ["2026-03-03", "2026-03-03"]);
  assert.equal(byTitle("1학기 수강신청 변경/포기 기간")?.endDate, "2026-03-09");
  // &nbsp;로 띄운 행과 학년도가 제목에 들어 있는 행
  assert.equal(byTitle("2025학년도 후기 학위수여식(대학/대학원 자율시행)")?.startDate, "2026-08-19");
  // 하루짜리 행과 엔티티
  const midterm = byTitle("2학기 중간시험 & 수업일수 1/2선");
  assert.deepEqual([midterm?.startDate, midterm?.endDate], ["2026-10-20", "2026-10-20"]);
  // 해를 넘기는 기간
  assert.deepEqual([byTitle("동계 계절학기")?.startDate, byTitle("동계 계절학기")?.endDate], ["2026-12-22", "2027-01-12"]);
  // 1~2월은 다음 해
  assert.equal(byTitle("2026학년도 전기 학위수여식")?.startDate, "2027-02-17");
  assert.equal(byTitle("2027학년도 1학기 등록 기간")?.endDate, "2027-02-26");
  assert.ok(items.every((item) => item.year === 2026 && item.id.startsWith(`kmu-sched-2026-${item.startDate}-`)));
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  assert.deepEqual(parseSchedule(html, 2026).map((item) => item.id), items.map((item) => item.id));
});

test("schedule year falls back to the Seoul academic year when the page has no heading", () => {
  const bare = "<table><tr><td>01월</td><td>01.05 (월) ~ 01.09 (금)</td><td class=\"cal_desc\">성적 정정 기간</td></tr><tr><td>09월</td><td>09.01 (월)</td><td class=\"cal_desc\">2학기 개강일</td></tr></table>";
  assert.equal(detectAcademicYear(bare), null);
  const items = parseSchedule(bare, 2025);
  assert.equal(items[0].startDate, "2026-01-05");
  assert.equal(items[1].startDate, "2025-09-01");
  assert.equal(seoulAcademicYear(new Date("2026-02-28T14:59:00Z")), 2025);
  assert.equal(seoulAcademicYear(new Date("2026-02-28T15:00:00Z")), 2026);
  assert.equal(seoulAcademicYear(new Date("2026-10-03T00:00:00Z")), 2026);
});

test("schedule fetcher caches for ten minutes and reports upstream failures in Korean", async () => {
  clearScheduleCache();
  const html = await fixture("kookmin-schedule.html");
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return htmlResponse(html); };
  const now = new Date("2026-10-03T00:00:00Z");
  const first = await getSchedule({ now, fetcher });
  assert.equal(first.cached, false);
  assert.equal(first.year, 2026);
  assert.equal(first.items.length, 7);
  const second = await getSchedule({ now: new Date(now.getTime() + 9 * 60_000), fetcher });
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  await getSchedule({ now: new Date(now.getTime() + 11 * 60_000), fetcher });
  assert.equal(calls, 2);
  clearScheduleCache();
  const failing: typeof fetch = async () => new Response("forbidden", { status: 403 });
  const error = await rejection(getSchedule({ now, fetcher: failing }));
  assert.ok(error instanceof RouteError);
  assert.equal(error.status, 502);
  assert.equal(error.message, "국민대 학사일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  clearScheduleCache();
});

test("notice list parser reads pinned and dated rows with absolute links", async () => {
  const html = await fixture("kookmin-notice-list.html");
  const items = parseNoticeList(html, "academic");
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { id: "kmu-notice-academic-12412", board: "academic", articleNo: "12412", title: "2026학년도 2학기 중간시험 시행 안내", date: "", url: "https://www.kookmin.ac.kr/user/kmuNews/notice/4/12412/view.do" });
  assert.equal(items[1].date, "2026-10-03");
  assert.equal(items[1].title, "2026학년도 2학기 제1전공 변경신청 안내");
  // 제목 속 날짜가 아니라 작성일을 읽는다.
  assert.equal(items[2].title, "[국제교류팀] 2027.03.02 출국 교환학생 <사전교육> 안내 (~10/7)");
  assert.equal(items[2].date, "2026-09-30");
  assert.deepEqual(parseNoticePaging(html), { page: 1, totalPages: 41 });
});

test("notice detail parser keeps body text and drops scripts, styles and navigation", async () => {
  const parsed = parseNoticeDetail(await fixture("kookmin-notice-detail.html"));
  assert.ok(parsed);
  assert.equal(parsed.title, "2026학년도 2학기 제1전공 변경신청 안내");
  assert.equal(parsed.date, "2026-10-03");
  assert.ok(parsed.text.includes("제1전공 변경을 희망하는 학생은 아래 기간에 신청하시기 바랍니다."));
  assert.ok(parsed.text.includes("종합정보시스템 > 학적 > 전공변경 신청"));
  assert.ok(parsed.text.includes("※ 문의 & 상담: 교무팀"));
  assert.ok(!/alert|hidden-style|이전 글|<|&nbsp;/.test(parsed.text));
  assert.equal(parseNoticeDetail("<html><body>없는 글</body></html>"), null);
  const long = parseNoticeDetail(`<p class="view_tit">긴 글</p><div class="view_inner">${"가".repeat(30_000)}</div><div class="view_bottom"></div>`);
  assert.equal(long?.text.length, 20_000);
});

test("notice fetchers cache per board and page and map missing articles to 404", async () => {
  clearNoticeCache();
  const list = await fixture("kookmin-notice-list.html");
  const detail = await fixture("kookmin-notice-detail.html");
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/999/view.do")) return htmlResponse("<html><body>empty</body></html>");
    return htmlResponse(url.includes("view.do") ? detail : list);
  };
  const now = new Date("2026-10-03T00:00:00Z");
  const page = await getNotices("academic", 1, { now, fetcher });
  assert.equal(page.board, "academic");
  assert.equal(page.page, 1);
  assert.equal(page.hasMore, true);
  assert.equal(page.items.length, 3);
  await getNotices("academic", 1, { now, fetcher });
  assert.equal(requested.length, 1);
  assert.equal(requested[0], "https://www.kookmin.ac.kr/user/kmuNews/notice/4/index.do");
  const item = await getNoticeDetail("academic", "12465", { now, fetcher });
  assert.equal(item.id, "kmu-notice-academic-12465");
  assert.equal(item.url, "https://www.kookmin.ac.kr/user/kmuNews/notice/4/12465/view.do");
  assert.ok(item.text.includes("신청기간"));
  const missing = await rejection(getNoticeDetail("academic", "999", { now, fetcher }));
  assert.ok(missing instanceof RouteError);
  assert.equal(missing.status, 404);
  clearNoticeCache();
  const down = await rejection(getNotices("scholarship", 2, { now, fetcher: async () => { throw new Error("offline"); } }));
  assert.ok(down instanceof RouteError);
  assert.equal(down.status, 502);
  clearNoticeCache();
});

test("ICS parser unfolds lines, converts to Seoul time and strips due suffixes", async () => {
  const text = await fixture("ecampus-calendar.ics");
  assert.ok(unfoldIcs(text).some((line) => line.startsWith("DESCRIPTION:") && line.endsWith("확인하세요.")));
  const { items, calendarName } = parseIcs(text);
  assert.equal(calendarName, "국민대학교 eCampus");
  assert.deepEqual(items.map((item) => item.uid), ["101@ecampus.kookmin.ac.kr", "103@ecampus.kookmin.ac.kr", "104@ecampus.kookmin.ac.kr", "102@ecampus.kookmin.ac.kr"]);
  const [report, quiz, night, proposal] = items;
  // UTC 20261008T000000Z → 한국 시각 10월 8일 09:00
  assert.deepEqual([report.title, report.course, report.date, report.time], ["3주차 실습 보고서", "웹프로그래밍(01)", "2026-10-08", "09:00"]);
  assert.equal(report.description, "보고서를 PDF로 제출하세요.\n분량, 형식; 자유이며 늦은 제출은 감점됩니다. 자세한 내용은 강의계획서를 확인하세요.");
  assert.equal(report.url, null);
  assert.deepEqual([quiz.title, quiz.date, quiz.time], ["퀴즈 2", "2026-10-10", "23:59"]);
  // UTC 15:00은 한국에서 다음 날 00:00
  assert.deepEqual([night.title, night.course, night.date, night.time], ["심야 과제", null, "2026-10-12", "00:00"]);
  // DATE만 있으면 시각은 null
  assert.deepEqual([proposal.title, proposal.date, proposal.time, proposal.description], ["중간 프로젝트 제안서", "2026-10-15", null, null]);
  assert.throws(() => parseIcs("Invalid authentication"), IcsFormatError);
  // LF 줄바꿈과 다른 시간대도 받는다.
  const london = parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:tz-1\nSUMMARY:Essay is due\nDTSTART;TZID=Europe/London:20261101T120000\nEND:VEVENT\nEND:VCALENDAR\n").items[0];
  assert.deepEqual([london.title, london.date, london.time], ["Essay", "2026-11-01", "21:00"]);
});

test("eCampus preview only fetches the export endpoint and never leaks the token", async () => {
  const ics = await fixture("ecampus-calendar.ics");
  const good = "https://ecampus.kookmin.ac.kr/calendar/export_execute.php?userid=1234&authtoken=secrettoken123&preset_what=all&preset_time=recentupcoming";
  assert.equal(normalizeEcampusExportUrl(good), good);
  for (const bad of [
    "not a url",
    "http://ecampus.kookmin.ac.kr/calendar/export_execute.php?userid=1&authtoken=a",
    "https://ecampus.kookmin.ac.kr.evil.example/calendar/export_execute.php?userid=1&authtoken=a",
    "https://user@ecampus.kookmin.ac.kr/calendar/export_execute.php?userid=1&authtoken=a",
    "https://ecampus.kookmin.ac.kr:8443/calendar/export_execute.php?userid=1&authtoken=a",
    "https://ecampus.kookmin.ac.kr/login/index.php?userid=1&authtoken=a",
    "https://www.kookmin.ac.kr/calendar/export_execute.php?userid=1&authtoken=a",
  ]) {
    assert.throws(() => normalizeEcampusExportUrl(bad), (error) => error instanceof RouteError && error.status === 400, bad);
  }
  const requested: { url: string; redirect: RequestRedirect | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requested.push({ url: String(input), redirect: init?.redirect });
    return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
  };
  const preview = await previewEcampus({ url: good }, { fetcher, now: new Date("2026-10-03T00:00:00Z") });
  assert.equal(preview.items.length, 4);
  assert.equal(preview.calendarName, "국민대학교 eCampus");
  assert.equal(preview.fetchedAt, "2026-10-03T00:00:00.000Z");
  assert.deepEqual(requested, [{ url: good, redirect: "manual" }]);
  assert.ok(!JSON.stringify(preview).includes("secrettoken123"));
  assert.equal((await previewEcampus({ ics })).items.length, 4);

  const expired = await rejection(previewEcampus({ url: good }, { fetcher: async () => new Response("Invalid authentication") }));
  assert.ok(expired instanceof RouteError);
  assert.equal(expired.status, 502);
  assert.ok(expired.message.includes("만료된 링크"));
  assert.ok(!expired.message.includes("secrettoken123"));
  const redirected = await rejection(previewEcampus({ url: good }, { fetcher: async () => new Response(null, { status: 303, headers: { Location: "https://ecampus.kookmin.ac.kr/login/index.php" } }) }));
  assert.ok(redirected instanceof RouteError && redirected.status === 502);
  const offline = await rejection(previewEcampus({ url: good }, { fetcher: async () => { throw new Error(`connect failed ${good}`); } }));
  assert.ok(offline instanceof RouteError && !offline.message.includes("secrettoken123"));
  const notIcs = await rejection(previewEcampus({ ics: "<html>로그인</html>" }));
  assert.ok(notIcs instanceof RouteError && notIcs.status === 400 && notIcs.message.includes("ICS"));
  await assert.rejects(previewEcampus({ url: good, ics }));
  await assert.rejects(previewEcampus({}));
});

test("bookmarklet payload round-trips Korean text and rejects tampered input", () => {
  const payload: BookmarkletPayload = {
    v: 1,
    source: "ecampus-bookmarklet",
    exportedAt: "2026-10-03T04:00:00.000Z",
    items: [
      { uid: "101@ecampus.kookmin.ac.kr", title: "3주차 실습 보고서 🙂", course: "웹프로그래밍(01)", date: "2026-10-08", time: "09:00", description: null, url: "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=101" },
      { uid: "102@ecampus.kookmin.ac.kr", title: "제안서", course: null, date: "2026-10-15", time: null, description: null, url: null },
    ],
  };
  const encoded = encodeBookmarkletPayload(payload);
  assert.deepEqual(decodeBookmarkletPayload(encoded), payload);
  assert.deepEqual(decodeBookmarkletPayload(`#kmu-import=${encoded}`), payload);
  // 북마클릿 밖에서 만든 표준 base64(+, /, =)도 읽는다.
  assert.deepEqual(decodeBookmarkletPayload(Buffer.from(JSON.stringify(payload), "utf8").toString("base64")), payload);
  const foreign = decodeBookmarkletPayload(encodeBookmarkletPayload({ ...payload, items: [{ ...payload.items[0], url: "https://evil.example/phish" }] }));
  assert.equal(foreign.items[0].url, null);
  for (const bad of ["", "%%%", "not-base64!", Buffer.from("{}").toString("base64"), encodeBookmarkletPayload({ ...payload, items: [{ ...payload.items[0], date: "2026-02-30" }] })]) {
    assert.throws(() => decodeBookmarkletPayload(bad), (error) => error instanceof Error && /[가-힣]/.test(error.message), bad);
  }
});

test("bookmarklet is self-contained, targets the app origin and compiles", () => {
  const code = buildBookmarkletCode("http://127.0.0.1:3000/some/path");
  assert.ok(code.includes("\"http://127.0.0.1:3000\""));
  assert.ok(code.includes("core_calendar_get_action_events_by_timesort"));
  assert.ok(code.includes("ecampus.kookmin.ac.kr"));
  assert.ok(!/password|document\.cookie/i.test(code));
  assert.doesNotThrow(() => new Function(code));
  const href = buildBookmarklet("http://127.0.0.1:3000");
  assert.ok(href.startsWith("javascript:"));
  assert.equal(decodeURIComponent(href.slice("javascript:".length)), buildBookmarkletCode("http://127.0.0.1:3000"));
  assert.throws(() => buildBookmarklet("javascript:alert(1)"));
  assert.throws(() => buildBookmarklet("nonsense"));
});

test("importEvents creates, skips duplicates and reports invalid items without aborting", async (t) => {
  const db = await database(t);
  const now = new Date("2026-10-03T00:00:00Z");
  const items: KookminImportItem[] = [
    {
      kind: "academic", title: "2학기 중간시험", date: "2026-10-20", time: null, notes: "", source: "https://www.kookmin.ac.kr/user/scGuid/scSchedule/index.do", idempotencyKey: "kmu-sched-2026-2026-10-20-midterm",
      reminders: [
        { at: "2026-10-01T09:00:00+09:00", channel: "app" }, // 이미 지남
        { at: "2026-10-19T09:00:00+09:00", channel: "app" },
        { at: "2026-10-19T00:00:00Z", channel: "app" }, // 위와 같은 시각
        { at: "2026-10-21T09:00:00+09:00", channel: "app" }, // 마감 뒤
      ],
    },
    { kind: "assignment", title: "3주차 실습 보고서", date: "2026-10-08", time: "09:00", notes: "웹프로그래밍(01)", source: "국민대 eCampus", idempotencyKey: "ecampus-101@ecampus.kookmin.ac.kr", reminders: [] },
    { kind: "assignment", title: "없는 날짜", date: "2026-02-30", time: null, notes: "", source: "", idempotencyKey: "bad-date", reminders: [] },
    { kind: "assignment", title: "", date: "2026-10-09", time: null, notes: "", source: "", idempotencyKey: "bad-title", reminders: [] },
    { kind: "academic", title: "같은 키 다시", date: "2026-10-20", time: null, notes: "", source: "", idempotencyKey: "kmu-sched-2026-2026-10-20-midterm", reminders: [] },
  ];
  const result = await importEvents(items, db, now);
  assert.equal(result.created, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.failed.map((item) => item.idempotencyKey), ["bad-date", "bad-title"]);
  assert.ok(result.failed.every((item) => /[가-힣]/.test(item.error)));
  assert.equal(result.state.events.length, 2);
  assert.ok(result.state.events.every((event) => event.isSample === false && event.completed === false));
  const midterm = result.state.events.find((event) => event.kind === "academic");
  assert.equal(midterm?.title, "2학기 중간시험");
  assert.deepEqual(midterm?.reminders, [{ at: "2026-10-19T09:00:00+09:00", channel: "app" }]);
  assert.equal(result.state.notifications.length, 1);
  assert.equal(result.state.notifications[0].scheduledAt, "2026-10-19T00:00:00.000Z");
  assert.equal(result.state.notifications[0].status, "pending");

  const again = await importEvents(items, db, now);
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 3);
  assert.equal(again.failed.length, 2);
  assert.equal(again.state.events.length, 2);
  assert.equal(again.state.notifications.length, 1);

  const malformed = await importEvents([null, { title: "키 없음" }, { ...items[1], idempotencyKey: "bad-reminder", reminders: [{ at: "내일", channel: "app" }] }], db, now);
  assert.equal(malformed.created, 0);
  assert.equal(malformed.failed.length, 3);
  assert.equal(malformed.state.events.length, 2);
});

test("importEvents trims long notes and sources and answers type errors in Korean", async (t) => {
  const db = await database(t);
  const now = new Date("2026-10-03T00:00:00Z");
  const base: KookminImportItem = { kind: "academic", title: "긴 공지", date: "2026-10-20", time: null, notes: "가".repeat(12_000), source: `https://www.kookmin.ac.kr/${"a".repeat(3000)}`, idempotencyKey: "kmu-notice-academic-1", reminders: [] };
  const tooMany = Array.from({ length: 13 }, (_unused, index) => ({ at: new Date(Date.UTC(2026, 9, 10, index)).toISOString(), channel: "app" as const }));
  const result = await importEvents([
    base,
    { ...base, idempotencyKey: "wrong-kind", kind: "holiday" },
    { ...base, idempotencyKey: "wrong-time", time: "25:00" },
    { ...base, idempotencyKey: "too-many-reminders", reminders: tooMany },
    { ...base, idempotencyKey: "k".repeat(201) },
  ], db, now);
  assert.equal(result.created, 1);
  assert.deepEqual(result.failed.map((item) => item.idempotencyKey), ["wrong-kind", "wrong-time", "too-many-reminders", "k".repeat(201)]);
  assert.ok(result.failed.every((item) => /[가-힣]/.test(item.error) && !/invalid|expected/i.test(item.error)), JSON.stringify(result.failed.map((item) => item.error)));
  assert.equal(result.state.events[0].notes.length, 10_000);
  assert.equal(result.state.events[0].source.length, 2000);
});

test("schedule parser honours year labels, full dates and skips rows it cannot date", () => {
  const html = `<table id="monthTable"><thead><tr><th>월</th><th>기간</th><th>내용</th></tr></thead><tbody>
    <tr><td><em>2027년 01</em>월</td><td>12.28 (월) ~ 01.05 (화)</td><td class="cal_desc">해를 넘겨 이어지는 일정</td></tr>
    <tr><td><em>2027년 02</em>월</td><td>02.01 (월) ~ 03.02 (화)</td><td class="cal_desc">다음 학년도까지 이어지는 일정</td></tr>
    <tr><td></td><td>2027.01.04 ~ 2027.01.22</td><td class="cal_desc">연도가 적힌 일정</td></tr>
    <tr><td><em>02</em>월</td><td>02.30 (화)</td><td class="cal_desc">없는 날짜</td></tr>
    <tr><td><em>04</em>월</td><td>추후 공지</td><td class="cal_desc">날짜 미정</td></tr>
    <tr><td><em>05</em>월</td><td>05.05 (화) ~ 05.05 (화)</td><td class="cal_desc">어린이날</td></tr>
    <tr><td><em>05</em>월</td><td>05.05 (화) ~ 05.05 (화)</td><td class="cal_desc">어린이날</td></tr>
  </tbody></table>`;
  const items = parseSchedule(html, 2026);
  assert.deepEqual(items.map((item) => [item.title, item.startDate, item.endDate]), [
    ["해를 넘겨 이어지는 일정", "2026-12-28", "2027-01-05"],
    ["다음 학년도까지 이어지는 일정", "2027-02-01", "2027-03-02"],
    ["연도가 적힌 일정", "2027-01-04", "2027-01-22"],
    ["어린이날", "2026-05-05", "2026-05-05"],
  ]);
  assert.equal(items[3].id, "kmu-sched-2026-2026-05-05-어린이날");
  assert.equal(items[0].source, "https://www.kookmin.ac.kr/user/scGuid/scSchedule/index.do?yyyy=2026");
});

test("schedule fetcher asks for the Seoul academic year, serves stale data on outage and rejects unknown layouts", async () => {
  clearScheduleCache();
  const html = await fixture("kookmin-schedule.html");
  const requested: string[] = [];
  let online = true;
  const fetcher: typeof fetch = async (input) => {
    requested.push(String(input));
    if (!online) throw new Error("offline");
    return htmlResponse(html);
  };
  // 2027년 1월(서울)은 아직 2026학년도다.
  const january = new Date("2027-01-15T00:00:00Z");
  const first = await getSchedule({ now: january, fetcher });
  assert.equal(requested[0], "https://www.kookmin.ac.kr/user/scGuid/scSchedule/index.do?yyyy=2026");
  assert.equal(first.year, 2026);
  await getSchedule({ year: 2027, now: january, fetcher });
  assert.equal(requested[1], "https://www.kookmin.ac.kr/user/scGuid/scSchedule/index.do?yyyy=2027");
  online = false;
  const stale = await getSchedule({ now: new Date(january.getTime() + 30 * 60_000), fetcher });
  assert.equal(stale.cached, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  clearScheduleCache();
  const changed = await rejection(getSchedule({ now: january, fetcher: async () => htmlResponse("<html><body>점검 중입니다</body></html>") }));
  assert.ok(changed instanceof RouteError && changed.status === 502);
  const huge = await rejection(getSchedule({ now: january, fetcher: async () => htmlResponse("가".repeat(800_000)) }));
  assert.ok(huge instanceof RouteError && huge.status === 502);
  clearScheduleCache();
});

test("fetchText decodes EUC-KR, enforces the size cap and times out without leaking the address", async () => {
  const eucKr = Uint8Array.from([0xb1, 0xb9, 0xb9, 0xce, 0xb4, 0xeb]);
  const byHeader = await fetchText("https://www.kookmin.ac.kr/", { fetcher: async () => new Response(eucKr, { headers: { "Content-Type": "text/html; charset=EUC-KR" } }) });
  assert.equal(byHeader.text, "국민대");
  const meta = new TextEncoder().encode("<html><head><meta charset=\"euc-kr\"></head><body>");
  const sniffed = new Uint8Array(meta.length + eucKr.length);
  sniffed.set(meta);
  sniffed.set(eucKr, meta.length);
  const byMeta = await fetchText("https://www.kookmin.ac.kr/", { fetcher: async () => new Response(sniffed, { headers: { "Content-Type": "text/html" } }) });
  assert.ok(byMeta.text.endsWith("국민대"));

  const secret = "https://ecampus.kookmin.ac.kr/calendar/export_execute.php?userid=1&authtoken=topsecret";
  const tooLarge = await rejection(fetchText(secret, { maxBytes: 10, fetcher: async () => new Response("0123456789abcdef") }));
  assert.ok(tooLarge instanceof UpstreamError && tooLarge.reason === "too-large");
  const hanging: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error(`aborted ${secret}`)));
  });
  const timedOut = await rejection(fetchText(secret, { timeoutMs: 20, fetcher: hanging }));
  assert.ok(timedOut instanceof UpstreamError && timedOut.reason === "timeout");
  const refused = await rejection(fetchText(secret, { fetcher: async () => { throw new Error(`ECONNREFUSED ${secret}`); } }));
  assert.ok(refused instanceof UpstreamError && refused.reason === "network");
  const forbidden = await rejection(fetchText(secret, { fetcher: async () => new Response("no", { status: 403 }) }));
  assert.ok(forbidden instanceof UpstreamError && forbidden.reason === "status" && forbidden.upstreamStatus === 403);
  for (const error of [tooLarge, timedOut, refused, forbidden]) assert.ok(!String((error as Error).message).includes("topsecret"));
});

test("general board keeps each article's own board number and merges pinned duplicates", async () => {
  clearNoticeCache();
  const html = `<div class="board_list"><ul>
    <li class="notice"><a href="/user/kmuNews/notice/7/12450/view.do?currentPageNo=1"><p class="title">2027 장학생 선발 안내</p></a></li>
    <li><a href="/user/kmuNews/notice/6/12456/view.do?currentPageNo=1"><input type="hidden" value="교양대학"/><div class="board_txt"><span class="ctg_name">특강공지</span><p class="title">글말특강 2회차 안내</p><div class="board_etc"><span>2026.10.02</span><span>교양대학</span></div></div></a></li>
    <li><a href="/user/kmuNews/notice/7/12450/view.do?currentPageNo=1"><div class="board_txt"><span class="ctg_name">장학공지</span><p class="title">2027 장학생 선발 안내</p><div class="board_etc"><span>2026.10.01</span></div></div></a></li>
    <li><a href="/user/other/page.do">다른 링크</a></li>
  </ul></div><ul class="tab_bottom"><li>페이지&nbsp;<span>3 / 3</span></li></ul>`;
  const items = parseNoticeList(html, "general");
  assert.deepEqual(items, [
    { id: "kmu-notice-general-12450", board: "general", articleNo: "12450", title: "2027 장학생 선발 안내", date: "2026-10-01", url: "https://www.kookmin.ac.kr/user/kmuNews/notice/7/12450/view.do" },
    { id: "kmu-notice-general-12456", board: "general", articleNo: "12456", title: "글말특강 2회차 안내", date: "2026-10-02", url: "https://www.kookmin.ac.kr/user/kmuNews/notice/6/12456/view.do" },
  ]);

  const requested: string[] = [];
  const detail = "<p class=\"view_tit\">글말특강 2회차 안내</p><div class=\"board_etc\"><span>작성일 2026.10.02</span></div><div class=\"view_cont\"><div class=\"view_inner\"><p><img alt=\"\" src=\"poster.png\" /></p></div></div><div class=\"view_bottom\"></div>";
  const fetcher: typeof fetch = async (input) => {
    requested.push(String(input));
    return htmlResponse(String(input).includes("view.do") ? detail : html);
  };
  const now = new Date("2026-10-03T00:00:00Z");
  const last = await getNotices("general", 3, { now, fetcher });
  assert.equal(requested[0], "https://www.kookmin.ac.kr/user/kmuNews/notice/index.do?currentPageNo=3");
  assert.equal(last.hasMore, false);
  assert.equal(last.items.length, 2);
  // 범위를 넘는 쪽은 사이트가 다른 쪽을 보여 줘도 빈 목록이다.
  const beyond = await getNotices("general", 9, { now, fetcher });
  assert.deepEqual([beyond.items.length, beyond.hasMore], [0, false]);
  // 목록에서 본 글은 원래 게시판 번호가 붙은 주소로 연다.
  const poster = await getNoticeDetail("general", "12456", { now, fetcher });
  assert.equal(requested.at(-1), "https://www.kookmin.ac.kr/user/kmuNews/notice/6/12456/view.do");
  assert.deepEqual([poster.title, poster.date, poster.text, poster.url], ["글말특강 2회차 안내", "2026-10-02", "", "https://www.kookmin.ac.kr/user/kmuNews/notice/6/12456/view.do"]);
  const withAlt = parseNoticeDetail("<p class=\"view_tit\">행사</p><div class=\"view_inner\"><img src=\"a.png\" alt=\"10월 7일 14시 본부관\"><script>x()</script></div>");
  assert.equal(withAlt?.text, "10월 7일 14시 본부관");
  clearNoticeCache();
});

test("ICS parser handles CRLF folding, all-day ranges, alarms, cancellations and missing fields", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:201@ecampus.kookmin.ac.kr",
    "SUMMARY:아주 긴 과제 제목이 접혀",
    " 서 이어집니다 제출 마감",
    "DESCRIPTION:<p>첫 줄</p><p>둘째 &amp\\; 셋째</p>\\n마지막\\, 줄",
    "DTSTART:20261020T145900Z",
    "DTEND:20261020T145900Z",
    "CATEGORIES:자료구조\\, 01분반",
    "URL:https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=77",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:알람 설명",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:202@ecampus.kookmin.ac.kr",
    "SUMMARY:축제 기간",
    "DTSTART;VALUE=DATE:20261021",
    "DTEND;VALUE=DATE:20261024",
    "URL:javascript:alert(1)",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:203@ecampus.kookmin.ac.kr",
    "SUMMARY:취소된 일정",
    "STATUS:CANCELLED",
    "DTSTART:20261022T000000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:UID 없는 일정 is due",
    "DTSTART;TZID=\"Asia/Seoul\":20261023T0900",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:204@ecampus.kookmin.ac.kr",
    "SUMMARY:날짜 없는 일정",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:201@ecampus.kookmin.ac.kr",
    "SUMMARY:같은 UID",
    "DTSTART:20261101T000000Z",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const { calendarName, items } = parseIcs(`﻿${ics}`);
  assert.equal(calendarName, null);
  assert.equal(items.length, 3);
  // 같은 날이면 시각이 있는 일정이 날짜만 있는 일정보다 앞에 온다.
  const [folded, noUid, festival] = items;
  assert.deepEqual([folded.uid, folded.title, folded.course, folded.date, folded.time], ["201@ecampus.kookmin.ac.kr", "아주 긴 과제 제목이 접혀서 이어집니다", "자료구조, 01분반", "2026-10-20", "23:59"]);
  // HTML 설명은 글자만 남기고, 문단 끝과 `\n`은 줄바꿈으로 남는다.
  assert.equal(folded.description, "첫 줄\n둘째 & 셋째\n\n마지막, 줄");
  assert.equal(folded.url, "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=77");
  // 종일 일정의 DTEND는 끝난 다음 날이므로 하루를 뺀다.
  assert.deepEqual([festival.title, festival.date, festival.time, festival.url], ["축제 기간", "2026-10-23", null, null]);
  assert.deepEqual([noUid.title, noUid.date, noUid.time], ["UID 없는 일정", "2026-10-23", "09:00"]);
  assert.match(noUid.uid, /^nouid-[0-9a-f]{16}$/);
  assert.equal(parseIcs(ics).items[1].uid, noUid.uid);
  assert.deepEqual(parseIcs("BEGIN:VCALENDAR\nEND:VCALENDAR").items, []);
});

test("mapping builds import items with stable keys that importEvents accepts", async (t) => {
  const now = new Date("2026-10-03T00:00:00Z");
  const schedule: KookminScheduleItem = { id: "kmu-sched-2026-2026-10-20-2학기-중간시험-기간", title: "2학기 중간시험 기간", startDate: "2026-10-20", endDate: "2026-10-26", year: 2026, source: "https://www.kookmin.ac.kr/user/scGuid/scSchedule/index.do?yyyy=2026" };
  const assignment: EcampusAssignment = { uid: "101@ecampus.kookmin.ac.kr", title: "3주차 실습 보고서", course: "웹프로그래밍(01)", date: "2026-10-08", time: "08:00", description: "PDF 제출", url: "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=101" };
  const notice: KookminNotice = { id: "kmu-notice-scholarship-12450", board: "scholarship", articleNo: "12450", title: "2027 장학생 선발 안내", date: "2026-10-01", url: "https://www.kookmin.ac.kr/user/kmuNews/notice/7/12450/view.do" };

  assert.deepEqual(presetReminders("2026-10-08", "08:00", ["d3", "d1", "d0"], now), [
    { at: "2026-10-05T00:00:00.000Z", channel: "app" },
    { at: "2026-10-07T00:00:00.000Z", channel: "app" },
    // 당일 09:00은 08:00 마감 뒤라서 만들지 않는다.
  ]);
  assert.deepEqual(presetReminders("2026-10-04", null, ["d3", "d1", "d0"], now), [{ at: "2026-10-04T00:00:00.000Z", channel: "app" }]);
  assert.deepEqual(presetReminders("not-a-date", null, ["d1"], now), []);

  const fromSchedule = scheduleToImportItem(schedule, presetReminders(schedule.startDate, null, ["d1"], now));
  assert.deepEqual([fromSchedule.kind, fromSchedule.date, fromSchedule.time, fromSchedule.idempotencyKey], ["academic", "2026-10-20", null, schedule.id]);
  assert.equal(fromSchedule.notes, "기간: 2026-10-20 ~ 2026-10-26\n출처: https://www.kookmin.ac.kr/user/scGuid/scSchedule/index.do?yyyy=2026");
  const fromAssignment = assignmentToImportItem(assignment, ["d3", "d1", "d0"], now);
  assert.deepEqual([fromAssignment.kind, fromAssignment.date, fromAssignment.time, fromAssignment.idempotencyKey], ["assignment", "2026-10-08", "08:00", "ecampus-101@ecampus.kookmin.ac.kr"]);
  assert.equal(fromAssignment.notes, "과목: 웹프로그래밍(01)\nPDF 제출\n출처: https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=101");
  assert.equal(fromAssignment.reminders.length, 2);
  assert.equal(assignmentToImportItem({ ...assignment, url: null, course: null, description: null }).source, "국민대 eCampus");
  const fromNotice = noticeToImportItem(notice, { date: "2026-10-16", time: "17:00" });
  assert.deepEqual([fromNotice.kind, fromNotice.date, fromNotice.time, fromNotice.idempotencyKey, fromNotice.source], ["scholarship", "2026-10-16", "17:00", notice.id, notice.url]);
  assert.ok(fromNotice.notes.includes("공지 작성일: 2026-10-01") && fromNotice.notes.includes(notice.url));
  assert.equal(noticeToImportItem({ ...notice, board: "general" }, { date: "2026-10-16" }).kind, "academic");

  const db = await database(t);
  const result = await importEvents([fromSchedule, fromAssignment, fromNotice], db, now);
  assert.deepEqual([result.created, result.skipped, result.failed], [3, 0, []]);
  assert.equal(result.state.notifications.length, 3);
  // 북마클릿으로 다시 가져와도 같은 과제는 건너뛴다.
  const again = await importEvents([assignmentToImportItem({ ...assignment, title: "제목이 바뀐 같은 과제" })], db, now);
  assert.deepEqual([again.created, again.skipped], [0, 1]);
});

interface BookmarkletRun {
  hostname?: string;
  cfg?: { sesskey: string; wwwroot?: string } | null;
  fetch?: (url: string, init?: { method?: string; body?: string; credentials?: string }) => Promise<unknown>;
  popupBlocked?: boolean;
  globals?: Record<string, unknown>;
}

/** 북마클릿 코드를 브라우저 흉내를 낸 격리 환경에서 실제로 실행한다. */
async function runBookmarklet(code: string, options: BookmarkletRun = {}) {
  const alerts: string[] = [];
  const opened: string[] = [];
  const hostname = options.hostname ?? "ecampus.kookmin.ac.kr";
  const location = { hostname, origin: `https://${hostname}`, href: `https://${hostname}/my/` };
  const cfg = options.cfg === undefined ? { sesskey: "SESSKEY123", wwwroot: "https://ecampus.kookmin.ac.kr" } : options.cfg;
  const context = vm.createContext({
    alert: (message: string) => { alerts.push(message); },
    location,
    window: {
      M: cfg ? { cfg } : undefined,
      open: (url: string) => {
        if (options.popupBlocked) return null;
        opened.push(url);
        return { opener: {} };
      },
    },
    document: {
      createElement: () => ({
        innerHTML: "",
        get value(): string { return this.innerHTML.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); },
      }),
    },
    fetch: options.fetch ?? (async () => { throw new Error("offline"); }),
    URL,
    btoa,
    ...options.globals,
  });
  vm.runInContext(code, context);
  await new Promise((resolve) => setTimeout(resolve, 25));
  return { alerts, opened, href: location.href };
}

test("bookmarklet reads Moodle action events and opens the app with a decodable payload", async () => {
  const code = buildBookmarkletCode("http://127.0.0.1:3000");
  const due = Date.UTC(2026, 9, 8, 14, 59) / 1000;
  const calls: { url: string; method?: string; body?: string; credentials?: string }[] = [];
  const events = [
    { id: 501, name: "기말 프로젝트 is due", timesort: due, course: { fullname: "웹프로그래밍 &amp; 실습", shortname: "WEB" }, url: "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=9", action: { name: "제출", url: "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=9&action=editsubmission" } },
    { id: 502, name: "<span class=\"multilang\">퀴즈 3</span> 마감", timestart: due + 3600, url: "https://evil.example/steal" },
    { id: 501, name: "같은 일정 다시", timesort: due },
    { id: 503, name: "시각 없는 일정" },
  ];
  const result = await runBookmarklet(code, {
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return { json: async () => [{ error: false, data: { events } }] };
    },
  });
  assert.deepEqual(result.alerts, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ecampus.kookmin.ac.kr/lib/ajax/service.php?sesskey=SESSKEY123&info=core_calendar_get_action_events_by_timesort");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].credentials, "same-origin");
  const request = JSON.parse(calls[0].body ?? "") as { index: number; methodname: string; args: { limitnum: number; timesortfrom: number } }[];
  assert.deepEqual([request[0].index, request[0].methodname, request[0].args.limitnum], [0, "core_calendar_get_action_events_by_timesort", 50]);
  assert.ok(Math.abs(request[0].args.timesortfrom - Date.now() / 1000) < 60);

  assert.equal(result.opened.length, 1);
  assert.ok(result.opened[0].startsWith("http://127.0.0.1:3000/#kmu-import="));
  // 세션 키는 앱으로 넘어가지 않는다.
  assert.ok(!result.opened[0].includes("SESSKEY123"));
  const hash = new URL(result.opened[0]).hash;
  assert.ok(readBookmarkletHash(hash));
  assert.equal(readBookmarkletHash("#other=1"), null);
  const payload = decodeBookmarkletPayload(hash);
  assert.ok(!JSON.stringify(payload).includes("SESSKEY123"));
  assert.equal(payload.v, 1);
  assert.equal(payload.source, "ecampus-bookmarklet");
  assert.deepEqual(payload.items, [
    { uid: "501@ecampus.kookmin.ac.kr", title: "기말 프로젝트", course: "웹프로그래밍 & 실습", date: "2026-10-08", time: "23:59", description: null, url: "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=9&action=editsubmission" },
    { uid: "502@ecampus.kookmin.ac.kr", title: "퀴즈 3", course: null, date: "2026-10-09", time: "00:59", description: null, url: null },
  ]);
  // ICS로 가져온 같은 과제와 키가 같아 중복 저장되지 않는다.
  assert.equal(assignmentToImportItem(payload.items[0]).idempotencyKey, "ecampus-501@ecampus.kookmin.ac.kr");
});

test("bookmarklet explains failures in Korean and falls back when popups are blocked", async () => {
  const code = buildBookmarkletCode("https://knowverse.net");
  const moodle = (events: unknown[]) => async () => ({ json: async () => [{ error: false, data: { events } }] });
  let fetched = 0;
  const counting = async () => { fetched++; return { json: async () => [] }; };

  const wrongSite = await runBookmarklet(code, { hostname: "www.kookmin.ac.kr", fetch: counting });
  assert.equal(wrongSite.alerts.length, 1);
  assert.ok(wrongSite.alerts[0].includes("eCampus") && wrongSite.alerts[0].includes("로그인"));
  const loggedOut = await runBookmarklet(code, { cfg: null, fetch: counting });
  assert.ok(loggedOut.alerts[0].includes("로그인"));
  assert.equal(fetched, 0);

  const empty = await runBookmarklet(code, { fetch: moodle([]) });
  assert.ok(empty.alerts[0].includes("찾지 못했습니다"));
  assert.deepEqual(empty.opened, []);

  // AJAX가 오류를 돌려주고 대체 경로도 실패하면 안내만 띄운다.
  const broken = await runBookmarklet(code, { fetch: async () => ({ json: async () => [{ error: true, exception: { message: "invalid sesskey" } }], text: async () => "" }) });
  assert.equal(broken.alerts.length, 1);
  assert.ok(broken.alerts[0].includes("가져오지 못했습니다"));
  assert.deepEqual(broken.opened, []);

  const blocked = await runBookmarklet(code, { popupBlocked: true, fetch: moodle([{ id: 7, name: "보고서 제출 마감", timesort: Date.UTC(2026, 9, 8, 14, 59) / 1000 }]) });
  assert.deepEqual(blocked.alerts, []);
  assert.ok(blocked.href.startsWith("https://knowverse.net/#kmu-import="));
  assert.equal(decodeBookmarkletPayload(new URL(blocked.href).hash).items[0].title, "보고서");

  // 로그아웃 상태에서도 sesskey는 있다. 실제 eCampus는 이때 servicerequireslogin 오류를 돌려준다(2026-10-03 확인).
  let requests = 0;
  const expired = await runBookmarklet(code, {
    fetch: async () => {
      requests++;
      return { json: async () => [{ error: true, exception: { message: "Web service is not available.", errorcode: "servicerequireslogin" } }] };
    },
  });
  assert.equal(requests, 1);
  assert.deepEqual(expired.opened, []);
  assert.ok(expired.alerts[0].includes("로그인한 뒤"));
  // 대체 경로가 로그인 화면으로 넘어가도 같은 안내를 한다.
  const redirected = await runBookmarklet(code, {
    fetch: async (url) => (url.includes("service.php")
      ? { json: async () => { throw new Error("not json"); } }
      : { redirected: true, url: "https://ecampus.kookmin.ac.kr/login/index.php", text: async () => "<html></html>" }),
  });
  assert.ok(redirected.alerts[0].includes("로그인한 뒤"));
});

test("bookmarklet falls back to the upcoming events page when the AJAX service is unavailable", async () => {
  const code = buildBookmarkletCode("http://127.0.0.1:3000");
  const stamp = Date.UTC(2026, 9, 8, 14, 59) / 1000;
  const anchor = (href: string, text: string, row?: string) => ({
    textContent: text,
    getAttribute: (name: string) => (name === "href" ? href : null),
    closest: () => (row === undefined ? null : { textContent: row }),
  });
  const eventNode = (attributes: Record<string, string>, found: Record<string, unknown>) => ({
    textContent: Object.values(attributes).join(" "),
    getAttribute: (name: string) => attributes[name] ?? null,
    querySelector: (selector: string) => found[selector] ?? null,
  });
  const nodes = [
    eventNode({ "data-event-id": "901", "data-event-title": "데이터베이스 과제 2 is due" }, {
      "a[href*='view=day']": anchor(`https://ecampus.kookmin.ac.kr/calendar/view.php?view=day&time=${stamp}`, "10월 8일", "2026년 10월 8일 목요일, 오후 11:59"),
      "a[href*='/course/view.php']": anchor("https://ecampus.kookmin.ac.kr/course/view.php?id=3", " 데이터베이스(02) "),
      "a[href*='/mod/']": anchor("/mod/assign/view.php?id=44", "과제로 이동"),
    }),
    eventNode({ "data-event-id": "902" }, {
      ".name, h3": { textContent: "시각이 적히지 않은 일정" },
      "a[href*='view=day']": anchor(`/calendar/view.php?view=day&time=${stamp + 86_400}`, "10월 9일", "2026년 10월 9일 금요일"),
    }),
    // 날짜 링크가 없는 덩어리와 같은 일정의 반복은 건너뛴다.
    eventNode({ "data-event-id": "903", "data-event-title": "날짜 없는 일정" }, {}),
    eventNode({ "data-event-id": "901", "data-event-title": "데이터베이스 과제 2 is due" }, {
      "a[href*='view=day']": anchor(`/calendar/view.php?view=day&time=${stamp}`, "10월 8일", "오후 11:59"),
    }),
  ];
  const requested: string[] = [];
  const result = await runBookmarklet(code, {
    fetch: async (url) => {
      requested.push(url);
      if (url.includes("service.php")) return { json: async () => [{ error: true, exception: { errorcode: "invalidrecord" } }] };
      return { redirected: false, url, text: async () => "<html>upcoming</html>" };
    },
    globals: { DOMParser: class { parseFromString() { return { querySelectorAll: () => nodes }; } } },
  });
  assert.deepEqual(result.alerts, []);
  assert.equal(requested[1], "https://ecampus.kookmin.ac.kr/calendar/view.php?view=upcoming");
  assert.deepEqual(decodeBookmarkletPayload(new URL(result.opened[0]).hash).items, [
    { uid: "901@ecampus.kookmin.ac.kr", title: "데이터베이스 과제 2", course: "데이터베이스(02)", date: "2026-10-08", time: "23:59", description: null, url: "https://ecampus.kookmin.ac.kr/mod/assign/view.php?id=44" },
    // 화면에서 시각을 읽지 못하면 임의로 채우지 않는다.
    { uid: "902@ecampus.kookmin.ac.kr", title: "시각이 적히지 않은 일정", course: null, date: "2026-10-09", time: null, description: null, url: null },
  ]);
});

test("kookmin routes validate input before touching the network or the database", async (t) => {
  const previous = process.env.APP_URL;
  t.after(() => { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; });
  delete process.env.APP_URL;
  const local = { host: "127.0.0.1:3000" };
  const body = async (response: Response) => await response.json() as { error?: string; href?: string; code?: string };

  const bookmarklet = await import("../app/api/kookmin/bookmarklet/route");
  let response = await bookmarklet.GET(new Request("http://localhost:3000/api/kookmin/bookmarklet", { headers: local }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  let json = await body(response);
  assert.ok(json.href?.startsWith("javascript:(()=>{"));
  assert.ok(json.code?.includes("\"http://127.0.0.1:3000\""));
  assert.equal(decodeURIComponent(json.href?.slice("javascript:".length) ?? ""), json.code);
  process.env.APP_URL = "https://knowverse.net/app";
  json = await body(await bookmarklet.GET(new Request("http://0.0.0.0:3000/api/kookmin/bookmarklet", { headers: { host: "knowverse.net" } })));
  assert.ok(json.code?.includes("\"https://knowverse.net\""));
  delete process.env.APP_URL;
  response = await bookmarklet.GET(new Request("http://localhost:3000/api/kookmin/bookmarklet", { headers: { host: "evil.example\"/><script>" } }));
  assert.equal(response.status, 400);

  const schedule = await import("../app/api/kookmin/schedule/route");
  for (const year of ["abc", "1999", "20260", "2101"]) {
    response = await schedule.GET(new Request(`http://localhost:3000/api/kookmin/schedule?year=${year}`, { headers: local }));
    assert.equal(response.status, 400, year);
    assert.match((await body(response)).error ?? "", /[가-힣]/);
  }

  const notices = await import("../app/api/kookmin/notices/route");
  for (const query of ["board=secret", "board=academic&page=0", "board=academic&page=1.5", "board=academic&page=99999"]) {
    response = await notices.GET(new Request(`http://localhost:3000/api/kookmin/notices?${query}`, { headers: local }));
    assert.equal(response.status, 400, query);
  }
  const detail = await import("../app/api/kookmin/notices/[board]/[articleNo]/route");
  for (const params of [{ board: "secret", articleNo: "1" }, { board: "academic", articleNo: "12a" }, { board: "academic", articleNo: "../4" }, { board: "academic", articleNo: "1234567890123" }]) {
    response = await detail.GET(new Request("http://localhost:3000/api/kookmin/notices/x/y", { headers: local }), { params: Promise.resolve(params) });
    assert.equal(response.status, 400, JSON.stringify(params));
  }

  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000/api/kookmin/${path}`, {
    method: "POST",
    headers: { ...local, origin: "http://127.0.0.1:3000", "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const preview = await import("../app/api/kookmin/ecampus/preview/route");
  const importer = await import("../app/api/kookmin/import/route");
  assert.equal((await preview.POST(post("ecampus/preview", { ics: "BEGIN:VCALENDAR\nEND:VCALENDAR" }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await importer.POST(post("import", { items: [] }, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await preview.POST(post("ecampus/preview", { ics: "x" }, { "content-type": "text/plain" }))).status, 415);
  for (const payload of [{}, { url: 5 }, { url: "https://ecampus.kookmin.ac.kr/calendar/export_execute.php?userid=1&authtoken=a", ics: "BEGIN:VCALENDAR" }, { ics: "hello" }, { url: "https://evil.example/calendar/export_execute.php?userid=1&authtoken=a" }, { url: "x", extra: true }]) {
    response = await preview.POST(post("ecampus/preview", payload));
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.match((await body(response)).error ?? "", /[가-힣]/, JSON.stringify(payload));
  }
  response = await preview.POST(post("ecampus/preview", { ics: await fixture("ecampus-calendar.ics") }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const payload of [{}, { items: [] }, { items: "all" }, { items: Array.from({ length: 201 }, () => ({})) }, { items: [{}], extra: 1 }, []]) {
    response = await importer.POST(post("import", payload));
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 60));
    assert.match((await body(response)).error ?? "", /[가-힣]/);
  }
});
