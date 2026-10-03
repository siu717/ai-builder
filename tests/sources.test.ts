import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PROFILE, type KookminNotice, type Profile } from "../lib/contracts";
import { extractDeadline, fromEpoch, normalizeDate } from "../lib/sources/deadline";
import { parseDreamspon, parseKosafNotices } from "../lib/sources/html-sources";
import { clearLiveCache, getLiveOpportunities } from "../lib/sources/index";
import { noticesToScholarships, parseKookminJobs } from "../lib/sources/kookmin";
import { parseLinkareer } from "../lib/sources/linkareer";
import { majorTokens, scoreOpportunity, tokenize } from "../lib/sources/match";
import { liveItem, type LiveOpportunity, type OpportunitySource } from "../lib/sources/types";
import { parseWanted } from "../lib/sources/wanted";

const fixture = (name: string) => readFile(join(import.meta.dirname, "fixtures", "sources", name), "utf8");
const profile: Profile = { ...DEFAULT_PROFILE, year: "3", major: "소프트웨어학부", interests: "프론트엔드, 데이터 분석", experience: "React와 Python으로 팀 프로젝트" };

function assertShape(items: LiveOpportunity[], sourceId: string) {
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.sourceId, sourceId);
    assert.ok(item.id.startsWith(`${sourceId}-`));
    assert.ok(item.title && item.organization);
    assert.match(item.url, /^https:\/\//);
    assert.equal(item.isSample, false);
    if (item.date !== null) assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
    if (item.postedAt !== null) assert.match(item.postedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
}

test("deadline: reads only explicit dates in the title", () => {
  assert.deepEqual(extractDeadline("교내 근로장학생 모집 (~10/18)", "2026-10-01"), { date: "2026-10-18", time: null });
  assert.deepEqual(extractDeadline("장학생 추천 안내(~10/7 오전 11시)", "2026-10-01"), { date: "2026-10-07", time: "11:00" });
  assert.deepEqual(extractDeadline("OO재단 장학생 선발 10월 20일까지", "2026-10-01"), { date: "2026-10-20", time: null });
  assert.deepEqual(extractDeadline("신청: 9/1~9/30(수) 18시", "2026-09-01"), { date: "2026-09-30", time: "18:00" });
  assert.deepEqual(extractDeadline("서류 제출 2026.11.05.(목) 오후 5시까지", null), { date: "2026-11-05", time: "17:00" });
  assert.deepEqual(extractDeadline("접수 마감: 10/20", "2026-10-01"), { date: "2026-10-20", time: null });
});

test("deadline: rolls into the next year and refuses to guess", () => {
  assert.deepEqual(extractDeadline("동계 인턴 모집 (~1/5)", "2026-12-20"), { date: "2027-01-05", time: null });
  // 작성일보다 조금 앞선 날짜는 같은 해로 둔다(이미 지난 마감).
  assert.deepEqual(extractDeadline("추가 모집 (~9/25)", "2026-10-01"), { date: "2026-09-25", time: null });
  assert.deepEqual(extractDeadline("2026년 2학기 국가장학금 2차 신청 안내", "2026-09-01"), { date: null, time: null });
  assert.deepEqual(extractDeadline("재학 중인 2~4학년 대상 장학금", "2026-09-01"), { date: null, time: null });
  // 연도를 알 수 없으면(작성일 없음) 날짜를 만들지 않는다.
  assert.deepEqual(extractDeadline("근로장학생 모집 (~10/18)", null), { date: null, time: null });
  assert.deepEqual(extractDeadline("신청 (~13/40)", "2026-10-01"), { date: null, time: null });
});

test("deadline helpers normalise source date formats", () => {
  assert.equal(normalizeDate("2026.10.03"), "2026-10-03");
  assert.equal(normalizeDate("26.12.31 D-88"), "2026-12-31");
  assert.equal(normalizeDate("20261231"), "2026-12-31");
  assert.equal(normalizeDate("채용시까지 26-10-31"), "2026-10-31");
  assert.equal(normalizeDate("상시"), null);
  assert.deepEqual(fromEpoch(1798729199999), { date: "2026-12-31", time: "23:59" });
  assert.deepEqual(fromEpoch(1798729199), { date: "2026-12-31", time: "23:59" });
  assert.equal(fromEpoch(null), null);
});

test("wanted parser maps the public jobs JSON", async () => {
  const items = parseWanted(JSON.parse(await fixture("wanted.json")));
  assertShape(items, "wanted");
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "Robot Control Engineer (전문연구요원 가능)");
  assert.equal(items[0].organization, "플라잎");
  assert.equal(items[0].date, "2026-10-31");
  assert.equal(items[0].url, "https://www.wanted.co.kr/wd/390423");
  assert.ok(items[0].tags.includes("신입 가능"));
  assert.equal(items[1].date, null); // due_time이 null이면 마감일을 만들지 않는다.
  assert.deepEqual(parseWanted({ data: [{ id: "x" }, null, { id: 1 }] }), []);
  assert.deepEqual(parseWanted("oops"), []);
});

