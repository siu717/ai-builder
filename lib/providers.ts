import type { Profile } from "./contracts";
import { clean, extractDeadline, hash, parseLooseDate, upcoming, validDate, type ImportedItem, type ImportKind } from "./importers";
import { FetchError, type TextFetcher } from "./safe-fetch";

/**
 * 서버에 키만 넣으면 사용자가 따로 등록하지 않아도 켜지는 기본 수집원.
 * 같은 키를 쓰는 수집원은 한 번의 활용 신청으로 함께 동작한다.
 */
export const PROVIDERS = {
  kosaf: { label: "한국장학재단 장학금", kind: "scholarship", env: "DATA_GO_KR_SERVICE_KEY", signup: "https://www.data.go.kr/data/15028252/openapi.do" },
  gov24: { label: "정부24 장학 · 학생 지원", kind: "scholarship", env: "DATA_GO_KR_SERVICE_KEY", signup: "https://www.data.go.kr/data/15113968/openapi.do" },
  youth: { label: "온통청년 청년정책", kind: "career", env: "YOUTHCENTER_API_KEY", signup: "https://www.youthcenter.go.kr/cmnFooter/openapiIntro/oaApiDtl" },
  alio: { label: "공공기관 채용 (잡알리오)", kind: "job", env: "DATA_GO_KR_SERVICE_KEY", signup: "https://www.data.go.kr/data/15125273/openapi.do" },
  work24: { label: "고용24 신입 채용", kind: "job", env: "WORK24_AUTH_KEY", signup: "https://www.work24.go.kr/cm/e/a/0110/selectOpenApiIntro.do" },
  saramin: { label: "사람인 채용", kind: "job", env: "SARAMIN_ACCESS_KEY", signup: "https://oapi.saramin.co.kr/" },
  qnet: { label: "국가기술자격 시험 접수", kind: "career", env: "DATA_GO_KR_SERVICE_KEY", signup: "https://www.data.go.kr/data/15074408/openapi.do" },
} as const satisfies Record<string, { label: string; kind: ImportKind; env: string; signup: string }>;

export type ProviderType = keyof typeof PROVIDERS;
export const PROVIDER_TYPES = Object.keys(PROVIDERS) as ProviderType[];

export function providerKey(type: ProviderType): string {
  const key = process.env[PROVIDERS[type].env]?.trim() || "";
  if (!key) throw new FetchError(`서버에 ${PROVIDERS[type].env}를 설정해 주세요.`);
  // 공공데이터포털은 인코딩·디코딩 키를 함께 준다. 어느 쪽을 넣어도 동작하도록 디코딩해서 쓴다.
  return key.includes("%") ? decodeURIComponent(key) : key;
}

export function providerConfigured(type: ProviderType): boolean {
  return Boolean(process.env[PROVIDERS[type].env]?.trim());
}

export interface ProviderContext {
  fetcher: TextFetcher;
  today: string;
  profile: Profile;
}

// ---------------------------------------------------------------------------
// 프로필 맞춤

const FIELD_GROUPS: [RegExp, string][] = [
  [/(컴퓨터|소프트웨어|전산|정보|전자|전기|기계|공학|건축|토목|화공|신소재|산업|반도체|AI|인공지능|데이터)/i, "공학"],
  [/(수학|물리|화학|생명|생물|통계|지구|천문|자연)/, "자연"],
  [/(경영|경제|행정|사회|정치|법|무역|회계|심리|미디어|언론|광고)/, "사회"],
  [/(국문|국어|영문|영어|사학|철학|어문|문학|인문|중문|일문|불문|독문)/, "인문"],
  [/(교육)/, "교육"],
  [/(의학|간호|약학|치의|한의|보건|의료)/, "의약"],
  [/(미술|음악|체육|디자인|무용|연극|영화|예술)/, "예체능"],
];

/** "컴퓨터공학과" → "컴퓨터공학", "경영학부" → "경영" */
function stripMajorSuffix(word: string): string {
  return word.replace(/(학부|전공|계열)$/, "").replace(/(?<=학)과$/, "").replace(/(?<!학)과$/, "");
}

