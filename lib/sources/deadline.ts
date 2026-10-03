import { formatDate, isValidDate, pad2, seoulParts } from "../kookmin/text";

export interface Deadline {
  date: string | null;
  time: string | null;
}

const NONE: Deadline = { date: null, time: null };
const DATE = String.raw`(?:(\d{4})\s*(?:[.\-/]|년)\s*)?(?<!\d)(\d{1,2})\s*(?:[./]|월)\s*(\d{1,2})(?!\d)\s*(?:일|\.)?`;
const WEEKDAY = String.raw`(?:\s*\(\s*[월화수목금토일]\s*\))?`;
const TIME = String.raw`(?:\s*(오전|오후|낮|밤)?\s*(\d{1,2})\s*(?:시(?:\s*(\d{1,2})\s*분)?|:\s*(\d{2})))?`;
// `10월 20일까지`, `10/20(월) 18시까지`
const UNTIL = new RegExp(String.raw`${DATE}${WEEKDAY}${TIME}\s*까지`, "g");
// `~10/18`, `(~10/7 오전 11시)`, `~ 2026.10.20`
const TILDE = new RegExp(String.raw`[~∼～]\s*${DATE}${WEEKDAY}${TIME}`, "g");
// `마감: 10/20`, `마감일 10.20`
const CLOSING = new RegExp(String.raw`마감(?:일|기한)?\s*[:：]?\s*${DATE}${WEEKDAY}${TIME}`, "g");

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

function build(match: RegExpMatchArray, postedAt: string | null): Deadline | null {
  const [, yearText, monthText, dayText, meridiem, hourText, minuteA, minuteB] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  let year: number;
  if (yearText) year = Number(yearText);
  else if (postedAt && /^\d{4}-\d{2}-\d{2}$/.test(postedAt)) {
    year = Number(postedAt.slice(0, 4));
    // 연말 공지의 `~1/5`처럼 작성일보다 한참 앞선 날짜는 다음 해로 본다.
    if (isValidDate(year, month, day) && dayNumber(formatDate(year, month, day)) < dayNumber(postedAt) - 30) year += 1;
  } else return null; // 연도를 알 근거가 없으면 추측하지 않는다.
  if (!isValidDate(year, month, day)) return null;
  let time: string | null = null;
  if (hourText) {
    let hour = Number(hourText);
    const minute = Number(minuteA ?? minuteB ?? "0");
    if ((meridiem === "오후" || meridiem === "밤") && hour < 12) hour += 12;
    if (meridiem === "오전" && hour === 12) hour = 0;
    if (hour === 24 && minute === 0) time = "23:59";
    else if (hour <= 23 && minute <= 59) time = `${pad2(hour)}:${pad2(minute)}`;
  }
  return { date: formatDate(year, month, day), time };
}

/**
 * 제목에 적힌 마감일만 읽는다. 적혀 있지 않으면 null이며 추측하지 않는다.
 * 연도가 없으면 작성일(postedAt)의 연도를 쓴다.
 */
export function extractDeadline(title: string, postedAt: string | null): Deadline {
  for (const pattern of [UNTIL, TILDE, CLOSING]) {
    // 같은 형태가 여러 번 나오면 마지막 것이 최종 마감이다(`9/1~9/30`).
    for (const match of [...title.matchAll(pattern)].reverse()) {
      const found = build(match, postedAt);
      if (found) return found;
    }
  }
  return NONE;
}

/** `2026.10.03`, `26.12.31`, `20261231`, `2026-10-03` 형태를 YYYY-MM-DD로 바꾼다. */
export function normalizeDate(text: string): string | null {
  const value = text.trim();
  const full = /(?<!\d)(\d{4})\s*[.\-/]?\s*(\d{2})\s*[.\-/]?\s*(\d{2})(?!\d)/.exec(value) ?? /(?<!\d)(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/.exec(value);
  const short = full ? null : /(?<!\d)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/.exec(value);
  const parts = full ? [Number(full[1]), Number(full[2]), Number(full[3])] : short ? [2000 + Number(short[1]), Number(short[2]), Number(short[3])] : null;
  return parts && isValidDate(parts[0], parts[1], parts[2]) ? formatDate(parts[0], parts[1], parts[2]) : null;
}

/** epoch(ms 또는 s)를 Asia/Seoul 날짜·시각으로 바꾼다. */
export function fromEpoch(value: unknown): { date: string; time: string } | null {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return null;
  const parts = seoulParts(new Date(number < 1e11 ? number * 1000 : number));
  return { date: parts.date, time: parts.time };
}
