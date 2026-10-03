import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createDatabase } from "../lib/db";
import { DEFAULT_PROFILE, importEventKey, type Profile } from "../lib/contracts";
import { extractDeadline, parseBoard, parseFeed } from "../lib/importers";
import { addImportToCalendar, createSource, defaultReminders, deleteSource, getImportState, setImportDismissed, syncAllSources, syncSource } from "../lib/import-store";
import { fetchAlio, fetchGov24, fetchKosaf, fetchQnet, fetchSaramin, fetchWork24, fetchYouth, parseWork24Date, profileMatches, profileTerms } from "../lib/providers";
import { isPrivateAddress } from "../lib/safe-fetch";
import { deleteEvent, getState, saveProfile } from "../lib/store";

const today = "2026-10-03";
const now = new Date("2026-10-03T00:00:00Z");

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-imports-"));
  const db = await createDatabase(`file:${join(directory, "campus.db")}`);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  return db;
}

test("deadline extraction prefers the application period over program dates", () => {
  const notice = "1. 기간 1) 모집기간 : 2026. 9. 28.(월) ~ 10. 9. (금) 2) 운영기간 : 2026. 10. 14.(수) ~12. 28. (금)";
  assert.deepEqual(extractDeadline(notice, "2026-09-28"), { date: "2026-10-09", time: null });
  assert.deepEqual(extractDeadline("제출기간 · 2026. 10. 06. (화 ) ~ 2026. 10. 11. ( 일 ) 제출방법 이메일", "2026-10-02"), { date: "2026-10-11", time: null });
  assert.deepEqual(extractDeadline("신청마감 : 2026 년 10 월 11 일 (22:59 까지 )", "2026-10-02"), { date: "2026-10-11", time: "22:59" });
  assert.deepEqual(extractDeadline("참가자 모집공고(~10/13 까지)", "2026-10-02"), { date: "2026-10-13", time: null });
  assert.deepEqual(extractDeadline("접수: 10월 20일 오후 5시까지", "2026-10-02"), { date: "2026-10-20", time: "17:00" });
  // 12월 공지의 연도 없는 1월 날짜는 다음 해다.
  assert.deepEqual(extractDeadline("신청 마감 1월 10일", "2026-12-20"), { date: "2027-01-10", time: null });
  // 지난 날짜와 행사 일시만 있는 공지는 마감으로 확정하지 않는다.
  assert.equal(extractDeadline("신청 마감 9월 1일", "2026-10-02"), null);
  assert.equal(extractDeadline("행사 일시: 10월 20일", "2026-10-02"), null);
  assert.equal(extractDeadline("문의 02-910-4058", "2026-10-02"), null);
});

test("RSS items keep found deadlines and flag notices without one", () => {
  const rss = `<?xml version="1.0"?><rss><channel><title>장학 공지</title>
    <item><title><![CDATA[2026 우양재단 장학생 모집(~10/18)]]></title><link>https://u.example.ac.kr/1</link><pubDate>Fri, 02 Oct 2026 01:00:00 +0000</pubDate><description>&lt;p&gt;제출 서류 확인&lt;/p&gt;</description></item>
    <item><title>도서관 휴관 안내</title><link>https://u.example.ac.kr/2</link><pubDate>Fri, 02 Oct 2026 01:00:00 +0000</pubDate></item>
    <item><title>지난 장학 신청 (~9/1)</title><link>https://u.example.ac.kr/3</link><pubDate>Mon, 03 Aug 2026 01:00:00 +0000</pubDate></item>
  </channel></rss>`;
  const items = parseFeed(rss, "scholarship", today);
  assert.equal(items.length, 2);
  assert.equal(items[0].date, "2026-10-18");
  assert.equal(items[0].organization, "장학 공지");
  assert.equal(items[0].summary, "제출 서류 확인");
  assert.equal(items[1].date, null);
  assert.match(items[1].dateNote || "", /찾지 못했습니다/);
});