/** 프로필의 전공·관심 직무에서 공고와 비교할 단어를 만든다. */
export function profileTerms(profile: Profile): string[] {
  const words = `${profile.interests} ${profile.major}`
    .split(/[\s,/·|]+/)
    .map((word) => stripMajorSuffix(word).trim())
    .filter((word) => word.length >= 2);
  const major = stripMajorSuffix(profile.major);
  const group = FIELD_GROUPS.find(([pattern]) => pattern.test(major))?.[1];
  return [...new Set([...words, ...(group ? [`${group}계열`] : [])])].slice(0, 12);
}

export function profileMatches(item: Pick<ImportedItem, "title" | "summary" | "organization">, profile: Profile): string[] {
  const text = `${item.title} ${item.organization} ${item.summary}`.toLowerCase();
  return profileTerms(profile).filter((term) => text.includes(term.toLowerCase()));
}

// ---------------------------------------------------------------------------
// 공통 도우미

function parseJson(text: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const message = text.match(/<returnAuthMsg>([^<]+)/)?.[1] || text.match(/<errMsg>([^<]+)/)?.[1] || text.match(/<error>([^<]+)/)?.[1];
    throw new FetchError(message ? `${label}: ${message.trim()}` : `${label} 응답을 읽지 못했습니다.`);
  }
}

/** 응답 구조가 버전마다 조금씩 달라서, 지정한 필드를 가진 객체 배열을 찾아 쓴다. */
function findRows(value: unknown, field: string): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    if (value.some((entry) => entry && typeof entry === "object" && field in entry)) return value as Record<string, unknown>[];
    for (const entry of value) {
      const rows = findRows(entry, field);
      if (rows.length) return rows;
    }
    return [];
  }
  if (value && typeof value === "object") {
    if (field in value) return [value as Record<string, unknown>];
    for (const entry of Object.values(value)) {
      const rows = findRows(entry, field);
      if (rows.length) return rows;
    }
  }
  return [];
}

function text(value: unknown, max = 800): string {
  const result = clean(String(value ?? ""), max);
  return /^(해당\s*없음|없음|-|null|undefined)$/i.test(result) ? "" : result;
}

function field(label: string, value: unknown): string {
  const content = text(value);
  return content ? `${label}: ${content}` : "";
}

function lines(value: unknown, max = 10): string[] {
  return String(value ?? "")
    .split(/\n|(?:^|\s)[○●◦•▪■□※-]\s|[0-9]\)\s|,\s*(?=[가-힣])/)
    .map((entry) => clean(entry, 200).replace(/^[-·•○●◦▪■□※\s]+/, ""))
    .filter((entry) => entry.length >= 2 && !/^(해당\s*없음|없음|-)$/.test(entry))
    .slice(0, max);
}

