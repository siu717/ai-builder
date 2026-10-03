import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test, type TestContext } from "node:test";
import { GET } from "../app/api/public-data/route";
import { DEFAULT_PROFILE, type Profile } from "../lib/contracts";
import { RouteError } from "../lib/http";
import { clearPublicDataCache, getExamSchedules, getPublicJobs, getPublicScholarships, toIsoDate } from "../lib/public-data";

const NOW = new Date("2026-10-03T03:00:00Z");
const KEY = "abc+def/ghi==secret-service-key";
const PROFILE: Profile = { ...DEFAULT_PROFILE, year: "3", major: "소프트웨어학부", interests: "데이터 분석, 전산", experience: "" };

beforeEach(() => clearPublicDataCache());

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { fetcher, calls };
}

const SPEC = {
  paths: {
    "/15028252/v1/uddi:old": { get: { summary: "한국장학재단_학자금지원정보(대학생)_20260811" } },
    "/15028252/v1/uddi:latest": { get: { summary: "한국장학재단_학자금지원정보(대학생)_20260910" } },
    "/15028252/v1/uddi:older": { get: { summary: "한국장학재단_학자금지원정보(대학생)_20260424" } },
  },
};

const SCHOLARSHIP = {
  번호: 7, 운영기관명: "가상 장학재단", 상품명: "미래 SW 인재 장학금", 운영기관구분: "민간재단", 상품구분: "장학금",
  학자금유형구분: "성적우수", 대학구분: "4년제(5~6년제포함)", 학년구분: "대학2학기대학3학기대학4학기대학5학기대학6학기대학7학기대학8학기이상", 학과구분: "공학계열교육계열사회계열예체능계열의약계열인문계열자연계열",
  "성적기준 상세내용": "ㅇ전체 평점 3.5 이상", "소득기준 상세내용": "○ 해당없음", "지원내역 상세내용": "학기당 300만 원",
  "특정자격 상세내용": "-", "지역거주여부 상세내용": "해당없음", "선발방법 상세내용": "서류 및 면접",
  "선발인원 상세내용": "10명", "자격제한 상세내용": "", "추천필요여부 상세내용": "", "제출서류 상세내용": "○ 장학생 신청서○ 개인정보 수집·이용 동의서○ 재학증명서※ 자세한 사항은 첨부파일 또는 홈페이지 참고",
  "홈페이지 주소": "www.example.org/scholarship", 모집시작일: "2026-09-20", 모집종료일: "2026-10-15",
};

test("scholarships use the newest monthly dataset, encode the key once and evaluate the profile", async () => {
  const { fetcher, calls } = mockFetch((url) => url.host === "infuser.odcloud.kr"
    ? json(SPEC)
    : json({ page: 1, perPage: 1000, totalCount: 2, currentCount: 2, data: [SCHOLARSHIP, { ...SCHOLARSHIP, 번호: 8, 상품명: "지난 장학금", 모집종료일: "2026-09-30" }] }));
  const result = await getPublicScholarships(KEY, PROFILE, { fetcher, now: NOW });
  const dataCall = calls.find((url) => url.host === "api.odcloud.kr")!;
  assert.equal(dataCall.pathname, "/api/15028252/v1/uddi:latest");
  assert.equal(dataCall.searchParams.get("serviceKey"), KEY);
  assert.ok(dataCall.search.includes("abc%2Bdef%2Fghi%3D%3D"));
  assert.equal(result.total, 2);
  assert.equal(result.items.length, 1, "closed scholarships are excluded");
  const [item] = result.items;
  assert.equal(item.isSample, false);
  assert.equal(item.date, "2026-10-15");
  assert.equal(item.source, "https://www.example.org/scholarship");
  assert.deepEqual(item.documents, ["장학생 신청서", "개인정보 수집·이용 동의서", "재학증명서"]);
  assert.equal(item.conditions.find((entry) => entry.label.includes("학년"))!.status, "met");
  assert.equal(item.conditions.find((entry) => entry.label.includes("학과"))!.status, "met");
  assert.equal(item.conditions.find((entry) => entry.label.includes("성적"))!.status, "unknown");
  assert.ok(!item.conditions.some((entry) => entry.label.includes("소득")), "no-requirement fields are not shown as conditions");
  for (const entry of item.conditions) assert.ok(entry.reason.includes("공고 근거:"));

  const firstYear = await getPublicScholarships(KEY, { ...PROFILE, year: "1" }, { fetcher, now: NOW });
  assert.equal(firstYear.items[0].conditions.find((entry) => entry.label.includes("학년"))!.status, "unknown", "only the 2nd semester of year 1 is listed");
  const fifthYear = await getPublicScholarships(KEY, { ...PROFILE, year: "5" }, { fetcher, now: NOW });
  assert.equal(fifthYear.items[0].conditions.find((entry) => entry.label.includes("학년"))!.status, "met", "8학기이상 covers later years");
  assert.equal(calls.length, 2, "rows and the dataset path are cached; the profile is evaluated per request");
  await getPublicScholarships(KEY, PROFILE, { fetcher, now: NOW, refresh: true });
  assert.equal(calls.length, 4);
});

