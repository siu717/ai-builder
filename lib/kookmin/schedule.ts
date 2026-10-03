import type { KookminScheduleItem } from "../contracts";
import { RouteError } from "../http";
import { fetchText, KMU_ORIGIN, TtlCache } from "./http";
import { formatDate, inlineText, isValidDate, seoulParts, slug } from "./text";

export const SCHEDULE_URL = `${KMU_ORIGIN}/user/scGuid/scSchedule/index.do`;
const SCHEDULE_ERROR = "국민대 학사일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
const SCHEDULE_TTL_MS = 10 * 60 * 1000;

export interface ScheduleResponse {
  items: KookminScheduleItem[];
  year: number;
  fetchedAt: string;
  cached: boolean;
}

/** 학년도는 3월에 시작한다. 서울 기준 1~2월은 전년도 학년도에 속한다. */
export function seoulAcademicYear(now = new Date()): number {
  const { year, month } = seoulParts(now);
  return month >= 3 ? year : year - 1;
}

/** 학사일정 페이지는 `yyyy` 파라미터로 학년도를 고른다(2026-10-03 실제 페이지에서 확인). */
export function scheduleUrl(year: number): string {
  return `${SCHEDULE_URL}?yyyy=${year}`;
}

export function detectAcademicYear(html: string): number | null {
  const heading = /class="[^"]*accd_head[^"]*"[^>]*>\s*(?:<em>)?\s*(\d{4})\s*(?:<\/em>)?\s*학년도/i.exec(html);
  const hidden = /<input\b[^>]*name=["']yyyy["'][^>]*value=["'](\d{4})["']/i.exec(html)
    || /<input\b[^>]*value=["'](\d{4})["'][^>]*name=["']yyyy["']/i.exec(html);
  const value = Number(heading?.[1] ?? hidden?.[1]);
  return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
}

// `03.03 (화) ~ 03.09 (월)`, `03.03 (화)`, `2027.01.04 ~ 2027.01.22`를 모두 받는다.
const ONE_DATE = String.raw`(?:(\d{4})\s*[.\-/]\s*)?(\d{1,2})\s*[./]\s*(\d{1,2})\.?(?:\s*\([^)]*\))?`;
const DATE_RANGE = new RegExp(`${ONE_DATE}(?:\\s*[~∼～\\-–—]\\s*${ONE_DATE})?`);

/**
 * 학사일정 표를 일정 목록으로 바꾼다.
 * 표에는 연도가 없으므로 3~12월은 학년도, 1~2월은 학년도 다음 해로 본다.
 * 월 칸에 `2027년`처럼 연도가 적혀 있으면 그 값을 우선한다.
 */
export function parseSchedule(html: string, academicYear: number, source = scheduleUrl(academicYear)): KookminScheduleItem[] {
  const table = /<table\b[^>]*id=["']monthTable["'][^>]*>([\s\S]*?)<\/table\s*>/i.exec(html)?.[1] ?? html;
  const items: KookminScheduleItem[] = [];
  const seen = new Set<string>();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]\s*>/gi)].map((cell) => ({ attrs: cell[1], text: inlineText(cell[2]) }));
    if (cells.length < 2) continue;
    const described = cells.findIndex((cell) => /cal_desc/i.test(cell.attrs));
    const titleIndex = described >= 0 ? described : cells.length - 1;
    const title = cells[titleIndex].text;
    if (!title) continue;

    let range: RegExpExecArray | null = null;
    let labelled: { year: number; month: number | null } | null = null;
    for (let index = 0; index < cells.length; index++) {
      if (index === titleIndex) continue;
      const match: RegExpExecArray | null = range ? null : DATE_RANGE.exec(cells[index].text);
      if (match) {
        range = match;
        continue;
      }
      const label = /(\d{4})\s*년(?:\s*(\d{1,2})\s*월?)?/.exec(cells[index].text);
      if (label) labelled = { year: Number(label[1]), month: label[2] ? Number(label[2]) : null };
    }
    if (!range) continue;

    const startMonth = Number(range[2]);
    const startDay = Number(range[3]);
    let startYear = startMonth >= 3 ? academicYear : academicYear + 1;
    if (range[1]) startYear = Number(range[1]);
    // 월 칸의 연도는 그 칸의 달 기준이다. 전년도 12월에 시작해 넘어온 일정이면 한 해를 뺀다.
    else if (labelled) startYear = labelled.month !== null && startMonth > labelled.month ? labelled.year - 1 : labelled.year;

    const hasEnd = range[5] !== undefined;
    const endMonth = hasEnd ? Number(range[5]) : startMonth;
    const endDay = hasEnd ? Number(range[6]) : startDay;
    const endYear = range[4] ? Number(range[4]) : hasEnd && endMonth < startMonth ? startYear + 1 : startYear;
    if (!isValidDate(startYear, startMonth, startDay) || !isValidDate(endYear, endMonth, endDay)) continue;

    const startDate = formatDate(startYear, startMonth, startDay);
    const end = formatDate(endYear, endMonth, endDay);
    const endDate = end < startDate ? startDate : end;
    const id = `kmu-sched-${academicYear}-${startDate}-${slug(title)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, title, startDate, endDate, year: academicYear, source });
  }
  return items;
}

const cache = new TtlCache<Omit<ScheduleResponse, "cached">>(SCHEDULE_TTL_MS, 20);

export function clearScheduleCache(): void {
  cache.clear();
}

export interface ScheduleOptions {
  year?: number;
  now?: Date;
  fetcher?: typeof fetch;
}

/** 학년도 학사일정을 읽는다. 10분 동안 메모리에 두고, 원본 장애 때는 마지막으로 읽은 값을 돌려준다. */
export async function getSchedule(options: ScheduleOptions = {}): Promise<ScheduleResponse> {
  const now = options.now ?? new Date();
  const requested = options.year ?? seoulAcademicYear(now);
  const key = String(requested);
  const hit = cache.fresh(key, now.getTime());
  if (hit) return { ...hit, cached: true };
  try {
    const page = await fetchText(scheduleUrl(requested), { fetcher: options.fetcher });
    const year = detectAcademicYear(page.text) ?? requested;
    const items = parseSchedule(page.text, year, scheduleUrl(year));
    // 표 자체가 없으면 페이지 구조가 바뀐 것이다. 빈 일정으로 보여 주지 않는다.
    if (!items.length && !/monthTable|cal_desc/.test(page.text)) throw new Error("schedule layout changed");
    const value = { items, year, fetchedAt: now.toISOString() };
    cache.set(key, value, now.getTime());
    return { ...value, cached: false };
  } catch {
    const stale = cache.stale(key);
    if (stale) return { ...stale, cached: true };
    throw new RouteError(502, SCHEDULE_ERROR);
  }
}
