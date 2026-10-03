import { createHash } from "node:crypto";
import { addCalendarDays, seoulToday } from "./catalog";
import type { ImportKind } from "./contracts";

export type { ImportKind };

/** 수집원에서 가져온 일정 후보. date가 null이면 사용자가 마감을 확인해야 한다. */
export interface ImportedItem {
  externalId: string;
  kind: ImportKind;
  title: string;
  organization: string;
  date: string | null;
  time: string | null;
  url: string;
  summary: string;
  documents: string[];
  dateNote: string | null;
}

const LOOKAHEAD_DAYS = 365;

export function hash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

export function clean(text: string, max = 2000): string {
  // RSS 설명은 HTML을 한 번 더 이스케이프해서 담는 경우가 많다.
  const html = /&lt;\/?[a-z]/i.test(text) ? text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&") : text;
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&middot;/g, "·").replace(/&[lr]squo;/g, "'").replace(/&[lr]dquo;/g, "\"")
    .replace(/&(?!amp;)[a-z]+;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, max);
}

export function validDate(year: number, month: number, day: number): string | null {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

/** 지금부터 1년 안의 마감만 일정 후보로 둔다. */
export function upcoming(date: string | null, today: string): boolean {
  return date !== null && date >= today && date <= addCalendarDays(today, LOOKAHEAD_DAYS);
}

/** "2026.10.08", "20261008", "2026-10-08 18:00:00" 같은 공공데이터 날짜를 읽는다. */
export function parseLooseDate(value: unknown): { date: string | null; time: string | null } {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})일?(?:[\sT]+(\d{1,2}):(\d{2}))?/);
  if (!match) return { date: null, time: null };
  const date = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  const time = date && match[4] && Number(match[4]) < 24 && !(match[4] === "00" && match[5] === "00")
    ? `${match[4].padStart(2, "0")}:${match[5]}`
    : null;
  return { date, time };
}

// ---------------------------------------------------------------------------
// 한국어 공지 본문에서 마감일 추출

interface DateHit { date: string; time: string | null; index: number; end: number; score: number }

const APPLY_WORDS = /(신청|접수|모집|마감|제출|지원|기한|응모|등록)/;
const OTHER_WORDS = /(운영|활동|교육|행사|일시|발표|결과|면접|시험|합격|강의|진행|개최|게시일|작성일|등록일)/;

/**
 * 공지 텍스트에서 마감 후보를 찾는다. 날짜 앞의 이름표("신청기간", "운영기간")로 점수를 매기고,
 * 기간("10.1 ~ 10.15")의 끝 날짜는 시작 날짜의 이름표를 이어받는다. 같은 점수면 가장 이른 날짜를 고른다.
 * 연도가 없는 날짜는 게시일을 기준으로 연도를 정한다.
 */
export function extractDeadline(text: string, reference: string): { date: string; time: string | null } | null {
  const [refYear, refMonth] = reference.split("-").map(Number);
  const hits: DateHit[] = [];
  let previousLabel = "";
  const pattern = /(?:(\d{4})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\.?(?:\s*\(\s*[월화수목금토일]\s*\))?(?:\s*(?:\(?\s*(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?:\s*(\d{2})\s*분)?)\)?))?/g;
  for (const match of text.matchAll(pattern)) {
    const before = text[match.index - 1];
    if (before && /\d/.test(before)) continue;
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) continue;
    let year = match[1] ? Number(match[1]) : refYear;
    // 12월 공지의 "1월 10일"은 다음 해를 뜻한다.
    if (!match[1] && month < refMonth - 6) year += 1;
    const date = validDate(year, month, day);
    if (!date) continue;
    let time: string | null = null;
    if (match[5] !== undefined) {
      let hour = Number(match[5]);
      if (match[4] === "오후" && hour < 12) hour += 12;
      if (match[4] === "오전" && hour === 12) hour = 0;
      const minute = match[6] ?? match[7] ?? "00";
      if (hour < 24 && Number(minute) < 60) time = `${String(hour).padStart(2, "0")}:${minute}`;
    }
    const end = match.index + match[0].length;
    const previousEnd = hits.length ? hits[hits.length - 1].end : 0;
    const gap = text.slice(Math.max(previousEnd, match.index - 30), match.index);
    const rangeEnd = hits.length > 0 && /^[\s.]*[~∼～-]\s*$/.test(text.slice(previousEnd, match.index));
    const label = rangeEnd ? previousLabel : gap;
    previousLabel = label;
    const after = text.slice(end, end + 10);
    let score = 0;
    if (APPLY_WORDS.test(label)) score += 3;
    if (OTHER_WORDS.test(label) && !/(마감|신청|접수|모집)/.test(label)) score -= 3;
    if (/^\s*\)?\s*(까지|마감)/.test(after)) score += 3;
    if (rangeEnd || /[~∼～]\s*$/.test(gap)) score += 1;
    hits.push({ date, time, index: match.index, end, score });
  }
  const candidates = hits.filter((hit) => hit.date >= reference);
  if (!candidates.length) return null;
  const chosen = candidates.reduce((best, hit) => hit.score > best.score || (hit.score === best.score && hit.date < best.date) ? hit : best);
  // 신청과 관련된 표현이 하나도 없으면 행사 날짜일 수 있으므로 기간의 끝이나 단독 날짜만 인정한다.
  if (chosen.score < 0) return null;
  return { date: chosen.date, time: chosen.time };
}

