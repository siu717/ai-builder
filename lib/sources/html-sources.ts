// 로그인·키 없이 열리는 공개 목록 페이지(HTML)를 읽는 소스: 한국장학재단 공지, 드림스폰, 잡알리오.
import type { LiveOpportunity } from "../contracts";
import { addDays, decodeEntities, inlineText, seoulParts } from "../kookmin/text";
import { extractDeadline, normalizeDate } from "./deadline";
import { getText, getTextPlain } from "./http";
import { liveItem, type OpportunitySource } from "./types";

function rows(html: string): string[] {
  return html.split(/<tr\b/i).slice(1);
}

function cells(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((match) => match[1]);
}

// ── 한국장학재단 공지사항(장학금 분류) ─────────────────────────────────────
const KOSAF_LIST = "https://www.kosaf.go.kr/ko/notice.do?ctgrId1=0000000002";

export function parseKosafNotices(html: string): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const row of rows(html)) {
    const link = /<a\b[^>]*href=["']([^"']*mode=view[^"']*seqNo=(\d{1,12})[^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/i.exec(row);
    if (!link) continue;
    const title = inlineText(link[3]);
    if (!title) continue;
    const postedAt = normalizeDate(inlineText(/<td\b[^>]*class=["'][^"']*\bday\b[^"']*["'][^>]*>([\s\S]*?)<\/td/i.exec(row)?.[1] ?? ""));
    const deadline = extractDeadline(title, postedAt);
    items.push(liveItem({
      sourceId: "kosaf", sourceName: "한국장학재단 공지", kind: "scholarship", externalId: link[2],
      title, organization: "한국장학재단", description: "",
      date: deadline.date, time: deadline.time, postedAt, tags: ["국가장학"],
      url: `https://www.kosaf.go.kr/ko/notice.do?mode=view&ctgrId1=0000000002&seqNo=${link[2]}`,
    }));
  }
  return items;
}

export const kosafNoticeSource: OpportunitySource = {
  id: "kosaf", name: "한국장학재단 공지", kind: "scholarship",
  async fetch(ctx) {
    const items = parseKosafNotices(await getText(KOSAF_LIST, ctx));
    if (!items.length) throw new Error("kosaf layout changed");
    return items;
  },
};

// ── 드림스폰 장학금 목록 ───────────────────────────────────────────────────
const DREAMSPON_ORIGIN = "https://www.dreamspon.com";

/** 목록에는 마감일 대신 `D-5`만 있다. 사이트가 밝힌 남은 일수를 조회일(서울)에 더해 날짜로 바꾼다. */
export function parseDreamspon(html: string, today: string): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const row of rows(html)) {
    const link = /<a\b[^>]*href=["'](\/scholarship\/view\.html\?idx=(\d{1,12}))["'][^>]*>([\s\S]*?)<\/a\s*>/i.exec(row);
    if (!link) continue;
    const title = inlineText(link[3]);
    if (!title) continue;
    const tags = [...row.matchAll(/<span>\s*#([^<]{1,30})<\/span>/gi)].map((match) => decodeEntities(match[1]).trim());
    const organization = inlineText(cells(row).find((cell, index) => index > 0 && !/<span|<a\b/i.test(cell)) ?? "");
    const day = /class=["'][^"']*td_day[^"']*["'][^>]*>([\s\S]*?)<\/td/i.exec(row)?.[1] ?? "";
    const left = /D\s*-\s*(\d{1,3})(?!\d)/i.exec(inlineText(day));
    const date = left ? addDays(today, Number(left[1])) : /D\s*-\s*day/i.test(inlineText(day)) ? today : null;
    items.push(liveItem({
      sourceId: "dreamspon", sourceName: "드림스폰", kind: "scholarship", externalId: link[2],
      title, organization: organization || "운영기관 확인 필요",
      description: tags.length ? tags.map((tag) => `#${tag}`).join(" ") : "",
      date, tags, url: `${DREAMSPON_ORIGIN}${link[1]}`,
    }));
  }
  return items;
}

export const dreamsponSource: OpportunitySource = {
  id: "dreamspon", name: "드림스폰", kind: "scholarship",
  async fetch(ctx) {
    const today = seoulParts(ctx.now).date;
    const html = await getTextPlain(`${DREAMSPON_ORIGIN}/scholarship/list.html`, ctx);
    const items = parseDreamspon(html, today);
    if (!items.length) throw new Error("dreamspon layout changed");
    return items;
  },
};

// ── 잡알리오(공공기관 채용정보) ────────────────────────────────────────────
const ALIO_ORIGIN = "https://job.alio.go.kr";

export function parseAlio(html: string): LiveOpportunity[] {
  const items: LiveOpportunity[] = [];
  for (const row of rows(html)) {
    const link = /<a\b[^>]*href=["']\/recruitview\.do\?idx=(\d{1,12})["'][^>]*>([\s\S]*?)<\/a\s*>/i.exec(row);
    if (!link) continue;
    const title = inlineText(link[2]);
    const columns = cells(row).map((cell) => inlineText(cell));
    const at = columns.findIndex((cell) => cell === title || cell.includes(title));
    if (!title || at < 0) continue;
    // 제목 뒤로: 기관명, 근무지, 고용형태, 등록일, 마감일(+D-n), 상태
    const [organization = "", region = "", workType = "", posted = "", closing = ""] = columns.slice(at + 1);
    items.push(liveItem({
      sourceId: "alio", sourceName: "잡알리오(공공기관)", kind: "job", externalId: link[1],
      title, organization: organization || "기관명 확인 필요",
      description: [region, workType].filter(Boolean).join(" · "),
      date: normalizeDate(closing), postedAt: normalizeDate(posted),
      tags: ["공공기관", workType, region],
      url: `${ALIO_ORIGIN}/recruitview.do?idx=${link[1]}`,
    }));
  }
  return items;
}

export const alioSource: OpportunitySource = {
  id: "alio", name: "잡알리오(공공기관)", kind: "job",
  async fetch(ctx) {
    const items = parseAlio(await getText(`${ALIO_ORIGIN}/recruit.do`, ctx));
    if (!items.length) throw new Error("alio layout changed");
    return items;
  },
};