test("board pages yield titled rows with posting dates and absolute links", () => {
  const html = `<html><head><title>학교 공지</title></head><body>
    <ul class="menu"><li><a href="/about">학교 소개</a></li></ul>
    <table><tr><td class="title"><a href="/bbs/1/view.do"><!-- 일반 --> 2026 장학생 모집(~10.15.) </a> 새글</td><td>2026.10.02.</td></tr>
    <tr><td><a href="javascript:view(2)">우리 학과 채용 공고 안내</a></td><td>2026.09.30</td></tr>
    <tr><td><a href="/bbs/3/view.do">아주 오래된 공지사항</a></td><td>2025.01.10</td></tr></table>
    <div class="board_list"><ul><li><a href="/n/4"><p class="title">특강 안내</p><div><span>2026.10.01</span></div></a></li></ul></div>
  </body></html>`;
  const items = parseBoard(html, "https://school.example.ac.kr/notice", "scholarship", today);
  assert.deepEqual(items.map((item) => [item.title, item.date, item.url]), [
    ["2026 장학생 모집(~10.15.)", "2026-10-15", "https://school.example.ac.kr/bbs/1/view.do"],
    ["우리 학과 채용 공고 안내", null, "https://school.example.ac.kr/notice"],
    ["특강 안내", null, "https://school.example.ac.kr/n/4"],
  ]);
  assert.equal(items[0].organization, "학교 공지");
});

test("default reminders fire the day before at 9am, or that morning when late", () => {
  assert.deepEqual(defaultReminders("2026-10-08", "23:59", now, false), [{ at: "2026-10-07T00:00:00.000Z", channel: "app" }]);
  const early = new Date("2026-10-02T23:00:00Z");
  assert.deepEqual(defaultReminders("2026-10-03", "18:00", early, true), [{ at: "2026-10-03T00:00:00.000Z", channel: "app" }, { at: "2026-10-03T00:00:00.000Z", channel: "telegram" }]);
  assert.deepEqual(defaultReminders("2026-10-03", "08:00", now, false), []);
});

test("manual add uses the import key and rejects undated candidates", async (t) => {
  const db = await fixture(t);
  const html = `<table><tr><td><a href="/1">장학생 모집 (~10.20.)</a></td><td>2026.10.01</td></tr><tr><td><a href="/2">취업 특강 안내</a></td><td>2026.10.01</td></tr></table>`;
  const fetcher = async (url: string) => (url.endsWith("/2") ? "<p>취업 특강 안내</p><p>강의 일시 10월 30일</p>" : html);
  const source = await createSource({ type: "rss", name: "학교 공지", url: "https://school.example.ac.kr/notice", keywords: "", autoAdd: false }, db, now);
  const result = await syncSource(source.id, { database: db, fetcher, now });
  assert.deepEqual([result.found, result.added], [2, 0]);
  const items = (await getImportState(db, now)).items;
  const dated = items.find((item) => item.date)!;
  const undated = items.find((item) => !item.date)!;
  assert.equal(undated.title, "취업 특강 안내");
  const state = await addImportToCalendar(dated.id, db, now);
  assert.equal(state.events[0].idempotencyKey, importEventKey(dated.id));
  assert.equal(state.events[0].kind, "scholarship");
  await addImportToCalendar(dated.id, db, now);
  assert.equal((await getState(db)).events.length, 1, "adding twice does not duplicate");
  await assert.rejects(addImportToCalendar(undated.id, db, now), /마감 날짜/);
});

test("private network addresses are rejected for user feeds", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.10", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
    assert.ok(isPrivateAddress(address), address);
  }
  for (const address of ["8.8.8.8", "203.246.0.1", "2001:4860:4860::8888"]) assert.ok(!isPrivateAddress(address), address);
});

const student: Profile = { ...DEFAULT_PROFILE, name: "김학생", year: "3", major: "컴퓨터공학과", interests: "프론트엔드, 데이터" };

function withKeys(t: TestContext, keys: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(keys).map((key) => [key, process.env[key]]));
  Object.assign(process.env, keys);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("profile terms come from interests, major and its field group", () => {
  assert.deepEqual(profileTerms(student), ["프론트엔드", "데이터", "컴퓨터공학", "공학계열"]);
  assert.deepEqual(profileMatches({ title: "데이터 분석 인턴", organization: "", summary: "대상 학과: 공학계열" }, student), ["데이터", "공학계열"]);
  assert.deepEqual(profileTerms(DEFAULT_PROFILE), []);
});

