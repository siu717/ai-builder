// API 키가 있어야 동작하는 소스. 키가 없으면 MissingKeyError를 던지고, index가 "API 키가 설정되지 않았습니다"로 돌려준다.
// 키는 요청 주소에만 쓰고, 클라이언트로 돌려주는 값(url 등)이나 오류 메시지에는 넣지 않는다.
import type { LiveOpportunity } from "../contracts";
import { decodeEntities, stableHash } from "../kookmin/text";
import { fromEpoch, normalizeDate } from "./deadline";
import { getJson, getText, httpUrl, list, record, str } from "./http";
import { envValue, liveItem, requireKey, type OpportunitySource } from "./types";

/** 응답에 들어 있는 주소에서 인증 키로 보이는 쿼리 값을 지운다. */
function withoutKeys(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    for (const name of [...parsed.searchParams.keys()]) if (/key|token|auth/i.test(name)) parsed.searchParams.delete(name);
    return parsed.toString();
  } catch {
    return "";
  }
}

// ── 사람인 채용 API (SARAMIN_API_KEY) ──────────────────────────────────────
export function parseSaramin(payload: unknown): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const entry of list(record(record(payload).jobs).job)) {
    const job = record(entry);
    const position = record(job.position);
    const id = str(job.id);
    const title = str(position.title);
    if (!id || !title || (job.active !== undefined && String(job.active) === "0")) continue;
    const name = (value: unknown) => str(record(value).name);
    const closing = fromEpoch(job["expiration-timestamp"]);
    const closeDate = closing?.date ?? normalizeDate(str(job["expiration-date"]));
    // 사람인은 상시·채용시 마감 공고에도 먼 미래의 만료일을 넣는다. close-type 1(접수마감일)만 마감일로 쓴다.
    const closeType = str(record(job["close-type"]).code);
    const dated = !closeType || closeType === "1";
    items.push(liveItem({
      sourceId: "saramin", sourceName: "사람인", kind: "job", externalId: id,
      title,
      organization: name(record(job.company).detail) || "회사명 확인 필요",
      description: [name(position["job-mid-code"]), name(position.location).replace(/&gt;/g, ">"), name(position["experience-level"]), name(position["required-education-level"]), str(job.keyword)].filter(Boolean).join(" · "),
      date: dated ? closeDate : null,
      time: dated && closing ? closing.time : null,
      postedAt: fromEpoch(job["posting-timestamp"])?.date ?? normalizeDate(str(job["posting-date"])),
      tags: [name(position["job-type"]), name(position["experience-level"]), ...name(position["job-code"]).split(",").slice(0, 2)],
      url: withoutKeys(httpUrl(job.url)).replace(/^http:/, "https:") || `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${encodeURIComponent(id)}`,
    }));
  }
  return items;
}

export const saraminSource: OpportunitySource = {
  id: "saramin", name: "사람인", kind: "job", requiresKey: "SARAMIN_API_KEY", nativeQuery: true,
  async fetch(ctx) {
    const key = requireKey(ctx, "SARAMIN_API_KEY");
    // job_type 4 = 인턴직, 1 = 정규직. 검색어가 없으면 최근 등록순 전체를 받는다.
    const params = new URLSearchParams({ "access-key": key, job_type: "1,4", count: "40", sort: "pd" });
    if (ctx.query) params.set("keywords", ctx.query);
    return parseSaramin(await getJson(`https://oapi.saramin.co.kr/job-search?${params}`, ctx));
  },
};

// ── 고용24(워크넷) 채용정보 OpenAPI (WORK24_API_KEY) ───────────────────────
function xmlValue(block: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!match) return "";
  return decodeEntities(match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).replace(/\s+/g, " ").trim();
}

export function parseWork24(xml: string): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const match of xml.matchAll(/<wanted>([\s\S]*?)<\/wanted>/gi)) {
    const block = match[1];
    const id = xmlValue(block, "wantedAuthNo");
    const title = xmlValue(block, "title");
    if (!id || !title) continue;
    const closing = xmlValue(block, "closeDt"); // `26-10-31` 또는 `채용시까지 26-10-31`
    const url = withoutKeys(httpUrl(xmlValue(block, "wantedInfoUrl")));
    items.push(liveItem({
      sourceId: "work24", sourceName: "고용24", kind: "job", externalId: id,
      title,
      organization: xmlValue(block, "company") || "회사명 확인 필요",
      description: [xmlValue(block, "region"), xmlValue(block, "career"), xmlValue(block, "minEdubg"), [xmlValue(block, "salTpNm"), xmlValue(block, "sal")].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
      date: normalizeDate(closing),
      postedAt: normalizeDate(xmlValue(block, "regDt")),
      tags: [xmlValue(block, "career"), xmlValue(block, "region").split(" ")[0], xmlValue(block, "holidayTpNm")],
      url: url || `https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${encodeURIComponent(id)}&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet`,
    }));
  }
  return items;
}

export const work24Source: OpportunitySource = {
  id: "work24", name: "고용24", kind: "job", requiresKey: "WORK24_API_KEY", nativeQuery: true,
  async fetch(ctx) {
    const key = requireKey(ctx, "WORK24_API_KEY");
    // career=N: 신입. 응답은 XML만 지원한다.
    const params = new URLSearchParams({ authKey: key, callTp: "L", returnType: "XML", startPage: "1", display: "40", career: "N" });
    if (ctx.query) params.set("keyword", ctx.query);
    const base = envValue(ctx, "WORK24_API_URL") || "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do";
    const xml = await getText(`${base}?${params}`, ctx, "application/xml,text/xml");
    if (!/<wantedRoot[\s>]/i.test(xml)) throw new Error("work24 error response");
    return parseWork24(xml);
  },
};