// ---------------------------------------------------------------------------
// RSS·Atom (학교·학과 공지 게시판)

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return "";
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function feedDate(value: string, fallback: string): string {
  const parsed = new Date(value.trim());
  if (value.trim() && Number.isFinite(parsed.getTime())) return seoulToday(parsed);
  return parseLooseDate(value).date || fallback;
}

export function parseFeed(text: string, kind: ImportKind, today: string): ImportedItem[] {
  const blocks = [...text.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  const channel = clean(tag(text.replace(/<(item|entry)[\s\S]*$/i, ""), "title"), 120);
  const items: ImportedItem[] = [];
  for (const block of blocks.slice(0, 200)) {
    const title = clean(tag(block, "title"), 200);
    if (!title) continue;
    const link = clean(tag(block, "link"), 2000) || block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const body = clean(tag(block, "description") || tag(block, "content:encoded") || tag(block, "summary") || tag(block, "content"));
    const published = feedDate(tag(block, "pubDate") || tag(block, "dc:date") || tag(block, "published") || tag(block, "updated"), today);
    const deadline = extractDeadline(`${title}\n${body}`, published);
    // 이미 지난 마감과 오래된 공지는 후보에서 뺀다.
    if (deadline && !upcoming(deadline.date, today)) continue;
    if (!deadline && published < addCalendarDays(today, -30)) continue;
    items.push({
      externalId: hash(clean(tag(block, "guid"), 500) || link || title),
      kind,
      title,
      organization: channel,
      date: deadline?.date ?? null,
      time: deadline?.time ?? null,
      url: link,
      summary: body,
      documents: [],
      dateNote: deadline ? "공지 본문에서 찾은 날짜입니다. 원문에서 마감을 확인해 주세요." : "공지에서 마감 날짜를 찾지 못했습니다. 원문을 확인해 날짜를 입력해 주세요.",
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 공지 게시판 웹페이지 (RSS가 없는 학교 게시판)

export function isFeed(text: string): boolean {
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000));
}

/** 게시판 페이지에 RSS 주소가 연결되어 있으면 그 주소를 쓴다. */
export function discoverFeed(html: string, pageUrl: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const link = match[0];
    if (!/rel=["']?alternate/i.test(link) || !/type=["']application\/(rss|atom)\+xml/i.test(link) || /comment|댓글/i.test(link)) continue;
    const href = link.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) return new URL(href.replace(/&amp;/g, "&"), pageUrl).toString();
  }
  return null;
}

const POSTED = /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/;

/**
 * 게시판 목록의 행(tr·li)에서 제목 링크와 게시일을 읽는다. 게시일이 없는 행은 메뉴로 보고 건너뛴다.
 * 목록에는 본문이 없으므로 마감은 제목에 적힌 날짜만 찾는다.
 */
export function parseBoard(html: string, pageUrl: string, kind: ImportKind, today: string): ImportedItem[] {
  const page = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, "");
  const site = clean(page.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "", 120);
  const items: ImportedItem[] = [];
  const seen = new Set<string>();
  for (const row of page.matchAll(/<(tr|li)\b[^>]*>((?:(?!<\1\b)[\s\S])*?)<\/\1>/gi)) {
    const content = row[2];
    const anchors = [...content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    if (!anchors.length) continue;
    const titled = content.match(/<(?:p|span|strong|div|h\d)\b[^>]*class=["'][^"']*\b(?:title|subject|tit)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|strong|div|h\d)>/i);
    const best = anchors.map((anchor) => ({ attrs: anchor[1], text: clean(anchor[2], 300) }))
      .reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const title = clean(titled?.[1] || best.text, 200).replace(/\s+/g, " ").replace(/\s*(새글|새 글|NEW|new|N)$/, "").trim();
    if (title.length < 4) continue;
    const rest = clean(content.replace(titled?.[0] || "", " ").replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (link) => (titled ? link : " ")), 2000).replace(title, " ");
    const postedMatch = rest.match(POSTED);
    const posted = postedMatch ? validDate(Number(postedMatch[1]), Number(postedMatch[2]), Number(postedMatch[3])) : null;
    if (!posted || posted < addCalendarDays(today, -60)) continue;
    const href = best.attrs.match(/href=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
    let url = pageUrl;
    try {
      if (href && !/^(#|javascript:)/i.test(href)) url = new URL(href, pageUrl).toString();
    } catch { /* 잘못된 링크는 게시판 주소로 대신한다. */ }
    const key = url === pageUrl ? title : url;
    if (seen.has(key)) continue;
    seen.add(key);
    const deadline = extractDeadline(title, posted);
    if (deadline && !upcoming(deadline.date, today)) continue;
    if (!deadline && posted < addCalendarDays(today, -30)) continue;
    items.push({
      externalId: hash(url === pageUrl ? title : url),
      kind,
      title,
      organization: site,
      date: deadline?.date ?? null,
      time: deadline?.time ?? null,
      url,
      summary: `게시일: ${posted}`,
      documents: [],
      dateNote: deadline ? "공지 제목에서 찾은 날짜입니다. 원문에서 마감을 확인해 주세요." : "목록에서 마감 날짜를 찾지 못했습니다. 원문을 확인해 날짜를 입력해 주세요.",
    });
    if (items.length >= 100) break;
  }
  return items;
}

/**
 * 목록에 마감이 없는 공지는 본문 페이지에서 찾는다. 메뉴의 날짜를 피하려고 제목이 나온 뒤의 본문만 본다.
 */
export function deadlineFromDetail(html: string, item: ImportedItem, today: string): ImportedItem {
  const text = clean(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ""), 200_000);
  const head = item.title.slice(0, 20);
  const start = text.indexOf(head);
  const body = text.slice(start >= 0 ? start + item.title.length : 0).split(/(이전글|다음글|이전 글|다음 글|목록으로)/)[0].slice(0, 4000);
  const posted = item.summary.match(/게시일: (\d{4}-\d{2}-\d{2})/)?.[1] || today;
  const deadline = extractDeadline(body, posted);
  const summary = [item.summary, body.slice(0, 600)].filter(Boolean).join("\n");
  if (!deadline || !upcoming(deadline.date, today)) return { ...item, summary };
  return { ...item, summary, date: deadline.date, time: deadline.time, dateNote: "공지 본문에서 찾은 날짜입니다. 원문에서 마감을 확인해 주세요." };
}

/** 게시판 본문 일부에는 이웃 글 제목 같은 페이지 요소가 섞이므로, 게시판 공지는 제목만 비교한다. */
export function matchesKeywords(item: ImportedItem, keywords: string, titleOnly = false): boolean {
  const words = keywords.split(/[,\n]/).map((word) => word.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return true;
  const haystack = (titleOnly ? item.title : `${item.title} ${item.organization} ${item.summary}`).toLowerCase();
  return words.some((word) => haystack.includes(word));
}