test("linkareer parser maps the GraphQL activities response", async () => {
  const items = parseLinkareer(JSON.parse(await fixture("linkareer.json")));
  assertShape(items, "linkareer");
  assert.equal(items.length, 3);
  assert.equal(items[0].id, "linkareer-354691");
  assert.equal(items[0].organization, "주식회사 더파운더즈");
  assert.equal(items[0].date, "2026-12-31");
  assert.equal(items[0].time, "23:59");
  assert.equal(items[0].postedAt, "2026-10-02");
  assert.ok(items[0].tags.includes("인턴"));
  assert.equal(items[0].url, "https://linkareer.com/activity/354691");
  assert.deepEqual(parseLinkareer({ errors: [{ message: "x" }] }), []);
});

test("kosaf notice parser reads title, posted date and view link", async () => {
  const items = parseKosafNotices(await fixture("kosaf-notice.html"));
  assertShape(items, "kosaf");
  assert.equal(items.length, 3);
  assert.equal(items[2].title, "2026년 2학기 제2차 국가우수장학금(이공계) 중간평가(2+2) 대상 재학생 신청 안내");
  assert.equal(items[2].postedAt, "2026-09-30");
  assert.equal(items[2].date, null);
  assert.equal(items[2].url, "https://www.kosaf.go.kr/ko/notice.do?mode=view&ctgrId1=0000000002&seqNo=21353");
});

test("dreamspon parser turns the stated D-day into a date", async () => {
  const items = parseDreamspon(await fixture("dreamspon.html"), "2026-10-03");
  assertShape(items, "dreamspon");
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "미래에셋 해외교환장학 (2027년 봄학기)");
  assert.equal(items[0].organization, "미래에셋박현주재단");
  assert.equal(items[0].date, "2026-10-06");
  assert.deepEqual(items[0].tags, ["연수지원", "대학생", "전공기준"]);
  assert.equal(items[0].url, "https://www.dreamspon.com/scholarship/view.html?idx=9208");
  const undated = parseDreamspon('<tr><td class="td_subject"><p class="title"><a href="/scholarship/view.html?idx=1">상시 장학</a></p></td><td>재단</td><td class="td_day"><span class="count">상시</span></td></tr>', "2026-10-03");
  assert.equal(undated[0].date, null);
});

test("kookmin notices become scholarship and job items", async () => {
  const notices: KookminNotice[] = [
    { id: "kmu-notice-scholarship-100", board: "scholarship", articleNo: "100", title: "OO장학재단 장학생 선발 안내(~10/7 오전 11시)", date: "2026-09-29", url: "https://www.kookmin.ac.kr/user/kmuNews/notice/7/100/view.do" },
    { id: "kmu-notice-scholarship-101", board: "scholarship", articleNo: "101", title: "[고정] 국가장학금 안내", date: "", url: "https://www.kookmin.ac.kr/user/kmuNews/notice/7/101/view.do" },
  ];
  const scholarships = noticesToScholarships(notices);
  assertShape(scholarships, "kmu-scholarship");
  assert.deepEqual([scholarships[0].date, scholarships[0].time, scholarships[0].postedAt], ["2026-10-07", "11:00", "2026-09-29"]);
  assert.deepEqual([scholarships[1].date, scholarships[1].postedAt], [null, null]);

  const html = await readFile(join(import.meta.dirname, "fixtures", "kookmin-notice-list.html"), "utf8");
  const jobs = parseKookminJobs(html, "11", "교외채용");
  assertShape(jobs, "kmu-job");
  assert.ok(jobs.every((job) => job.kind === "job" && job.url.includes("/notice/11/") && job.tags.includes("교외채용")));
});