function absoluteUrl(value: unknown): string {
  const url = text(value, 2000);
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`;
}

/** 지자체 사업은 사는 곳을 알아야 대상 여부를 판단할 수 있어 기본 수집에서 뺀다. */
const LOCAL_GOVERNMENT = /(특별시|광역시|특별자치|[가-힣]+도$|[가-힣]+도\s|[가-힣]+(시|군|구)(청)?$|[가-힣]+(시|군|구)\s)/;

// ---------------------------------------------------------------------------
// 한국장학재단 학자금 지원정보 (공공데이터포털)

const KOSAF_NAMESPACE = "15028252/v1";

export async function fetchKosaf({ fetcher, today }: ProviderContext): Promise<ImportedItem[]> {
  const key = providerKey("kosaf");
  // 데이터는 매달 새 버전으로 올라온다. 문서에서 가장 최근 버전을 찾는다.
  const doc = parseJson(await fetcher(`https://infuser.odcloud.kr/oas/docs?namespace=${KOSAF_NAMESPACE}`), "한국장학재단 API 문서");
  const paths = Object.keys((doc.paths as Record<string, unknown>) || {});
  if (!paths.length) throw new FetchError("한국장학재단 데이터 목록을 찾지 못했습니다.");
  const path = paths[paths.length - 1];
  const items: ImportedItem[] = [];
  for (let page = 1; page <= 5; page++) {
    const body = parseJson(await fetcher(`https://api.odcloud.kr/api${path}?page=${page}&perPage=1000&serviceKey=${encodeURIComponent(key)}`), "한국장학재단");
    if (typeof body.code === "number" && body.code < 0) throw new FetchError(`한국장학재단: ${String(body.msg || "인증에 실패했습니다.")}`);
    const rows = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
    for (const row of rows) {
      const { date } = parseLooseDate(row["모집종료일"]);
      const title = text(row["상품명"], 200);
      const school = text(row["대학구분"]);
      // 대학원·고교·해외대학 전용 상품은 학부생 대상이 아니다.
      if (!upcoming(date, today) || !title || (school && !/(4년|전문|일반|대학교|대학\(|제한\s*없음|해당\s*없음|전체)/.test(school))) continue;
      const organization = text(row["운영기관명"], 120);
      items.push({
        externalId: hash(organization, title, String(row["모집시작일"] || "")),
        kind: "scholarship",
        title,
        organization,
        date,
        time: null,
        url: absoluteUrl(row["홈페이지 주소"]),
        summary: [
          field("지원 내용", row["지원내역 상세내용"]), field("대학 구분", school), field("대상 학년", row["학년구분"]),
          field("대상 학과", row["학과구분"]), field("성적 기준", row["성적기준 상세내용"]), field("소득 기준", row["소득기준 상세내용"]),
          field("특정 자격", row["특정자격 상세내용"]), field("선발 방법", row["선발방법 상세내용"]),
          `모집 기간: ${text(row["모집시작일"]) || "확인 필요"} ~ ${date}`,
        ].filter(Boolean).join("\n").slice(0, 3000),
        documents: lines(row["제출서류 상세내용"]),
        dateNote: "한국장학재단 공공데이터의 모집 종료일입니다. 신청 마감 시각은 운영기관 공고에서 확인해 주세요.",
      });
    }
    if (rows.length < 1000) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// 정부24 공공서비스(혜택) 정보 (공공데이터포털)

export async function fetchGov24({ fetcher, today }: ProviderContext): Promise<ImportedItem[]> {
  const key = providerKey("gov24");
  const items: ImportedItem[] = [];
  const seen = new Set<string>();
  for (const name of ["장학", "대학생"]) {
    for (let page = 1; page <= 3; page++) {
      const query = new URLSearchParams({ page: String(page), perPage: "500", serviceKey: key, "cond[서비스명::LIKE]": name });
      const body = parseJson(await fetcher(`https://api.odcloud.kr/api/gov24/v3/serviceList?${query}`), "정부24 공공서비스");
      if (typeof body.code === "number" && body.code < 0) throw new FetchError(`정부24 공공서비스: ${String(body.msg || "인증에 실패했습니다.")}`);
      const rows = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
      for (const row of rows) {
        const id = String(row["서비스ID"] || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (text(row["소관기관유형"]).includes("지방자치단체") || LOCAL_GOVERNMENT.test(text(row["소관기관명"]))) continue;
        if (!/(대학|청년|학생)/.test(`${text(row["지원대상"])} ${text(row["서비스명"])}`)) continue;
        const period = text(row["신청기한"], 300);
        // "상시신청"처럼 마감이 없는 서비스는 일정이 되지 않는다.
        const deadline = period ? extractDeadline(period, today) : null;
        if (!deadline) continue;
        const title = text(row["서비스명"], 200);
        items.push({
          externalId: id,
          kind: /장학/.test(title) ? "scholarship" : "career",
          title,
          organization: text(row["소관기관명"], 120),
          date: deadline.date,
          time: deadline.time,
          url: absoluteUrl(row["상세조회URL"]),
          summary: [
            field("요약", row["서비스목적요약"]), field("지원 대상", row["지원대상"]), field("선정 기준", row["선정기준"]),
            field("지원 내용", row["지원내용"]), field("신청 방법", row["신청방법"]), field("신청 기한", period), field("접수 기관", row["접수기관"]),
          ].filter(Boolean).join("\n").slice(0, 3000),
          documents: [],
          dateNote: `정부24 신청 기한("${period.slice(0, 60)}")에서 찾은 날짜입니다. 원문에서 마감을 확인해 주세요.`,
        });
      }
      if (rows.length < 500) break;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 온통청년 청년정책 (한국고용정보원)

export async function fetchYouth({ fetcher, today }: ProviderContext): Promise<ImportedItem[]> {
  const key = providerKey("youth");
  const items: ImportedItem[] = [];
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ apiKeyNm: key, pageNum: String(page), pageSize: "100", rtnType: "json" });
    const body = parseJson(await fetcher(`https://www.youthcenter.go.kr/go/ythip/getPlcy?${query}`), "온통청년");
    if (body.errorCode || body.errorMsg) throw new FetchError(`온통청년: ${String(body.errorMsg || body.errorCode)}`);
    const rows = findRows(body, "plcyNo");
    for (const row of rows) {
      const category = `${text(row.lclsfNm)} ${text(row.mclsfNm)}`;
      if (!/(일자리|교육|취업|창업|장학)/.test(category)) continue;
      if (LOCAL_GOVERNMENT.test(text(row.sprvsnInstCdNm))) continue;
      // 신청 기간은 "20261001 ~ 20261031" 형태다. 끝 날짜를 마감으로 쓴다.
      const dates = [...String(row.aplyYmd ?? "").matchAll(/(\d{4})[.-]?(\d{2})[.-]?(\d{2})/g)]
        .map((match) => validDate(Number(match[1]), Number(match[2]), Number(match[3])))
        .filter((date): date is string => date !== null);
      const date = dates.at(-1) ?? null;
      const title = text(row.plcyNm, 200);
      if (!upcoming(date, today) || !title) continue;
      items.push({
        externalId: String(row.plcyNo),
        kind: /장학/.test(`${title} ${category}`) ? "scholarship" : /일자리|채용|인턴/.test(`${title} ${category}`) ? "job" : "career",
        title,
        organization: text(row.sprvsnInstCdNm, 120),
        date,
        time: null,
        url: absoluteUrl(row.aplyUrlAddr) || absoluteUrl(row.refUrlAddr1) || `https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/${encodeURIComponent(String(row.plcyNo))}`,
        summary: [
          field("분류", category), field("정책 설명", row.plcyExplnCn), field("지원 내용", row.plcySprtCn),
          row.sprtTrgtMinAge || row.sprtTrgtMaxAge ? `대상 연령: ${text(row.sprtTrgtMinAge) || "?"}~${text(row.sprtTrgtMaxAge) || "?"}세` : "",
          field("신청 기간", row.aplyYmd),
        ].filter(Boolean).join("\n").slice(0, 3000),
        documents: lines(row.sbmsnDcmntCn),
        dateNote: "온통청년 정책의 신청 기간 종료일입니다.",
      });
    }
    if (rows.length < 100) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// 공공기관 채용정보 (잡알리오, 공공데이터포털)

export async function fetchAlio({ fetcher, today }: ProviderContext): Promise<ImportedItem[]> {
  const key = providerKey("alio");
  const items: ImportedItem[] = [];
  for (let page = 1; page <= 5; page++) {
    const body = parseJson(await fetcher(`https://apis.data.go.kr/1051000/recruitment/list?serviceKey=${encodeURIComponent(key)}&numOfRows=100&pageNo=${page}&resultType=json&ongoingYn=Y`), "공공기관 채용정보");
    if (body.resultCode !== undefined && String(body.resultCode) !== "200") {
      throw new FetchError(`공공기관 채용정보: ${String(body.resultMsg || "요청에 실패했습니다.")}`);
    }
    const rows = findRows(body, "recrutPbancTtl");
    for (const row of rows) {
      const { date } = parseLooseDate(row.pbancEndYmd);
      const title = text(row.recrutPbancTtl, 200);
      // 경력직 전용 공고는 학생 대상이 아니다.
      if (!upcoming(date, today) || !title || /^경력$/.test(text(row.recrutSeNm))) continue;
      items.push({
        externalId: String(row.recrutPblntSn || hash(String(row.instNm), title)),
        kind: "job",
        title,
        organization: text(row.instNm, 120),
        date,
        time: null,
        url: absoluteUrl(row.srcUrl),
        summary: [
          field("채용 구분", row.recrutSeNm), field("고용 형태", row.hireTypeNmLst), field("근무지", row.workRgnNmLst),
          field("직무(NCS)", row.ncsCdNmLst), field("학력", row.acbgCondNmLst), field("모집 인원", row.recrutNope),
          field("지원 자격", row.aplyQlfcCn), field("우대 사항", row.prefCn),
        ].filter(Boolean).join("\n").slice(0, 3000),
        documents: [],
        dateNote: "공공기관 채용정보의 공고 종료일입니다. 접수 마감 시각은 원문 공고에서 확인해 주세요.",
      });
    }
    if (rows.length < 100) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// 고용24 채용정보 (신입)

function xmlTag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim() : "";
}

/** 고용24 마감일은 "26-10-31", "채용시까지 26-10-31", "20261031" 형태로 온다. */
export function parseWork24Date(value: string): string | null {
  const match = value.match(/(\d{2,4})-?(\d{2})-?(\d{2})(?!\d)/);
  if (!match) return null;
  const year = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
  return validDate(year, Number(match[2]), Number(match[3]));
}

export async function fetchWork24({ fetcher, today, profile }: ProviderContext): Promise<ImportedItem[]> {
  const key = providerKey("work24");
  const keywords = profileTerms(profile).filter((term) => !term.endsWith("계열")).slice(0, 3);
  const items = new Map<string, ImportedItem>();
  for (const keyword of keywords.length ? keywords : [""]) {
    const query = new URLSearchParams({ authKey: key, callTp: "L", returnType: "XML", startPage: "1", display: "100", career: "N", ...(keyword ? { keyword } : {}) });
    const xml = await fetcher(`https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do?${query}`);
    const error = xmlTag(xml, "error") || xmlTag(xml, "messageCd");
    if (error && !/<wanted>/.test(xml)) throw new FetchError(`고용24: ${error}`);
    for (const [, block] of xml.matchAll(/<wanted>([\s\S]*?)<\/wanted>/g)) {
      const id = xmlTag(block, "wantedAuthNo");
      const date = parseWork24Date(xmlTag(block, "closeDt"));
      const title = text(xmlTag(block, "title"), 200);
      if (!id || !title || !upcoming(date, today)) continue;
      items.set(id, {
        externalId: id,
        kind: "job",
        title,
        organization: text(xmlTag(block, "company"), 120),
        date,
        time: null,
        url: absoluteUrl(xmlTag(block, "wantedInfoUrl")),
        summary: [
          field("근무지", xmlTag(block, "region")), field("경력", xmlTag(block, "career")), field("학력", xmlTag(block, "minEdubg")),
          field("급여", `${xmlTag(block, "salTpNm")} ${xmlTag(block, "sal")}`), field("근무 형태", xmlTag(block, "holidayTpNm")),
        ].filter(Boolean).join("\n"),
        documents: [],
        dateNote: "고용24 채용정보의 마감일입니다.",
      });
    }
  }
  return [...items.values()];
}

// ---------------------------------------------------------------------------
// 사람인 채용 공고

export async function fetchSaramin({ fetcher, today, profile }: ProviderContext): Promise<ImportedItem[]> {
  const key = providerKey("saramin");
  const keywords = profileTerms(profile).filter((term) => !term.endsWith("계열")).slice(0, 3);
  const items = new Map<string, ImportedItem>();
  for (const keyword of keywords.length ? keywords : ["신입", "인턴"]) {
    const query = new URLSearchParams({ "access-key": key, keywords: keyword, count: "110", fields: "expiration-date", sort: "pd" });
    const body = parseJson(await fetcher(`https://oapi.saramin.co.kr/job-search?${query}`), "사람인");
    if (body.code || body.message) throw new FetchError(`사람인: ${String(body.message || body.code)}`);
    for (const job of findRows(body, "position")) {
      const position = (job.position || {}) as Record<string, Record<string, unknown> | string>;
      const experience = (position["experience-level"] || {}) as Record<string, unknown>;
      const closeType = (job["close-type"] || {}) as Record<string, unknown>;
      // 경력 전용 공고와 마감일이 없는 상시·채용시 마감 공고는 일정으로 만들지 않는다.
      if (String(experience.code) === "2" || String(closeType.code || "1") !== "1") continue;
      const timestamp = Number(job["expiration-timestamp"]);
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
      const seoul = new Date(timestamp * 1000 + 9 * 3600_000).toISOString();
      const date = seoul.slice(0, 10);
      const title = text(position.title, 200);
      if (!title || !upcoming(date, today)) continue;
      const company = ((job.company as Record<string, Record<string, unknown>> | undefined)?.detail || {}) as Record<string, unknown>;
      const name = (value: unknown) => (value && typeof value === "object" ? text((value as Record<string, unknown>).name) : "");
      items.set(String(job.id), {
        externalId: String(job.id),
        kind: "job",
        title,
        organization: text(company.name, 120),
        date,
        time: seoul.slice(11, 16) === "23:59" || seoul.slice(11, 16) === "00:00" ? null : seoul.slice(11, 16),
        url: absoluteUrl(job.url),
        summary: [
          field("근무지", name(position.location)), field("고용 형태", name(position["job-type"])), field("경력", experience.name),
          field("학력", name(position["required-education-level"])), field("직무 키워드", job.keyword),
        ].filter(Boolean).join("\n"),
        documents: [],
        dateNote: "사람인 공고의 접수 마감일입니다.",
      });
    }
  }
  return [...items.values()];
}

// ---------------------------------------------------------------------------
// 국가기술자격 시험일정 (한국산업인력공단, 공공데이터포털)

export async function fetchQnet({ fetcher, today }: ProviderContext): Promise<ImportedItem[]> {
  const key = providerKey("qnet");
  const year = Number(today.slice(0, 4));
  const items: ImportedItem[] = [];
  for (const implYy of [year, year + 1]) {
    const query = new URLSearchParams({ serviceKey: key, numOfRows: "50", pageNo: "1", dataFormat: "json", implYy: String(implYy), qualgbCd: "T" });
    const body = parseJson(await fetcher(`https://apis.data.go.kr/B490007/qualExamSchd/getQualExamSchdList?${query}`), "국가자격 시험일정");
    const header = findRows(body, "resultCode")[0];
    if (header && !["00", "0", "200"].includes(String(header.resultCode))) {
      // 다음 해 일정이 아직 없으면 오류 대신 빈 결과를 준다.
      if (implYy !== year) continue;
      throw new FetchError(`국가자격 시험일정: ${String(header.resultMsg || header.resultCode)}`);
    }
    for (const row of findRows(body, "docRegEndDt")) {
      const name = text(row.description, 200);
      // 학생이 주로 응시하는 기사·산업기사 회차만 가져온다.
      if (!/기사/.test(name) || /기능사|기능장|기술사/.test(name)) continue;
      const schedule = [
        field("필기 원서접수", `${text(row.docRegStartDt)} ~ ${text(row.docRegEndDt)}`), field("필기 시험", row.docExamStartDt), field("필기 합격 발표", row.docPassDt),
        field("실기 원서접수", `${text(row.pracRegStartDt)} ~ ${text(row.pracRegEndDt)}`), field("실기 시험", row.pracExamStartDt), field("최종 발표", row.pracPassDt),
      ].filter(Boolean).join("\n");
      for (const [stage, end] of [["필기", row.docRegEndDt], ["실기", row.pracRegEndDt]] as const) {
        const { date } = parseLooseDate(end);
        if (!upcoming(date, today)) continue;
        items.push({
          externalId: hash(name, String(row.implSeq ?? ""), stage, String(implYy)),
          kind: "career",
          title: `${name} ${stage} 원서접수 마감`,
          organization: "한국산업인력공단 (Q-Net)",
          date,
          time: "18:00",
          url: "https://www.q-net.or.kr/rcv001.do?id=rcv00103",
          summary: schedule,
          documents: [],
          dateNote: "Q-Net 원서접수 마감은 보통 마지막 날 18시입니다. 종목별 일정은 Q-Net에서 확인해 주세요.",
        });
      }
    }
  }
  return items;
}

export const FETCHERS: Record<ProviderType, (context: ProviderContext) => Promise<ImportedItem[]>> = {
  kosaf: fetchKosaf,
  gov24: fetchGov24,
  youth: fetchYouth,
  alio: fetchAlio,
  work24: fetchWork24,
  saramin: fetchSaramin,
  qnet: fetchQnet,
};