test("KOSAF and ALIO rows map to scholarships and student-friendly jobs", async (t) => {
  withKeys(t, { DATA_GO_KR_SERVICE_KEY: "abc%2Bdef" });
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    if (url.includes("oas/docs")) return JSON.stringify({ paths: { "/15028252/v1/uddi:old": {}, "/15028252/v1/uddi:new": {} } });
    if (url.includes("odcloud")) return JSON.stringify({ data: [
      { 운영기관명: "OO재단", 상품명: "미래 장학금", 대학구분: "4년제(5~6년제포함)", 학과구분: "공학계열", 모집시작일: "2026-09-20", 모집종료일: "2026-10-20", "홈페이지 주소": "www.oo.or.kr", "제출서류 상세내용": "○ 재학증명서\n○ 성적증명서", "지원내역 상세내용": "등록금 전액" },
      { 운영기관명: "OO재단", 상품명: "대학원 장학금", 대학구분: "대학원", 모집종료일: "2026-10-20" },
      { 운영기관명: "OO재단", 상품명: "마감된 장학금", 모집종료일: "2026-09-01" },
    ] });
    return JSON.stringify({ resultCode: 200, result: [
      { recrutPblntSn: 123, instNm: "한국OO공사", recrutPbancTtl: "2026 체험형 인턴", recrutSeNm: "신입", pbancEndYmd: "20261012", srcUrl: "https://job.example/123" },
      { recrutPblntSn: 124, instNm: "한국OO공사", recrutPbancTtl: "경력 연구원", recrutSeNm: "경력", pbancEndYmd: "20261012" },
    ] });
  };
  const context = { fetcher, today, profile: student };
  const scholarships = await fetchKosaf(context);
  assert.ok(requested[1].includes("uddi:new") && requested[1].includes("serviceKey=abc%2Bdef"));
  assert.deepEqual(scholarships.map((item) => [item.title, item.date, item.url]), [["미래 장학금", "2026-10-20", "https://www.oo.or.kr"]]);
  assert.deepEqual(scholarships[0].documents, ["재학증명서", "성적증명서"]);
  assert.deepEqual(profileMatches(scholarships[0], student), ["공학계열"]);
  const jobs = await fetchAlio(context);
  assert.deepEqual(jobs.map((job) => [job.externalId, job.title, job.date]), [["123", "2026 체험형 인턴", "2026-10-12"]]);
  delete process.env.DATA_GO_KR_SERVICE_KEY;
  await assert.rejects(fetchKosaf(context), /DATA_GO_KR_SERVICE_KEY/);
});

test("Gov24 keeps national student services with a concrete deadline", async (t) => {
  withKeys(t, { DATA_GO_KR_SERVICE_KEY: "key" });
  const row = (id: string, extra: Record<string, string>) => ({ 서비스ID: id, 서비스명: "대학생 장학금", 지원대상: "대학 재학생", 소관기관명: "교육부", 소관기관유형: "중앙행정기관", 신청기한: "2026.10.25.까지", 상세조회URL: "https://www.gov.kr/x", ...extra });
  const fetcher = async (url: string) => (decodeURIComponent(url).includes("LIKE]=장학")
    ? JSON.stringify({ data: [row("a", {}), row("b", { 소관기관명: "서울특별시", 소관기관유형: "지방자치단체" }), row("c", { 신청기한: "상시신청" })] })
    : JSON.stringify({ data: [row("a", {})] }));
  const items = await fetchGov24({ fetcher, today, profile: student });
  assert.deepEqual(items.map((item) => [item.externalId, item.kind, item.date]), [["a", "scholarship", "2026-10-25"]]);
});