test("scholarship freshman-only rows and placeholder homepages follow the real data format", async () => {
  const row = { ...SCHOLARSHIP, 학년구분: "대학신입생", 학과구분: "특정학과", "홈페이지 주소": "해당없음", "제출서류 상세내용": "※ 기관확인필요" };
  const { fetcher } = mockFetch((url) => url.host === "infuser.odcloud.kr" ? json(SPEC) : json({ totalCount: 1, data: [row] }));
  const [item] = (await getPublicScholarships(KEY, PROFILE, { fetcher, now: NOW })).items;
  assert.equal(item.conditions.find((entry) => entry.label.includes("학년"))!.status, "unmet");
  assert.equal(item.conditions.find((entry) => entry.label.includes("학과"))!.status, "unknown");
  assert.equal(item.source, "한국장학재단 학자금지원정보 (공공데이터포털)");
  assert.ok(!item.originalText.includes("홈페이지"));
  assert.deepEqual(item.documents, []);
});

test("public jobs skip closed postings, accept both row shapes and rank interest matches first", async () => {
  const base = { instNm: "가상공사", hireTypeNmLst: "정규직", recrutSeNm: "신입", workRgnNmLst: "서울특별시", acbgCondNmLst: "학력무관", ongoingYn: "Y", pbancBgngYmd: "20260920", recrutNope: 3 };
  const { fetcher, calls } = mockFetch(() => json({
    resultCode: 200, resultMsg: "성공", totalCount: 4,
    result: [
      { ...base, recrutPblntSn: 1, recrutPbancTtl: "행정 일반 채용", pbancEndYmd: "20261020", ncsCdNmLst: "경영·회계·사무" },
      { item: { ...base, recrutPblntSn: 2, recrutPbancTtl: "전산직 채용", pbancEndYmd: "20261030", ncsCdNmLst: "정보통신", srcUrl: "https://job.alio.go.kr/2" } },
      { ...base, recrutPblntSn: 3, recrutPbancTtl: "마감된 채용", pbancEndYmd: "20260930" },
      { ...base, recrutPblntSn: 4, recrutPbancTtl: "중단된 채용", pbancEndYmd: "20261101", ongoingYn: "N" },
    ],
  }));
  const result = await getPublicJobs(KEY, PROFILE, { fetcher, now: NOW });
  assert.equal(calls[0].pathname, "/1051000/recruitment/list");
  assert.equal(calls[0].searchParams.get("resultType"), "json");
  assert.deepEqual(result.items.map((item) => item.id), ["alio-2", "alio-1"]);
  const [first] = result.items;
  assert.equal(first.source, "https://job.alio.go.kr/2");
  assert.equal(first.date, "2026-10-30");
  assert.equal(first.amount, "신입 3명");
  assert.match(first.recommendation, /관심 직무 "전산"/);
  assert.equal(first.conditions.every((entry) => entry.status === "met"), true);
  assert.deepEqual(first.documents, []);
});