// ── 공공데이터포털: 한국장학재단 학자금지원정보(대학생) (DATA_GO_KR_SERVICE_KEY) ──
// 데이터셋 15028252. 파일 버전이 바뀌면 uddi가 달라지므로 KOSAF_API_URL로 바꿀 수 있다.
export const KOSAF_API_DEFAULT_URL = "https://api.odcloud.kr/api/15028252/v1/uddi:8678d609-2cc1-4c28-bf49-f5f77a43a2f2";

export function parseKosafApi(payload: unknown): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const entry of list(record(payload).data)) {
    const row = record(entry);
    // 열 이름이 `성적기준 상세내용`/`성적기준상세내용`처럼 버전마다 달라 공백을 지우고 찾는다.
    const fields = new Map(Object.entries(row).map(([name, value]) => [name.replace(/\s+/g, ""), str(value)]));
    const get = (...names: string[]) => names.map((name) => fields.get(name) || "").find((value) => value && value !== "해당없음") || "";
    const title = get("상품명", "장학금명");
    if (!title) continue;
    const organization = get("운영기관명", "기관명");
    const detail = [
      ["지원", get("지원내역상세내용", "지원내역")],
      ["성적", get("성적기준상세내용", "성적기준")],
      ["소득", get("소득기준상세내용", "소득기준")],
      ["자격", get("특정자격상세내용", "특정자격")],
    ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(" / ");
    items.push(liveItem({
      sourceId: "kosaf-api", sourceName: "한국장학재단(공공데이터)", kind: "scholarship",
      externalId: get("번호") || stableHash(`${organization}|${title}|${get("모집시작일")}`),
      title, organization: organization || "운영기관 확인 필요", description: detail,
      date: normalizeDate(get("모집종료일")), postedAt: normalizeDate(get("모집시작일")),
      tags: [get("학자금유형구분"), get("상품구분"), get("운영기관구분"), get("학년구분")].map((tag) => (tag.length > 14 ? "" : tag)),
      url: httpUrl(get("홈페이지주소", "홈페이지")) || "https://www.kosaf.go.kr/ko/scholar.do?pg=scholarship_main",
    }));
  }
  return items;
}

export const kosafApiSource: OpportunitySource = {
  id: "kosaf-api", name: "한국장학재단(공공데이터)", kind: "scholarship", requiresKey: "DATA_GO_KR_SERVICE_KEY",
  async fetch(ctx) {
    const key = requireKey(ctx, "DATA_GO_KR_SERVICE_KEY");
    const base = envValue(ctx, "KOSAF_API_URL") || KOSAF_API_DEFAULT_URL;
    // 포털은 Encoding 키(%가 들어 있음)와 Decoding 키를 함께 준다. 이미 인코딩된 키는 다시 인코딩하지 않는다.
    const serviceKey = /%[0-9a-f]{2}/i.test(key) ? key : encodeURIComponent(key);
    return parseKosafApi(await getJson(`${base}${base.includes("?") ? "&" : "?"}page=1&perPage=300&returnType=JSON&serviceKey=${serviceKey}`, ctx));
  },
};

// ── 온통청년 청년정책 OpenAPI (YOUTHCENTER_API_KEY) ────────────────────────
export function parseYouthcenter(payload: unknown): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  const result = record(record(payload).result);
  for (const entry of list(result.youthPolicyList)) {
    const row = record(entry);
    const id = str(row.plcyNo);
    const title = str(row.plcyNm);
    if (!id || !title) continue;
    // aplyYmd: `20260901 ~ 20261031`. 여러 구간이면 마지막 종료일을 쓴다. 비어 있으면 상시·별도 공지.
    const periods = [...str(row.aplyYmd).matchAll(/(\d{8})\s*~\s*(\d{8})/g)];
    const last = periods[periods.length - 1];
    items.push(liveItem({
      sourceId: "youthcenter", sourceName: "온통청년", kind: "scholarship", externalId: id,
      title,
      organization: str(row.sprvsnInstCdNm) || str(row.operInstCdNm) || "주관기관 확인 필요",
      description: [str(row.plcyExplnCn), str(row.plcySprtCn)].filter(Boolean).join(" / "),
      date: last ? normalizeDate(last[2]) : null,
      postedAt: normalizeDate(str(row.frstRegDt)),
      tags: ["청년정책", str(row.lclsfNm), str(row.mclsfNm), ...str(row.plcyKywdNm).split(",").slice(0, 2)],
      url: `https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/${encodeURIComponent(id)}`,
    }));
  }
  return items;
}

export const youthcenterSource: OpportunitySource = {
  id: "youthcenter", name: "온통청년", kind: "scholarship", requiresKey: "YOUTHCENTER_API_KEY", nativeQuery: true,
  async fetch(ctx) {
    const key = requireKey(ctx, "YOUTHCENTER_API_KEY");
    const params = new URLSearchParams({ apiKeyNm: key, pageNum: "1", pageSize: "40", rtnType: "json" });
    // 검색어가 없으면 대학생에게 가까운 `장학` 정책을 먼저 받는다.
    params.set("plcyNm", ctx.query || "장학");
    const base = envValue(ctx, "YOUTHCENTER_API_URL") || "https://www.youthcenter.go.kr/go/ythip/getPlcy";
    return parseYouthcenter(await getJson(`${base}?${params}`, ctx));
  },
};