test("Youth policies use the end of the application period and skip local programs", async (t) => {
  withKeys(t, { YOUTHCENTER_API_KEY: "key" });
  const fetcher = async () => JSON.stringify({ result: { pagging: { totCount: 3 }, youthPolicyList: [
    { plcyNo: "P1", plcyNm: "청년 일경험 지원", lclsfNm: "일자리", sprvsnInstCdNm: "고용노동부", aplyYmd: "20261001 ~ 20261031", aplyUrlAddr: "https://work.example" },
    { plcyNo: "P2", plcyNm: "구 청년 수당", lclsfNm: "일자리", sprvsnInstCdNm: "서울특별시 강남구", aplyYmd: "20261001 ~ 20261031" },
    { plcyNo: "P3", plcyNm: "청년 월세", lclsfNm: "주거", sprvsnInstCdNm: "국토교통부", aplyYmd: "20261001 ~ 20261031" },
  ] } });
  const items = await fetchYouth({ fetcher, today, profile: student });
  assert.deepEqual(items.map((item) => [item.externalId, item.kind, item.date, item.url]), [["P1", "job", "2026-10-31", "https://work.example"]]);
});

test("Work24 and Saramin search with profile terms and drop experienced-only posts", async (t) => {
  withKeys(t, { WORK24_AUTH_KEY: "w", SARAMIN_ACCESS_KEY: "s" });
  assert.equal(parseWork24Date("채용시까지  26-10-31"), "2026-10-31");
  assert.equal(parseWork24Date("20261101"), "2026-11-01");
  const urls: string[] = [];
  const work24 = async (url: string) => {
    urls.push(decodeURIComponent(url));
    return `<?xml version="1.0"?><wantedRoot><total>1</total><wanted><wantedAuthNo>K1</wantedAuthNo><company>OO소프트</company><title>프론트엔드 신입 개발자</title><closeDt>26-10-20</closeDt><wantedInfoUrl>https://www.work24.go.kr/K1</wantedInfoUrl><region>서울</region></wanted></wantedRoot>`;
  };
  const jobs = await fetchWork24({ fetcher: work24, today, profile: student });
  assert.deepEqual(jobs.map((job) => [job.externalId, job.date, job.organization]), [["K1", "2026-10-20", "OO소프트"]]);
  assert.ok(urls[0].includes("keyword=프론트엔드") && urls[0].includes("career=N"));
  await assert.rejects(fetchWork24({ fetcher: async () => "<GO24><error>신청하신 OpenApi 서비스가 존재하지 않습니다</error></GO24>", today, profile: student }), /고용24: 신청하신/);

  const expires = Math.floor(new Date("2026-10-15T23:59:59+09:00").getTime() / 1000);
  const saramin = async () => JSON.stringify({ jobs: { count: 3, job: [
    { id: "S1", url: "https://saramin/S1", company: { detail: { name: "OO랩" } }, position: { title: "데이터 분석 인턴", "experience-level": { code: 1, name: "신입" } }, "expiration-timestamp": String(expires), "close-type": { code: "1" } },
    { id: "S2", position: { title: "시니어 개발자", "experience-level": { code: 2 } }, "expiration-timestamp": String(expires), "close-type": { code: "1" } },
    { id: "S3", position: { title: "상시 채용", "experience-level": { code: 0 } }, "expiration-timestamp": String(expires), "close-type": { code: "3" } },
  ] } });
  const posts = await fetchSaramin({ fetcher: saramin, today, profile: student });
  assert.deepEqual(posts.map((post) => [post.externalId, post.date, post.time, post.organization]), [["S1", "2026-10-15", null, "OO랩"]]);
});

test("Q-Net schedules become written and practical registration deadlines", async (t) => {
  withKeys(t, { DATA_GO_KR_SERVICE_KEY: "key" });
  const fetcher = async (url: string) => (url.includes("implYy=2026")
    ? JSON.stringify({ header: { resultCode: "00" }, body: { items: [
      { description: "국가기술자격 기사 (2026년도 제4회)", implSeq: 4, docRegStartDt: "20261005", docRegEndDt: "20261008", docExamStartDt: "20261025", pracRegStartDt: "20261110", pracRegEndDt: "20261113", pracExamStartDt: "20261201" },
      { description: "국가기술자격 기능사 (2026년도 제4회)", docRegEndDt: "20261008", pracRegEndDt: "20261113" },
    ] } })
    : JSON.stringify({ header: { resultCode: "03", resultMsg: "NODATA" } }));
  const items = await fetchQnet({ fetcher, today, profile: student });
  assert.deepEqual(items.map((item) => [item.title, item.date, item.time]), [
    ["국가기술자격 기사 (2026년도 제4회) 필기 원서접수 마감", "2026-10-08", "18:00"],
    ["국가기술자격 기사 (2026년도 제4회) 실기 원서접수 마감", "2026-11-13", "18:00"],
  ]);
});