test("exam schedules accept the nested item shape and keep only dated steps", async () => {
  const item = {
    implYy: "2026", implSeq: "4", qualgbCd: "T", qualgbNm: "국가기술자격", description: "국가기술자격 기사 (2026년도 제4회)",
    docRegStartDt: "20261012", docRegEndDt: "20261015", docExamStartDt: "20261101", docExamEndDt: "20261105", docPassDt: "20261120",
    pracRegStartDt: "", pracRegEndDt: "", pracExamStartDt: "", pracExamEndDt: "", pracPassDt: "",
  };
  const { fetcher, calls } = mockFetch(() => json({ header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, body: { items: { item }, numOfRows: 100, pageNo: 1, totalCount: 1 } }));
  const result = await getExamSchedules(KEY, "2026", "T", { fetcher });
  assert.equal(calls[0].searchParams.get("dataFormat"), "json");
  assert.equal(calls[0].searchParams.get("implYy"), "2026");
  assert.equal(calls[0].searchParams.get("qualgbCd"), "T");
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].steps.map((step) => step.id), ["doc-reg", "doc-exam", "doc-pass"]);
  assert.deepEqual(result.items[0].steps[0], { id: "doc-reg", label: "필기 원서접수", start: "2026-10-12", end: "2026-10-15" });

  const wrapped = mockFetch(() => json({ response: { header: { resultCode: "00" }, body: { items: [item, { ...item, implSeq: "5", description: "다른 회차" }], totalCount: 2 } } }));
  assert.equal((await getExamSchedules(KEY, "2027", "T", { fetcher: wrapped.fetcher })).items.length, 2);
});

test("gateway and network failures become readable errors without exposing the key", async () => {
  const cases: [Response | Error, number, RegExp][] = [
    [json({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", returnAuthMsg: "등록되지 않은 서비스키", returnReasonCode: "30" } } }), 502, /1~2시간/],
    [new Response("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>", { status: 200 }), 502, /호출 한도/],
    [json({ resultCode: 400, resultMsg: "잘못된 요청 파라미터" }), 502, /잘못된 요청 파라미터/],
    [new TypeError("fetch failed"), 504, /연결하지 못했습니다/],
  ];
  for (const [outcome, status, message] of cases) {
    clearPublicDataCache();
    const { fetcher } = mockFetch(() => { if (outcome instanceof Error) throw outcome; return outcome.clone(); });
    await assert.rejects(getPublicJobs(KEY, PROFILE, { fetcher, now: NOW }), (error: unknown) => {
      assert.ok(error instanceof RouteError);
      assert.equal(error.status, status);
      assert.match(error.message, message);
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  }
  const unauthorized = mockFetch((url) => url.host === "infuser.odcloud.kr" ? json(SPEC) : json({ code: -4, msg: "등록되지 않은 인증키 입니다." }, 401));
  await assert.rejects(getPublicScholarships(KEY, PROFILE, { fetcher: unauthorized.fetcher, now: NOW }), /활용신청 여부/);
});

test("dates are normalized and impossible dates are dropped", () => {
  assert.equal(toIsoDate("20261015"), "2026-10-15");
  assert.equal(toIsoDate("2026.10.15"), "2026-10-15");
  assert.equal(toIsoDate("2026-02-30"), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate(null), null);
});

function withEnvironment(t: TestContext, name: string, value: string | undefined) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test("the public data route requires a key, a valid query and a same-origin caller", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-public-data-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  withEnvironment(t, "DATABASE_URL", `file:${join(directory, "campus.db")}`);
  withEnvironment(t, "DATA_GO_KR_API_KEY", undefined);
  const call = (query: string, headers: Record<string, string> = {}) =>
    GET(new Request(`http://127.0.0.1:3000/api/public-data?${query}`, { headers: { host: "127.0.0.1:3000", ...headers } }));

  assert.equal((await call("source=jobs", { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("source=unknown")).status, 400);
  assert.equal((await call("source=exams&year=1999")).status, 400);
  const missing = await call("source=jobs");
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /인증키/);

  withEnvironment(t, "DATA_GO_KR_API_KEY", KEY);
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("serviceKey"), KEY);
    return json({ header: { resultCode: "00" }, body: { items: { item: [] }, totalCount: 0 } });
  });
  const ok = await call("source=exams&year=2026&qualification=S");
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).items, []);
});
