import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PROFILE, LIVE_KEY_MISSING, type KookminNotice, type LiveOpportunity, type Profile } from "../lib/contracts";
import { extractDeadline, fromEpoch, normalizeDate } from "../lib/sources/deadline";
import { parseAlio, parseDreamspon, parseKosafNotices } from "../lib/sources/html-sources";
import { clearLiveCache, getLiveOpportunities } from "../lib/sources/index";
import { parseKosafApi, parseSaramin, parseWork24, parseYouthcenter, saraminSource } from "../lib/sources/keyed";
import { noticesToScholarships, parseKookminJobs } from "../lib/sources/kookmin";
import { parseLinkareer } from "../lib/sources/linkareer";
import { majorTokens, scoreOpportunity, tokenize } from "../lib/sources/match";
import { liveItem, MissingKeyError, type OpportunitySource } from "../lib/sources/types";
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

test("alio parser reads organisation, dates and work type", async () => {
  const items = parseAlio(await fixture("alio.html"));
  assertShape(items, "alio");
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "[직원채용] 별정직 의사직(마취통증의학과) 상시 모집 공고");
  assert.equal(items[0].organization, "동남권원자력의학원");
  assert.equal(items[0].postedAt, "2026-10-03");
  assert.equal(items[0].date, "2026-12-31");
  assert.ok(items[0].tags.includes("부산") && items[0].tags.includes("비정규직"));
  assert.equal(items[0].url, "https://job.alio.go.kr/recruitview.do?idx=305710");
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

test("saramin parser follows the documented job-search shape and hides the key", () => {
  const payload = { jobs: { count: 2, start: 0, total: "2", job: [
    {
      url: "http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=4001&utm_source=job-search-api&access-key=SECRET",
      active: 1, id: "4001", keyword: "React,웹개발",
      company: { detail: { href: "http://www.saramin.co.kr/zf_user/company-info/view?csn=1", name: "캠퍼스소프트" } },
      position: {
        title: "프론트엔드 개발 인턴 모집", location: { code: "101010", name: "서울 &gt; 강남구" },
        "job-type": { code: "4", name: "인턴직" }, "job-mid-code": { code: "2", name: "IT개발·데이터" }, "job-code": { code: "92", name: "프론트엔드,웹개발" },
        "experience-level": { code: 1, min: 0, max: 0, name: "신입" }, "required-education-level": { code: "0", name: "학력무관" },
      },
      "posting-timestamp": "1790900000", "expiration-timestamp": "1792681199", "close-type": { code: "1", name: "접수마감일" },
    },
    {
      url: "http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=4002", active: 1, id: "4002",
      company: { detail: { name: "상시채용컴퍼니" } }, position: { title: "서비스 기획 신입", "experience-level": { name: "신입" } },
      "posting-date": "2026-10-01T09:00:00+0900", "expiration-timestamp": "1893423599", "close-type": { code: "2", name: "채용시" },
    },
    { id: "4003", active: 0, position: { title: "마감된 공고" } },
  ] } };
  const items = parseSaramin(payload);
  assertShape(items, "saramin");
  assert.equal(items.length, 2);
  assert.equal(items[0].organization, "캠퍼스소프트");
  assert.equal(items[0].date, "2026-10-22");
  assert.equal(items[0].time, "23:59");
  assert.ok(!items[0].url.includes("SECRET") && items[0].url.includes("rec_idx=4001"));
  assert.ok(items[0].tags.includes("인턴직") && items[0].tags.includes("신입"));
  assert.equal(items[1].date, null); // 채용시 마감은 날짜로 만들지 않는다.
  assert.equal(items[1].postedAt, "2026-10-01");
  assert.deepEqual(parseSaramin({ code: 4, message: "invalid key" }), []);
});

test("work24 parser reads the XML list", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><wantedRoot><total>2</total><startPage>1</startPage><display>40</display>
<wanted><wantedAuthNo>K120002610030001</wantedAuthNo><company><![CDATA[(주)캠퍼스랩]]></company><title>웹 개발 신입 사원 모집 &amp; 인턴</title><salTpNm>연봉</salTpNm><sal>3000만원 ~ 3600만원</sal><region>서울 성북구</region><holidayTpNm>주5일근무</holidayTpNm><minEdubg>대졸(4년)</minEdubg><career>신입</career><regDt>26-10-01</regDt><closeDt>26-10-31</closeDt><wantedInfoUrl>https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K120002610030001&amp;authKey=SECRET</wantedInfoUrl></wanted>
<wanted><wantedAuthNo>K120002610030002</wantedAuthNo><company>데이터브릿지</company><title>데이터 분석 보조</title><region>경기 성남시</region><career>관계없음</career><regDt>26-10-02</regDt><closeDt>채용시까지  26-11-30</closeDt></wanted>
<wanted><company>번호 없음</company><title>무시</title></wanted></wantedRoot>`;
  const items = parseWork24(xml);
  assertShape(items, "work24");
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "웹 개발 신입 사원 모집 & 인턴");
  assert.equal(items[0].organization, "(주)캠퍼스랩");
  assert.deepEqual([items[0].postedAt, items[0].date], ["2026-10-01", "2026-10-31"]);
  assert.ok(!items[0].url.includes("SECRET"));
  assert.equal(items[1].date, "2026-11-30");
  assert.match(items[1].url, /wantedAuthNo=K120002610030002/);
  assert.deepEqual(parseWork24("<error>인증키 오류</error>"), []);
});

test("data.go.kr kosaf parser tolerates column name variants", () => {
  const payload = { page: 1, perPage: 300, totalCount: 2, currentCount: 2, data: [
    { "번호": 17, "운영기관명": "한국장학재단", "상품명": "푸른등대 기부장학금", "운영기관구분": "공공기관", "상품구분": "장학금", "학자금유형구분": "지역연고", "학년구분": "대학2학기/대학3학기", "성적기준 상세내용": "직전학기 80점 이상", "소득기준 상세내용": "학자금 지원 4구간 이하", "지원내역 상세내용": "학기당 200만원", "특정자격 상세내용": "해당없음", "홈페이지 주소": "www.kosaf.go.kr", "모집시작일": "2026-09-15", "모집종료일": "2026-10-20" },
    { "운영기관명": "OO문화재단", "상품명": "지역인재 장학금", "성적기준상세내용": "3.5 이상", "홈페이지주소": "해당없음", "모집시작일": "", "모집종료일": "" },
    { "운영기관명": "이름 없는 행" },
  ] };
  const items = parseKosafApi(payload);
  assertShape(items, "kosaf-api");
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "kosaf-api-17");
  assert.deepEqual([items[0].postedAt, items[0].date], ["2026-09-15", "2026-10-20"]);
  assert.match(items[0].description, /지원: 학기당 200만원/);
  assert.ok(!items[0].description.includes("해당없음"));
  assert.equal(items[0].url, "https://www.kosaf.go.kr/");
  assert.equal(items[1].date, null);
  assert.match(items[1].description, /성적: 3.5 이상/);
  assert.match(items[1].url, /^https:\/\/www\.kosaf\.go\.kr\//);
  assert.equal(parseKosafApi(payload)[1].id, items[1].id); // 번호가 없어도 ID가 안정적이다.
});

test("youthcenter parser reads the policy list", () => {
  const payload = { resultCode: 200, resultMessage: "성공", result: { pagging: { totCount: 2, pageNum: 1, pageSize: 40 }, youthPolicyList: [
    { plcyNo: "20260316005400210633", plcyNm: "청년 희망 장학금", plcyKywdNm: "장학금,교육지원", plcyExplnCn: "대학 재학 청년의 등록금 부담을 줄입니다.", plcySprtCn: "학기당 150만원", lclsfNm: "교육", mclsfNm: "교육비지원", sprvsnInstCdNm: "서울특별시", aplyYmd: "20260901 ~ 20260915\\N20261001 ~ 20261025", frstRegDt: "2026-08-20 10:11:12" },
    { plcyNo: "20260101000000000001", plcyNm: "상시 접수 정책", operInstCdNm: "OO구청", aplyYmd: "" },
    { plcyNm: "번호 없음" },
  ] } };
  const items = parseYouthcenter(payload);
  assertShape(items, "youthcenter");
  assert.equal(items.length, 2);
  assert.equal(items[0].date, "2026-10-25");
  assert.equal(items[0].postedAt, "2026-08-20");
  assert.equal(items[0].organization, "서울특별시");
  assert.equal(items[0].url, "https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/20260316005400210633");
  assert.equal(items[1].date, null);
  assert.equal(items[1].organization, "OO구청");
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
    fakeSource("keyed", "job", async () => { throw new MissingKeyError("X_API_KEY"); }, { requiresKey: "X_API_KEY" }),
    fakeSource("other-kind", "scholarship", async () => { throw new Error("must not run"); }),
  ];
  const result = await getLiveOpportunities("job", profile, { sources, now, timeoutMs: 30 });
  assert.deepEqual(result.items.map((item) => item.id), ["good-2", "good-4", "good-1"]);
  assert.match(result.items[0].matchReason, /프론트엔드/);
  assert.equal(result.fetchedAt, now.toISOString());
  const status = Object.fromEntries(result.sources.map((source) => [source.id, source]));
  assert.deepEqual(Object.keys(status), ["good", "broken", "slow", "keyed"]);
  assert.deepEqual([status.good.ok, status.good.count, status.good.error], [true, 3, null]);
  assert.equal(status.broken.ok, false);
  assert.ok(status.broken.error && !status.broken.error.includes("secret") && /불러오지 못했습니다/.test(status.broken.error));
  assert.match(status.slow.error ?? "", /시간이 초과/);
  assert.equal(status.keyed.error, LIVE_KEY_MISSING);

  // 10분 캐시: 같은 소스를 다시 부르지 않는다. 검색어는 받은 목록에서 걸러 낸다.
  const again = await getLiveOpportunities("job", profile, { sources, now: new Date(now.getTime() + 60_000), timeoutMs: 30, query: "프론트엔드" });
  assert.equal(calls, 1);
  assert.deepEqual(again.items.map((item) => item.id), ["good-2"]);
  const later = await getLiveOpportunities("job", profile, { sources, now: new Date(now.getTime() + 11 * 60_000), timeoutMs: 30, limit: 1 });
  assert.equal(calls, 2);
  assert.equal(later.items.length, 1);
  clearLiveCache();
});

test("index: native-query sources receive the query and keyed sources report a missing key", async () => {
  clearLiveCache();
  const seen: string[] = [];
  const native = fakeSource("native", "job", async (ctx) => { seen.push(ctx.query); return [job("native", ctx.query || "all", "아무 제목")]; }, { nativeQuery: true });
  const result = await getLiveOpportunities("job", DEFAULT_PROFILE, { sources: [native, saraminSource], query: " 백엔드 ", env: {} });
  assert.deepEqual(seen, ["백엔드"]);
  assert.deepEqual(result.items.map((item) => item.id), ["native-백엔드"]);
  assert.deepEqual(result.sources[1], { id: "saramin", name: "사람인", ok: false, count: 0, error: LIVE_KEY_MISSING });

  // 키가 있으면 문서화된 주소로 요청하고, 결과 어디에도 키가 남지 않는다.
  let requested = "";
  const fetcher = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return Response.json({ jobs: { job: [{ id: "9", url: `http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=9&access-key=TESTKEY`, active: 1, company: { detail: { name: "회사" } }, position: { title: "백엔드 신입" } }] } });
  }) as typeof fetch;
  const keyed = await getLiveOpportunities("job", DEFAULT_PROFILE, { sources: [saraminSource], query: "백엔드", env: { SARAMIN_API_KEY: "TESTKEY" }, fetcher });
  assert.match(requested, /^https:\/\/oapi\.saramin\.co\.kr\/job-search\?access-key=TESTKEY&/);
  assert.match(requested, /keywords=/);
  assert.equal(keyed.sources[0].ok, true);
  assert.ok(!JSON.stringify(keyed).includes("TESTKEY"));
  clearLiveCache();
});