test("built-in sources turn on with a server key and auto-add only profile matches, once", async (t) => {
  const db = await fixture(t);
  withKeys(t, { SARAMIN_ACCESS_KEY: "s" });
  await saveProfile(student, db);
  const expires = String(Math.floor(new Date("2026-10-15T23:59:59+09:00").getTime() / 1000));
  const job = (id: string, title: string) => ({ id, position: { title, "experience-level": { code: 1 } }, "expiration-timestamp": expires, "close-type": { code: "1" } });
  const fetcher = async () => JSON.stringify({ jobs: { job: [job("A", "프론트엔드 인턴"), job("B", "영업 관리 신입")] } });

  const before = await getImportState(db, now);
  assert.deepEqual(before.sources.map((source) => [source.id, source.builtin, source.autoAdd]), [["builtin-saramin", true, true]]);
  assert.ok(before.providers.find((provider) => provider.type === "kosaf" && !provider.configured));

  const [result] = await syncAllSources({ database: db, fetcher, now });
  assert.deepEqual([result.found, result.added, result.error], [2, 1, null]);
  let state = await getState(db);
  assert.deepEqual(state.events.map((event) => event.title), ["프론트엔드 인턴"]);
  assert.equal(state.notifications[0].scheduledAt, "2026-10-14T00:00:00.000Z");
  const items = (await getImportState(db, now)).items;
  assert.deepEqual(items.map((item) => [item.title, item.matched]), [["프론트엔드 인턴", ["프론트엔드"]], ["영업 관리 신입", []]]);

  // 사용자가 지운 자동 등록 일정은 다시 넣지 않는다.
  await deleteEvent(state.events[0].id, db);
  const again = await syncSource("builtin-saramin", { database: db, fetcher, now });
  assert.equal(again.added, 0);
  state = await getState(db);
  assert.equal(state.events.length, 0);
  await assert.rejects(deleteSource("builtin-saramin", db), /기본 수집원/);

  // 키를 빼면 기본 수집원과 후보가 화면에서 사라진다.
  delete process.env.SARAMIN_ACCESS_KEY;
  const after = await getImportState(db, now);
  assert.deepEqual([after.sources.length, after.items.length], [0, 0]);
});

test("school boards auto-add every dated notice and keep dismissals across syncs", async (t) => {
  const db = await fixture(t);
  let html = `<table><tr><td><a href="/1">장학생 모집 (~10.20.)</a></td><td>2026.10.01</td></tr></table>`;
  const fetcher = async () => html;
  const source = await createSource({ type: "rss", name: "학교 공지", url: "https://school.example.ac.kr/notice", keywords: "장학", autoAdd: true }, db, now);
  assert.equal((await syncSource(source.id, { database: db, fetcher, now })).added, 1);
  html += `<table><tr><td><a href="/2">장학금 신청 안내 (~10.25.)</a></td><td>2026.10.02</td></tr><tr><td><a href="/3">학식 메뉴 (~10.30.)</a></td><td>2026.10.02</td></tr></table>`;
  const second = (await getImportState(db, now)).items;
  assert.equal(second.length, 1);
  const result = await syncSource(source.id, { database: db, fetcher, now });
  assert.deepEqual([result.found, result.added], [2, 1], "keyword filter drops the menu notice");
  const titles = (await getState(db)).events.map((event) => event.title).sort();
  assert.deepEqual(titles, ["장학금 신청 안내 (~10.25.)", "장학생 모집 (~10.20.)"]);
  const hidden = (await getImportState(db, now)).items[0];
  await setImportDismissed(hidden.id, true, db);
  await syncSource(source.id, { database: db, fetcher, now });
  assert.ok((await getImportState(db, now)).items.find((item) => item.id === hidden.id)?.dismissed);
  await deleteSource(source.id, db);
  assert.equal((await getState(db)).events.length, 2, "deleting a board keeps registered events");
  await assert.rejects(createSource({ type: "rss", name: "잘못된 주소", url: "ftp://x", keywords: "", autoAdd: false }, db, now));
});