test("match: tokenises the profile and scores hits with a Korean reason", () => {
  assert.deepEqual(tokenize("프론트엔드, 데이터 분석"), ["프론트엔드", "데이터", "분석"]);
  assert.ok(majorTokens("컴퓨터공학과").includes("컴퓨터"));
  assert.ok(majorTokens("소프트웨어학부").includes("소프트웨어"));
  const base = { kind: "job" as const, tags: [], description: "", organization: "캠퍼스랩" };
  const hit = scoreOpportunity({ ...base, title: "[인턴] 프론트엔드 개발자" }, profile);
  const synonym = scoreOpportunity({ ...base, title: "Frontend Engineer" }, profile);
  const related = scoreOpportunity({ ...base, title: "서비스 운영 매니저", tags: ["데이터"] }, profile);
  const none = scoreOpportunity({ ...base, title: "시니어 회계 담당자" }, profile);
  assert.match(hit.matchReason, /관심 직무 "프론트엔드"와 일치/);
  assert.match(synonym.matchReason, /관심 직무 "프론트엔드"와 일치/);
  assert.match(related.matchReason, /관심 직무 "데이터"와 관련/);
  assert.equal(none.matchReason, "");
  assert.ok(hit.matchScore > synonym.matchScore && synonym.matchScore > related.matchScore && related.matchScore > none.matchScore);
  assert.ok([hit, synonym, related, none].every((result) => result.matchScore >= 0 && result.matchScore <= 100));
  const scholarship = scoreOpportunity({ kind: "scholarship", title: "소프트웨어 인재 장학금", tags: [], description: "", organization: "재단" }, profile);
  assert.match(scholarship.matchReason, /전공 "소프트웨어" 관련/);
  // 프로필이 비어 있으면 근거 없이 기본 점수만 준다.
  assert.equal(scoreOpportunity({ ...base, title: "회계 담당자" }, DEFAULT_PROFILE).matchReason, "");
  // 짧은 영문 약어는 단어 경계가 있어야 한다.
  assert.equal(scoreOpportunity({ ...base, title: "Maintenance 담당" }, { ...DEFAULT_PROFILE, interests: "AI" }).matchReason, "");
});

function fakeSource(id: string, kind: "scholarship" | "job", fetchItems: OpportunitySource["fetch"], extra: Partial<OpportunitySource> = {}): OpportunitySource {
  return { id, name: `${id} 소스`, kind, fetch: fetchItems, ...extra };
}
const job = (sourceId: string, externalId: string, title: string, more: Partial<LiveOpportunity> = {}) =>
  ({ ...liveItem({ sourceId, sourceName: `${sourceId} 소스`, kind: "job", externalId, title, organization: "회사", url: "https://example.com/1" }), ...more });

test("index: one failing source never fails the response", async () => {
  clearLiveCache();
  const now = new Date("2026-10-03T03:00:00Z");
  let calls = 0;
  const sources = [
    fakeSource("good", "job", async () => {
      calls += 1;
      return [
        job("good", "1", "회계 담당자", { postedAt: "2026-10-01" }),
        job("good", "2", "프론트엔드 인턴", { postedAt: "2026-09-20" }),
        job("good", "2", "프론트엔드 인턴(중복)"),
        job("good", "3", "마감 지난 공고", { date: "2026-10-01" }),
        job("good", "4", "총무 담당자", { postedAt: "2026-10-02" }),
      ];
    }),
    fakeSource("broken", "job", async () => { throw new Error("boom https://secret.example/?key=abc"); }),
    fakeSource("slow", "job", () => new Promise(() => undefined)),
    fakeSource("other-kind", "scholarship", async () => { throw new Error("must not run"); }),
  ];
  const result = await getLiveOpportunities("job", profile, { sources, now, timeoutMs: 30 });
  assert.deepEqual(result.items.map((item) => item.id), ["good-2", "good-4", "good-1"]);
  assert.match(result.items[0].matchReason, /프론트엔드/);
  assert.equal(result.fetchedAt, now.toISOString());
  const status = Object.fromEntries(result.sources.map((source) => [source.id, source]));
  assert.deepEqual(Object.keys(status), ["good", "broken", "slow"]);
  assert.deepEqual([status.good.ok, status.good.count, status.good.error], [true, 3, null]);
  assert.equal(status.broken.ok, false);
  assert.ok(status.broken.error && !status.broken.error.includes("secret") && /불러오지 못했습니다/.test(status.broken.error));
  assert.match(status.slow.error ?? "", /시간이 초과/);

  // 10분 캐시: 같은 소스를 다시 부르지 않는다. 검색어는 받은 목록에서 걸러 낸다.
  const again = await getLiveOpportunities("job", profile, { sources, now: new Date(now.getTime() + 60_000), timeoutMs: 30, query: "프론트엔드" });
  assert.equal(calls, 1);
  assert.deepEqual(again.items.map((item) => item.id), ["good-2"]);
  const later = await getLiveOpportunities("job", profile, { sources, now: new Date(now.getTime() + 11 * 60_000), timeoutMs: 30, limit: 1 });
  assert.equal(calls, 2);
  assert.equal(later.items.length, 1);
  clearLiveCache();
});

test("index: native-query sources receive the trimmed query", async () => {
  clearLiveCache();
  const seen: string[] = [];
  const native = fakeSource("native", "job", async (ctx) => { seen.push(ctx.query); return [job("native", ctx.query || "all", "아무 제목")]; }, { nativeQuery: true });
  const result = await getLiveOpportunities("job", DEFAULT_PROFILE, { sources: [native], query: " 백엔드 " });
  assert.deepEqual(seen, ["백엔드"]);
  assert.deepEqual(result.items.map((item) => item.id), ["native-백엔드"]);
  clearLiveCache();
});
