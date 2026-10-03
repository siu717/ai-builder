// Client-safe pure helpers for the student's weekly class timetable.
// The timetable only lives in the browser (localStorage) and is used to
// propose a class-start time as a deadline candidate for "수업 전" notices.

export interface TimetableSlot {
  id: string;
  /** JavaScript weekday: 0 = 일요일 … 6 = 토요일. */
  weekday: number;
  /** Class start time, HH:mm (24h). */
  time: string;
  /** Optional course name used to pick between several classes on one day. */
  course: string;
}

export const TIMETABLE_STORAGE_KEY = "campus-timetable";
export const MAX_TIMETABLE_SLOTS = 40;
export const MAX_COURSE_LENGTH = 60;

/** Index = JavaScript weekday (0 = 일). */
export const WEEKDAY_LABELS: readonly string[] = ["일", "월", "화", "수", "목", "금", "토"];

/** Display order for selects: 월 → 일. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// "목요일", or a compound such as "월·수요일". A digit right before the first
// character ("10월") means a month, not a weekday.
const FULL_WEEKDAY = /(?<!\d)([월화수목금토일](?:\s*[·,/、]\s*[월화수목금토일])*)\s*요일/;
// "10월 8일(목)"
const ABBREVIATED_WEEKDAY = /\(\s*([월화수목금토일])\s*\)/;

export function weekdayLabel(weekday: number): string {
  return `${WEEKDAY_LABELS[weekday] ?? ""}요일`;
}

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * Detects the first weekday mentioned in a notice.
 * Recognises "목요일", compound forms such as "월·수요일" (returns the first
 * listed day) and parenthesised abbreviations such as "10월 8일(목)".
 * A digit directly before the character ("10월") is never a weekday.
 */
export function weekdayFromText(text: string): number | null {
  const full = FULL_WEEKDAY.exec(text);
  const abbreviated = ABBREVIATED_WEEKDAY.exec(text);
  let first = full ?? abbreviated;
  if (full && abbreviated && abbreviated.index < full.index) first = abbreviated;
  if (!first) return null;
  const weekday = WEEKDAY_LABELS.indexOf(first[1].charAt(0));
  return weekday >= 0 ? weekday : null;
}

/** True when the notice says the deadline is before a class ("수업 전", "수업 시작 전"). */
export function mentionsBeforeClass(text: string): boolean {
  return /수업\s*(?:시작\s*)?전/.test(text);
}

function normalizeCourse(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/**
 * Picks the class slot for a weekday. When several classes share the day,
 * a slot whose course name appears in `courseHint` (typically the notice
 * text) wins; otherwise the earliest class of the day is proposed.
 */
export function slotForWeekday(
  timetable: TimetableSlot[],
  weekday: number,
  courseHint?: string,
): TimetableSlot | null {
  const sameDay = timetable
    .filter((slot) => slot.weekday === weekday && isValidTime(slot.time))
    .sort((a, b) => a.time.localeCompare(b.time));
  if (sameDay.length === 0) return null;
  const hint = courseHint ? normalizeCourse(courseHint) : "";
  if (hint) {
    const matched = sameDay.find((slot) => {
      const course = normalizeCourse(slot.course);
      return course.length > 0 && hint.includes(course);
    });
    if (matched) return matched;
  }
  return sameDay[0];
}

export function slotHint(slot: TimetableSlot): string {
  return `시간표의 ${weekdayLabel(slot.weekday)} ${slot.time} 수업 시작 시각을 마감 후보로 사용합니다`;
}

export const CLASS_TIME_MISSING_HINT = "수업 시간을 입력하면 정확한 마감 시각을 제안합니다";

function isSlot(value: unknown): value is TimetableSlot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.weekday === "number" &&
    Number.isInteger(record.weekday) &&
    record.weekday >= 0 &&
    record.weekday <= 6 &&
    typeof record.time === "string" &&
    typeof record.course === "string"
  );
}

/** Parses a stored timetable, dropping anything malformed instead of throwing. */
export function parseTimetable(raw: string | null | undefined): TimetableSlot[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSlot)
      .map((slot) => ({
        id: slot.id,
        weekday: slot.weekday,
        time: isValidTime(slot.time) ? slot.time : "",
        course: slot.course.slice(0, MAX_COURSE_LENGTH),
      }))
      .slice(0, MAX_TIMETABLE_SLOTS);
  } catch {
    return [];
  }
}

let fallbackSlotCounter = 0;

export function newSlotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackSlotCounter += 1;
  return `slot-${Date.now()}-${fallbackSlotCounter}`;
}

export function loadTimetable(): TimetableSlot[] {
  if (typeof window === "undefined") return [];
  try {
    return parseTimetable(window.localStorage.getItem(TIMETABLE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveTimetable(timetable: TimetableSlot[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TIMETABLE_STORAGE_KEY,
      JSON.stringify(timetable.slice(0, MAX_TIMETABLE_SLOTS)),
    );
  } catch {
    /* Private mode or blocked storage: the in-memory timetable still works for this session. */
  }
}
