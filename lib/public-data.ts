import { createHash } from "node:crypto";
import { eligibilitySummary, seoulToday } from "./catalog";
import {
  QUALIFICATION_TYPES,
  type EligibilityCondition,
  type ExamSchedule,
  type ExamStep,
  type Opportunity,
  type Profile,
  type PublicDataResult,
  type QualificationType,
} from "./contracts";
import { RouteError } from "./http";

type Fetcher = typeof fetch;
type Row = Record<string, unknown>;

export interface PublicDataOptions {
  fetcher?: Fetcher;
  now?: Date;
  refresh?: boolean;
}

const RECRUITMENT_URL = "https://apis.data.go.kr/1051000/recruitment/list";
const MPM_JOBS_URL = "https://apis.data.go.kr/1760000/PblJobService/getList";
const EXAM_URL = "https://apis.data.go.kr/B490007/qualExamSchd/getQualExamSchdList";
const EXAM_PAGE_SIZE = 50;
// 한국장학재단 파일데이터는 매월 새 uddi로 갱신되므로 명세에서 최신 경로를 찾는다.
const SCHOLARSHIP_SPEC_URL = "https://infuser.odcloud.kr/oas/docs?namespace=15028252/v1";
const SCHOLARSHIP_BASE = "https://api.odcloud.kr/api";

const TIMEOUT_MS = 10_000;
const CACHE_MS = 30 * 60_000;
const SPEC_CACHE_MS = 12 * 60 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

const GATEWAY_ERRORS: Record<string, string> = {
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR: "등록되지 않은 인증키입니다. 활용신청 승인 직후에는 반영까지 1~2시간 걸릴 수 있습니다.",
  SERVICE_ACCESS_DENIED_ERROR: "이 데이터의 활용신청이 필요합니다. 공공데이터포털에서 활용신청 후 다시 시도해주세요.",
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: "오늘 호출 한도를 초과했습니다. 내일 다시 시도해주세요.",
  DEADLINE_HAS_EXPIRED_ERROR: "활용 기간이 만료되었습니다. 공공데이터포털에서 연장 신청해주세요.",
  UNREGISTERED_IP_ERROR: "등록되지 않은 IP에서 호출했습니다. 활용신청 정보를 확인해주세요.",
};

export function clearPublicDataCache(): void {
  cache.clear();
}

async function cached<T>(key: string, ttl: number, refresh: boolean, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// 캐시 키에 원본 인증키를 남기지 않는다.
function keyId(serviceKey: string): string {
  return createHash("sha256").update(serviceKey).digest("hex").slice(0, 12);
}

// 본문을 JSON으로 해석해 보고, XML로만 응답하는 서비스를 위해 원문도 함께 돌려준다.
async function getBody(url: URL, label: string, fetcher: Fetcher): Promise<{ text: string; data: unknown }> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new RouteError(504, `${label} 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.`);
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // 게이트웨이 인증 오류는 요청 형식과 상관없이 XML로 오기도 한다.
  }
  const header = (data as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string } } } | null)
    ?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  const code = header?.errMsg || text.match(/<errMsg>\s*([A-Z_]+)\s*<\/errMsg>/)?.[1];
  const authCode = header?.returnAuthMsg || text.match(/<returnAuthMsg>\s*([^<]+?)\s*<\/returnAuthMsg>/)?.[1];
  const gatewayCode = [code, authCode].find((value) => value && GATEWAY_ERRORS[value]);
  if (gatewayCode) throw new RouteError(502, `${label}: ${GATEWAY_ERRORS[gatewayCode]}`);
  if (code && code !== "NORMAL_SERVICE" && code !== "NORMAL_CODE") throw new RouteError(502, `${label}: ${authCode || code}`);
  if (!response.ok) {
    const message = (data as { msg?: unknown } | null)?.msg;
    const reason = response.status === 401 || response.status === 403
      ? "인증키를 확인하거나 이 데이터의 활용신청 여부를 확인해주세요."
      : typeof message === "string" && message ? message : `응답 오류 (${response.status})`;
    throw new RouteError(502, `${label}: ${reason}`);
  }
  return { text, data };
}

async function getJson(url: URL, label: string, fetcher: Fetcher): Promise<unknown> {
  const { data } = await getBody(url, label, fetcher);
  if (data === null || typeof data !== "object") throw new RouteError(502, `${label}: 응답 형식을 해석하지 못했습니다.`);
  return data;
}

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1].trim()) : "";
}

