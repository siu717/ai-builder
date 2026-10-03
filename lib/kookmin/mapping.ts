// 국민대에서 읽은 항목을 가져오기 요청(KookminImportItem)으로 바꾼다.
// 화면과 서버가 같은 식별 키를 쓰도록 한곳에 모아 둔다. node 모듈을 쓰지 않는다.
import type { Channel, EcampusAssignment, EventKind, KookminImportItem, KookminNotice, KookminScheduleItem, ReminderInput } from "../contracts";
import { truncate } from "./text";

const TITLE_LIMIT = 200;
const NOTES_LIMIT = 10_000;
const SOURCE_LIMIT = 2000;
const KEY_LIMIT = 200;
const DAY_MS = 86_400_000;

export const REMINDER_PRESETS = ["d3", "d1", "d0"] as const;
export type ReminderPreset = (typeof REMINDER_PRESETS)[number];
const PRESET_DAYS: Record<ReminderPreset, number> = { d3: 3, d1: 1, d0: 0 };

/**
 * D-3·D-1·당일 오전 9시(서울) 알림을 만든다.
 * 이미 지났거나 마감 뒤가 되는 알림은 만들지 않는다.
 */
export function presetReminders(date: string, time: string | null, presets: readonly ReminderPreset[], now = new Date(), channel: Channel = "app"): ReminderInput[] {
  const deadline = new Date(`${date}T${time ? `${time}:00` : "23:59:59.999"}+09:00`).getTime();
  const base = new Date(`${date}T09:00:00+09:00`).getTime();
  if (!Number.isFinite(deadline) || !Number.isFinite(base)) return [];
  return REMINDER_PRESETS.filter((preset) => presets.includes(preset))
    .map((preset) => base - PRESET_DAYS[preset] * DAY_MS)
    .filter((at) => at > now.getTime() && at <= deadline)
    .map((at) => ({ at: new Date(at).toISOString(), channel }));
}

function lines(...parts: (string | null | false | undefined)[]): string {
  return truncate(parts.filter(Boolean).join("\n"), NOTES_LIMIT);
}

export function ecampusIdempotencyKey(uid: string): string {
  return truncate(`ecampus-${uid}`, KEY_LIMIT);
}

/** 학사일정 → 일정. 기간 일정은 시작일에 등록하고 메모에 기간을 남긴다. */
export function scheduleToImportItem(item: KookminScheduleItem, reminders: ReminderInput[] = []): KookminImportItem {
  return {
    kind: "academic",
    title: truncate(item.title, TITLE_LIMIT),
    date: item.startDate,
    time: null,
    notes: lines(item.startDate !== item.endDate && `기간: ${item.startDate} ~ ${item.endDate}`, `출처: ${item.source}`),
    source: truncate(item.source, SOURCE_LIMIT),
    idempotencyKey: truncate(item.id, KEY_LIMIT),
    reminders,
  };
}

/** eCampus 과제 → 일정. ICS와 북마클릿 어느 쪽으로 가져와도 같은 키가 되어 중복되지 않는다. */
export function assignmentToImportItem(item: EcampusAssignment, reminderPreset: readonly ReminderPreset[] | ReminderInput[] = [], now = new Date()): KookminImportItem {
  const presets = reminderPreset.filter((value): value is ReminderPreset => typeof value === "string");
  const explicit = reminderPreset.filter((value): value is ReminderInput => typeof value !== "string");
  return {
    kind: "assignment",
    title: truncate(item.title, TITLE_LIMIT),
    date: item.date,
    time: item.time,
    notes: lines(item.course && `과목: ${item.course}`, item.description, `출처: ${item.url ?? "국민대 eCampus"}`),
    source: truncate(item.url ?? "국민대 eCampus", SOURCE_LIMIT),
    idempotencyKey: ecampusIdempotencyKey(item.uid),
    reminders: [...explicit, ...presetReminders(item.date, item.time, presets, now)],
  };
}

export interface NoticeImportOptions {
  /** 공지에는 작성일만 있다. 마감 날짜는 사용자가 확인해 넘겨야 한다. */
  date: string;
  time?: string | null;
  kind?: EventKind;
  notes?: string;
  reminders?: ReminderInput[];
}

/** 공지 → 일정. 작성일을 마감으로 추정하지 않는다. */
export function noticeToImportItem(notice: KookminNotice, options: NoticeImportOptions): KookminImportItem {
  return {
    kind: options.kind ?? (notice.board === "scholarship" ? "scholarship" : "academic"),
    title: truncate(notice.title, TITLE_LIMIT),
    date: options.date,
    time: options.time ?? null,
    notes: lines(options.notes, notice.date && `공지 작성일: ${notice.date}`, `출처: ${notice.url}`),
    source: truncate(notice.url, SOURCE_LIMIT),
    idempotencyKey: truncate(notice.id, KEY_LIMIT),
    reminders: options.reminders ?? [],
  };
}