// 공공데이터포털 XML 응답의 <item> 하나는 하위 태그가 한 단계뿐이라 정규식으로 충분하다.
function xmlItems(xml: string): Row[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) =>
    Object.fromEntries([...body.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(([, tag, value]) => [tag, decodeXml(value.trim())])));
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function shorten(value: string, length = 160): string {
  const flat = value.replace(/\s+/g, " ");
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function list(value: unknown): string[] {
  return text(value).split(/[,/]/).map((item) => item.trim()).filter(Boolean);
}

// 20260930, 2026-09-30, 2026.09.30 형식을 모두 YYYY-MM-DD로 바꾼다.
export function toIsoDate(value: unknown): string | null {
  const match = text(value).match(/^(\d{4})\D?(\d{2})\D?(\d{2})/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

const NONE = /^(?:-|x|n|없음|해당\s*없음|해당사항\s*없음|미해당|무관)$/i;
const OPEN = /제한\s*없음|무관|전체|모든\s*(?:학년|학과|전공)|누구나/;
// 학자금지원정보 원문은 "○ ", "ㅇ", "※ " 같은 글머리 기호를 붙여 쓴다.
const BULLET = /^[\s○ㅇ•◦▪※*-]+/;
const FIELDS = ["공학계열", "교육계열", "사회계열", "예체능계열", "의약계열", "인문계열", "자연계열"];

function isNone(value: string): boolean {
  return !value || NONE.test(value.replace(BULLET, "").trim());
}

function condition(label: string, evidence: string, status: EligibilityCondition["status"], reason: string): EligibilityCondition {
  return { label: `필수: ${label}`, status, reason: `공고 근거: "${shorten(evidence)}". ${reason}` };
}

function profileYear(profile: Profile): number | null {
  const match = profile.year.trim().match(/^([1-6])(?:\s*학년)?$/);
  return match ? Number(match[1]) : null;
}

function yearCondition(value: string, profile: Profile): EligibilityCondition | null {
  if (isNone(value)) return null;
  if (OPEN.test(value)) return condition("학년", value, "met", "학년 제한이 없습니다.");
  const year = profileYear(profile);
  if (year === null) return condition("학년", value, "unknown", "현재 재학 학년을 입력해 주세요.");
  // 학자금지원정보는 "대학2학기대학3학기…대학8학기이상대학신입생"처럼 학기 단위로 나열한다.
  const semesters = new Set([...value.matchAll(/대학(\d{1,2})학기/g)].map((match) => Number(match[1])));
  if (value.includes("대학신입생")) semesters.add(1);
  if (semesters.size) {
    const eightPlus = value.includes("대학8학기이상");
    const own = [year * 2 - 1, year * 2];
    const included = own.map((semester) => semesters.has(semester) || (eightPlus && semester >= 8));
    const label = `${year}학년(${own[0]}·${own[1]}학기)`;
    if (included.every(Boolean)) return condition("학년", value, "met", `입력한 ${label}이 대상에 포함됩니다.`);
    if (!included.some(Boolean)) return condition("학년", value, "unmet", `입력한 ${label}은 대상 학기에 없습니다.`);
    return condition("학년", value, "unknown", `${label} 중 일부 학기만 대상입니다. 현재 이수 학기를 확인해 주세요.`);
  }
  const minimum = value.match(/([1-6])\s*학년\s*이상/);
  if (minimum) {
    return condition("학년", value, year >= Number(minimum[1]) ? "met" : "unmet", `입력한 학년은 ${year}학년입니다.`);
  }
  const listed = [...value.matchAll(/([1-6])\s*학년/g)].map((match) => Number(match[1]));
  if (!listed.length) return condition("학년", value, "unknown", "학년 기준을 원문에서 확인해 주세요.");
  return condition("학년", value, listed.includes(year) ? "met" : "unmet", `입력한 학년은 ${year}학년입니다.`);
}

function majorCondition(value: string, profile: Profile): EligibilityCondition | null {
  if (isNone(value)) return null;
  if (OPEN.test(value)) return condition("학과", value, "met", "학과 제한이 없습니다.");
  if (FIELDS.every((field) => value.includes(field))) return condition("학과", value, "met", "모든 계열이 대상입니다.");
  const major = profile.major.trim();
  if (!major) return condition("학과", value, "unknown", "전공을 입력해 주세요.");
  const core = major.replace(/(?:학부|학과|전공|대학)$/, "");
  if (core.length >= 2 && value.includes(core)) return condition("학과", value, "met", `입력한 전공 "${major}"이 포함됩니다.`);
  return condition("학과", value, "unknown", `입력한 전공 "${major}"이 대상 계열·학과인지 원문에서 확인해 주세요.`);
}

function textCondition(label: string, value: string, reason: string): EligibilityCondition | null {
  if (isNone(value)) return null;
  return condition(label, value, "unknown", reason);
}

function documentsFrom(value: string): string[] {
  if (isNone(value)) return [];
  // "○ 신청서○ 추천서※ 자세한 사항은 홈페이지 참고"처럼 한 줄로 붙어 오므로 글머리 기호에서 나눈다.
  // "수집·이용"처럼 서류명 안에 쓰이는 가운뎃점에서는 나누지 않는다.
  const items = value
    .split(/\n|,|;|○|ㅇ|•|◦|▪|※|\s-\s|\d+\)\s*|\(\d+\)\s*/)
    .map((item) => item.replace(BULLET, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 100 && !/참고|확인\s*필요|자세한\s*사항|해당\s*없음/.test(item));
  return [...new Set(items)].slice(0, 10);
}

function interestWords(profile: Profile): string[] {
  return profile.interests.split(/[,\s/]+/).map((word) => word.trim()).filter((word) => word.length >= 2);
}

function summary(conditions: EligibilityCondition[]): string {
  const overall = eligibilitySummary(conditions);
  return overall === "met"
    ? "확인한 필수 조건을 충족합니다. 선발 확정을 의미하지 않습니다."
    : overall === "unmet"
      ? "충족하지 못한 필수 조건이 있습니다."
      : "공고 원문에서 확인할 조건이 있습니다.";
}

interface ScholarshipRow {
  id: string;
  title: string;
  organization: string;
  organizationType: string;
  product: string;
  aidType: string;
  school: string;
  grade: string;
  major: string;
  gpa: string;
  income: string;
  support: string;
  qualification: string;
  residence: string;
  selection: string;
  quota: string;
  restriction: string;
  recommendation: string;
  documents: string;
  homepage: string;
  start: string | null;
  end: string | null;
}

async function latestScholarshipPath(fetcher: Fetcher, refresh: boolean): Promise<string> {
  return cached("scholarship-spec", SPEC_CACHE_MS, refresh, async () => {
    const spec = await getJson(new URL(SCHOLARSHIP_SPEC_URL), "한국장학재단 학자금지원정보", fetcher) as {
      paths?: Record<string, { get?: { summary?: string } }>;
    };
    const candidates = Object.entries(spec.paths || {})
      .map(([path, operation]) => ({ path, stamp: operation.get?.summary?.match(/(\d{8})\s*$/)?.[1] || "" }))
      .filter((item) => item.path.startsWith("/15028252/") && item.stamp)
      .sort((a, b) => b.stamp.localeCompare(a.stamp));
    if (!candidates.length) throw new RouteError(502, "한국장학재단 학자금지원정보: 최신 데이터 경로를 찾지 못했습니다.");
    return candidates[0].path;
  });
}

async function scholarshipRows(serviceKey: string, fetcher: Fetcher, refresh: boolean): Promise<ScholarshipRow[]> {
  const path = await latestScholarshipPath(fetcher, refresh);
  return cached(`scholarships:${keyId(serviceKey)}:${path}`, CACHE_MS, refresh, async () => {
    const rows: Row[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const url = new URL(`${SCHOLARSHIP_BASE}${path}`);
      url.search = new URLSearchParams({ page: String(page), perPage: "1000", returnType: "JSON", serviceKey }).toString();
      const data = await getJson(url, "한국장학재단 학자금지원정보", fetcher) as { data?: Row[]; totalCount?: number };
      const batch = Array.isArray(data.data) ? data.data : [];
      rows.push(...batch);
      if (!batch.length || rows.length >= Number(data.totalCount || 0)) break;
    }
    return rows.map((row, index) => ({
      id: `kosaf-${text(row["번호"]) || index}`,
      title: text(row["상품명"]),
      organization: text(row["운영기관명"]),
      organizationType: text(row["운영기관구분"]),
      product: text(row["상품구분"]),
      aidType: text(row["학자금유형구분"]),
      school: text(row["대학구분"]),
      grade: text(row["학년구분"]),
      major: text(row["학과구분"]),
      gpa: text(row["성적기준 상세내용"]),
      income: text(row["소득기준 상세내용"]),
      support: text(row["지원내역 상세내용"]),
      qualification: text(row["특정자격 상세내용"]),
      residence: text(row["지역거주여부 상세내용"]),
      selection: text(row["선발방법 상세내용"]),
      quota: text(row["선발인원 상세내용"]),
      restriction: text(row["자격제한 상세내용"]),
      recommendation: text(row["추천필요여부 상세내용"]),
      documents: text(row["제출서류 상세내용"]),
      homepage: text(row["홈페이지 주소"]),
      start: toIsoDate(row["모집시작일"]),
      end: toIsoDate(row["모집종료일"]),
    }));
  });
}

function scholarshipOpportunity(row: ScholarshipRow & { end: string }, profile: Profile): Opportunity {
  const conditions = [
    yearCondition(row.grade, profile),
    majorCondition(row.major, profile),
    textCondition("성적 기준", row.gpa, "프로필 학점과 공고의 성적 산정 기준이 같은지 확인해 주세요."),
    textCondition("소득 기준", row.income, "프로필에 소득 정보가 없어 학자금 지원구간 확인이 필요합니다."),
    textCondition("특정 자격", row.qualification, "해당 자격을 갖췄는지 확인해 주세요."),
    textCondition("거주 지역", row.residence, "거주 지역 요건을 확인해 주세요."),
    textCondition("자격 제한", row.restriction, "중복 수혜 등 제한 사항을 확인해 주세요."),
    textCondition("추천 필요", row.recommendation, "학교나 기관의 추천이 필요한지 확인해 주세요."),
  ].filter((item): item is EligibilityCondition => item !== null);
  const homepage = isNone(row.homepage) ? "" : /^https?:\/\//i.test(row.homepage) ? row.homepage : /^[\w-]+(\.[\w-]+)+/.test(row.homepage) ? `https://${row.homepage}` : "";
  const support = row.support.replace(BULLET, "");
  const lines: [string, string][] = [
    ["운영기관", `${row.organization}${row.organizationType ? ` (${row.organizationType})` : ""}`],
    ["상품", `${row.title} · ${row.product} · ${row.aidType}`],
    ["대학 구분", row.school], ["학년", row.grade], ["학과", row.major],
    ["성적 기준", row.gpa], ["소득 기준", row.income], ["지원 내역", row.support],
    ["특정 자격", row.qualification], ["거주 지역", row.residence], ["선발 방법", row.selection],
    ["선발 인원", row.quota], ["자격 제한", row.restriction], ["추천 필요", row.recommendation],
    ["제출 서류", row.documents], ["모집 기간", `${row.start || "시작일 미기재"} ~ ${row.end}`], ["홈페이지", homepage],
  ];
  return {
    id: row.id,
    kind: "scholarship",
    title: row.title,
    organization: row.organization,
    description: shorten(support || `${row.product} · ${row.aidType}`, 90),
    date: row.end,
    time: null,
    amount: shorten(support || "원문 확인", 40),
    tags: [...new Set([row.organizationType, row.aidType].filter((tag) => !isNone(tag)))],
    source: homepage || "한국장학재단 학자금지원정보 (공공데이터포털)",
    originalText: `[공공데이터포털 · 한국장학재단 학자금지원정보]\n${lines.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n")}\n마감 시각은 데이터에 없으므로 기관 공지에서 확인하세요.`,
    documents: documentsFrom(row.documents),
    conditions,
    recommendation: summary(conditions),
    isSample: false,
  };
}

export async function getPublicScholarships(serviceKey: string, profile: Profile, options: PublicDataOptions = {}): Promise<PublicDataResult<Opportunity>> {
  const rows = await scholarshipRows(serviceKey, options.fetcher || fetch, Boolean(options.refresh));
  const today = seoulToday(options.now);
  const items = rows
    .filter((row): row is ScholarshipRow & { end: string } => Boolean(row.title && row.end && row.end >= today))
    .map((row) => scholarshipOpportunity(row, profile))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { items, total: rows.length, fetchedAt: new Date().toISOString() };
}

interface RecruitmentRow {
  id: string;
  title: string;
  organization: string;
  hireTypes: string[];
  recruitType: string;
  regions: string[];
  fields: string[];
  education: string;
  qualification: string;
  preference: string;
  disqualification: string;
  process: string;
  headcount: string;
  replacement: boolean;
  ongoing: boolean;
  start: string | null;
  end: string | null;
  url: string;
}

async function recruitmentRows(serviceKey: string, fetcher: Fetcher, refresh: boolean): Promise<RecruitmentRow[]> {
  return cached(`jobs:${keyId(serviceKey)}`, CACHE_MS, refresh, async () => {
    const rows: Row[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const url = new URL(RECRUITMENT_URL);
      url.search = new URLSearchParams({ serviceKey, resultType: "json", numOfRows: "100", pageNo: String(page), ongoingYn: "Y" }).toString();
      const data = await getJson(url, "공공기관 채용정보", fetcher) as { resultCode?: number | string; resultMsg?: string; totalCount?: number; result?: unknown };
      if (data.resultCode !== undefined && Number(data.resultCode) !== 200 && Number(data.resultCode) !== 0) {
        throw new RouteError(502, `공공기관 채용정보: ${data.resultMsg || `응답 코드 ${data.resultCode}`}`);
      }
      const batch = (Array.isArray(data.result) ? data.result : data.result ? [data.result] : [])
        .map((entry) => ((entry as { item?: Row }).item || entry) as Row);
      rows.push(...batch);
      if (batch.length < 100 || rows.length >= Number(data.totalCount || 0)) break;
    }
    return rows.map((row) => ({
      id: `alio-${text(row.recrutPblntSn)}`,
      title: text(row.recrutPbancTtl),
      organization: text(row.instNm),
      hireTypes: list(row.hireTypeNmLst),
      recruitType: text(row.recrutSeNm),
      regions: list(row.workRgnNmLst),
      fields: list(row.ncsCdNmLst),
      education: text(row.acbgCondNmLst),
      qualification: text(row.aplyQlfcCn),
      preference: text(row.prefCondCn || row.prefCn),
      disqualification: text(row.disqlfcRsn),
      process: text(row.scrnprcdrMthdExpln),
      headcount: text(row.recrutNope),
      replacement: text(row.replmprYn) === "Y",
      ongoing: text(row.ongoingYn) !== "N",
      start: toIsoDate(row.pbancBgngYmd),
      end: toIsoDate(row.pbancEndYmd),
      url: text(row.srcUrl),
    }));
  });
}

function jobOpportunity(row: RecruitmentRow & { end: string }, profile: Profile): Opportunity & { matched: boolean } {
  const conditions: EligibilityCondition[] = [];
  if (row.recruitType) {
    conditions.push(/신입/.test(row.recruitType)
      ? condition("채용 구분", row.recruitType, "met", "신입 지원이 가능한 공고입니다.")
      : condition("채용 구분", row.recruitType, "unknown", "신입 지원 가능 여부를 원문에서 확인해 주세요."));
  }
  if (row.education) {
    conditions.push(/무관/.test(row.education)
      ? condition("학력", row.education, "met", "학력 제한이 없습니다.")
      : condition("학력", row.education, "unknown", "졸업(예정) 시기가 학력 요건에 맞는지 확인해 주세요."));
  }
  const qualification = textCondition("지원 자격", row.qualification, "지원 자격 전문을 원문에서 확인해 주세요.");
  if (qualification) conditions.push(qualification);
  const { fit, matched } = interestFit(`${row.title} ${row.fields.join(" ")}`, profile);
  const lines: [string, string][] = [
    ["기관", row.organization], ["공고", row.title], ["채용 구분", row.recruitType],
    ["고용 유형", row.hireTypes.join(", ")], ["채용 인원", row.headcount ? `${row.headcount}명` : ""],
    ["근무 지역", row.regions.join(", ")], ["직무 분야(NCS)", row.fields.join(", ")], ["학력", row.education],
    ["지원 자격", row.qualification], ["우대 조건", row.preference], ["결격 사유", row.disqualification],
    ["전형 절차", row.process], ["공고 기간", `${row.start || "시작일 미기재"} ~ ${row.end}`],
    ["대체인력 채용", row.replacement ? "예" : ""], ["출처", row.url],
  ];
  return {
    id: row.id,
    kind: "job",
    title: row.title,
    organization: row.organization,
    description: [row.hireTypes.join("·"), row.regions.slice(0, 2).join("·"), row.fields.slice(0, 2).join("·")].filter(Boolean).join(" · ") || "공공기관 채용 공고",
    date: row.end,
    time: null,
    amount: [row.recruitType, row.headcount ? `${row.headcount}명` : ""].filter(Boolean).join(" ") || "원문 확인",
    tags: [...new Set([...row.hireTypes, ...(row.replacement ? ["대체인력"] : []), ...row.regions.slice(0, 1)])].slice(0, 4),
    source: /^https?:\/\//i.test(row.url) ? row.url : "공공기관 채용정보 (공공데이터포털)",
    originalText: `[공공데이터포털 · 공공기관 채용정보]\n${lines.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n")}\n마감 시각과 제출 서류는 기관 공고 원문에서 확인하세요.`,
    documents: [],
    conditions,
    recommendation: `${fit}${summary(conditions)}`,
    isSample: false,
    matched,
  };
}

function interestFit(haystack: string, profile: Profile): { fit: string; matched: boolean } {
  const lower = haystack.toLowerCase();
  const interest = interestWords(profile).find((word) => lower.includes(word.toLowerCase()));
  const fit = interest
    ? `관심 직무 "${interest}"와 연결되는 공고입니다. `
    : profile.interests.trim() ? "관심 직무와 직접 연결되는 키워드가 없습니다. 직무 내용을 확인해 주세요. " : "관심 직무를 입력하면 직무 적합성을 비교할 수 있습니다. ";
  return { fit, matched: Boolean(interest) };
}

// 인사혁신처 나라일터 공고유형 중 학생이 지원할 수 있는 유형만 조회한다.
// 공모직위·전입공모는 재직 공무원 대상이고, 공공기관 공모(e08)는 공공기관 채용정보와 겹친다.
const MPM_TYPES: Record<string, string> = { e01: "공개경쟁채용", e02: "경력경쟁채용", e03: "계약직", e04: "행정지원인력" };
const MPM_AGENCIES: Record<string, string> = { g01: "국가공무원", g02: "지방공무원", g03: "공공기관", g04: "교육청" };
const MPM_LABEL = "인사혁신처 공공취업정보";
// 접수 기간이 한 달을 넘는 공고는 드물어 최근 등록분만 조회한다.
// 목록이 오래된 순으로 와서 페이지 수가 부족하면 최신 공고가 빠지므로, 기간을 줄이고 끝까지(최대 5페이지) 읽는다.
const MPM_LOOKBACK_DAYS = 30;
const MPM_MAX_PAGES = 5;

interface MpmRow {
  id: string;
  title: string;
  organization: string;
  agency: string;
  hireType: string;
  start: string | null;
  end: string | null;
}

function mpmPage(raw: string, data: unknown): { items: Row[]; total: number } {
  if (data && typeof data === "object") {
    const root = data as { response?: unknown };
    const { header, body } = (root.response || root) as { header?: { resultCode?: unknown; resultMsg?: unknown }; body?: { items?: unknown; totalCount?: unknown } };
    if (header?.resultCode === undefined) throw new RouteError(502, `${MPM_LABEL}: 응답 형식을 해석하지 못했습니다.`);
    if (!["00", "0"].includes(String(header.resultCode))) throw new RouteError(502, `${MPM_LABEL}: ${text(header.resultMsg) || `응답 코드 ${header.resultCode}`}`);
    const items = body?.items && typeof body.items === "object" && !Array.isArray(body.items) && "item" in body.items
      ? (body.items as { item: unknown }).item
      : body?.items;
    return {
      items: Array.isArray(items) ? items as Row[] : items && typeof items === "object" ? [items as Row] : [],
      total: Number(body?.totalCount || 0),
    };
  }
  const code = xmlValue(raw, "resultCode");
  if (!code) throw new RouteError(502, `${MPM_LABEL}: 응답 형식을 해석하지 못했습니다.`);
  if (!["00", "0"].includes(code)) throw new RouteError(502, `${MPM_LABEL}: ${xmlValue(raw, "resultMsg") || `응답 코드 ${code}`}`);
  return { items: xmlItems(raw), total: Number(xmlValue(raw, "totalCount") || 0) };
}

async function mpmRows(serviceKey: string, fetcher: Fetcher, refresh: boolean, today: string): Promise<MpmRow[]> {
  const since = addDays(today, -MPM_LOOKBACK_DAYS);
  return cached(`mpm:${keyId(serviceKey)}:${since}`, CACHE_MS, refresh, async () => {
    // 공고 유형별 조회는 서로 독립이라 동시에 보내 첫 로딩 시간을 줄인다.
    const rows = (await Promise.all(Object.keys(MPM_TYPES).map(async (type) => {
      const typeRows: Row[] = [];
      for (let page = 1; page <= MPM_MAX_PAGES; page += 1) {
        const url = new URL(MPM_JOBS_URL);
        // Instt_se를 비우면 국가직·지방직·공공기관 전체를 조회한다.
        url.search = new URLSearchParams({
          serviceKey, pageNo: String(page), numOfRows: "100", Pblanc_ty: type, Instt_se: "",
          Begin_de: since, End_de: today, Sort_order: "1",
        }).toString();
        const { text: body, data } = await getBody(url, MPM_LABEL, fetcher);
        const { items, total } = mpmPage(body, data);
        typeRows.push(...items);
        if (items.length < 100 || typeRows.length >= total) break;
      }
      return typeRows;
    }))).flat();
    const unique = new Map<string, MpmRow>();
    for (const row of rows) {
      const idx = text(row.idx);
      if (!idx || unique.has(idx)) continue;
      unique.set(idx, {
        id: `mpm-${idx}`,
        title: text(row.title),
        organization: text(row.insttname),
        agency: MPM_AGENCIES[text(row.type01)] || "",
        hireType: MPM_TYPES[text(row.type02)] || "",
        start: toIsoDate(row.regdate),
        end: toIsoDate(row.enddate),
      });
    }
    return [...unique.values()];
  });
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mpmOpportunity(row: MpmRow & { end: string }, profile: Profile): Opportunity & { matched: boolean } {
  // 목록 조회에는 응시 자격이 없으므로 '확인 필요'로 남겨 조건 충족으로 오해하지 않게 한다.
  const conditions: EligibilityCondition[] = [{
    label: "필수: 응시 자격",
    status: "unknown",
    reason: "공공취업정보 목록에는 응시 자격이 없습니다. 나라일터 공고 원문에서 확인해 주세요.",
  }];
  const { fit, matched } = interestFit(row.title, profile);
  const lines: [string, string][] = [
    ["기관", row.organization], ["공고", row.title], ["기관 구분", row.agency], ["채용 유형", row.hireType],
    ["공고 기간", `${row.start || "등록일 미기재"} ~ ${row.end}`],
  ];
  return {
    id: row.id,
    kind: "job",
    title: row.title,
    organization: row.organization,
    description: [row.agency, row.hireType].filter(Boolean).join(" · ") || "공공 채용 공고",
    date: row.end,
    time: null,
    amount: row.hireType || "원문 확인",
    tags: [row.agency, row.hireType, "나라일터"].filter(Boolean),
    source: `${MPM_LABEL} · 나라일터 (공공데이터포털)`,
    originalText: `[공공데이터포털 · ${MPM_LABEL}]\n${lines.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join("\n")}\n응시 자격, 제출 서류, 마감 시각은 나라일터(www.gojobs.go.kr)의 공고 원문에서 확인하세요.`,
    documents: [],
    conditions,
    recommendation: `${fit}${summary(conditions)}`,
    isSample: false,
    matched,
  };
}

function failureMessage(reason: unknown, label: string): string {
  return reason instanceof RouteError ? reason.message : `${label}: 공고를 불러오지 못했습니다.`;
}

export async function getPublicJobs(serviceKey: string, profile: Profile, options: PublicDataOptions = {}): Promise<PublicDataResult<Opportunity>> {
  const fetcher = options.fetcher || fetch;
  const refresh = Boolean(options.refresh);
  const today = seoulToday(options.now);
  // 한 서비스의 활용신청이 안 됐거나 장애가 나도 다른 서비스의 공고는 보여준다.
  const [alio, mpm] = await Promise.allSettled([recruitmentRows(serviceKey, fetcher, refresh), mpmRows(serviceKey, fetcher, refresh, today)]);
  if (alio.status === "rejected" && mpm.status === "rejected") throw alio.reason;
  const alioRows = alio.status === "fulfilled" ? alio.value : [];
  const mpmRowsFound = mpm.status === "fulfilled" ? mpm.value : [];
  const items = [
    ...alioRows
      .filter((row): row is RecruitmentRow & { end: string } => Boolean(row.title && row.ongoing && row.end && row.end >= today))
      .map((row) => jobOpportunity(row, profile)),
    ...mpmRowsFound
      .filter((row): row is MpmRow & { end: string } => Boolean(row.title && row.end && row.end >= today))
      .map((row) => mpmOpportunity(row, profile)),
  ]
    .sort((a, b) => Number(b.matched) - Number(a.matched) || a.date.localeCompare(b.date))
    .map(({ matched: _matched, ...item }) => item);
  const notices = [
    ...(alio.status === "rejected" ? [failureMessage(alio.reason, "공공기관 채용정보")] : []),
    ...(mpm.status === "rejected" ? [failureMessage(mpm.reason, MPM_LABEL)] : []),
  ];
  return {
    items,
    total: alioRows.length + mpmRowsFound.length,
    fetchedAt: new Date().toISOString(),
    ...(notices.length ? { notices } : {}),
  };
}

const EXAM_STEPS: { id: string; label: string; start: string; end?: string }[] = [
  { id: "doc-reg", label: "필기 원서접수", start: "docRegStartDt", end: "docRegEndDt" },
  { id: "doc-exam", label: "필기시험", start: "docExamStartDt", end: "docExamEndDt" },
  { id: "doc-pass", label: "필기 합격 발표", start: "docPassDt" },
  { id: "prac-reg", label: "실기·면접 원서접수", start: "pracRegStartDt", end: "pracRegEndDt" },
  { id: "prac-exam", label: "실기·면접 시험", start: "pracExamStartDt", end: "pracExamEndDt" },
  { id: "prac-pass", label: "최종 합격 발표", start: "pracPassDt" },
];

function examItems(data: unknown): Row[] {
  const root = data as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: unknown }; header?: { resultCode?: string; resultMsg?: string }; body?: unknown };
  const header = root.response?.header || root.header;
  if (header?.resultCode && !["00", "0", "000"].includes(String(header.resultCode))) {
    throw new RouteError(502, `국가자격 시험일정: ${header.resultMsg || `응답 코드 ${header.resultCode}`}`);
  }
  const body = (root.response?.body || root.body || {}) as { items?: unknown; totalCount?: number };
  const items = body.items && typeof body.items === "object" && !Array.isArray(body.items) && "item" in body.items
    ? (body.items as { item: unknown }).item
    : body.items;
  return Array.isArray(items) ? items as Row[] : items && typeof items === "object" ? [items as Row] : [];
}

export async function getExamSchedules(serviceKey: string, year: string, qualification: QualificationType, options: PublicDataOptions = {}): Promise<PublicDataResult<ExamSchedule>> {
  const fetcher = options.fetcher || fetch;
  const rows = await cached(`exams:${keyId(serviceKey)}:${year}:${qualification}`, CACHE_MS, Boolean(options.refresh), async () => {
    const collected: Row[] = [];
    // 큐넷 시험일정은 한 페이지에 50개까지만 허용한다(초과 시 오류 응답).
    for (let page = 1; page <= 10; page += 1) {
      const url = new URL(EXAM_URL);
      url.search = new URLSearchParams({ serviceKey, numOfRows: String(EXAM_PAGE_SIZE), pageNo: String(page), dataFormat: "json", implYy: year, qualgbCd: qualification }).toString();
      const data = await getJson(url, "국가자격 시험일정", fetcher);
      const batch = examItems(data);
      collected.push(...batch);
      const root = data as { response?: { body?: { totalCount?: number } }; body?: { totalCount?: number } };
      const total = Number(root.response?.body?.totalCount ?? root.body?.totalCount ?? 0);
      if (batch.length < EXAM_PAGE_SIZE || collected.length >= total) break;
    }
    return collected;
  });
  const items = rows.map((row, index): ExamSchedule => {
    const steps = EXAM_STEPS.map((step): ExamStep => ({
      id: step.id,
      label: step.label,
      start: toIsoDate(row[step.start]),
      end: step.end ? toIsoDate(row[step.end]) : null,
    })).filter((step) => step.start || step.end);
    const round = text(row.implSeq);
    const name = text(row.qualgbNm) || QUALIFICATION_TYPES[qualification];
    return {
      id: `qnet-${text(row.implYy) || year}-${text(row.qualgbCd) || qualification}-${round || index}-${createHash("sha256").update(text(row.description)).digest("hex").slice(0, 8)}`,
      year: text(row.implYy) || year,
      round,
      qualification: name,
      title: text(row.description) || `${name} ${year}년 제${round}회`,
      steps,
    };
  }).filter((item) => item.steps.length)
    .sort((a, b) => (a.steps[0].start || a.steps[0].end || "").localeCompare(b.steps[0].start || b.steps[0].end || ""));
  return { items, total: rows.length, fetchedAt: new Date().toISOString() };
}
