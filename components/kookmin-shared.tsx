"use client";

import { useEffect, useRef } from "react";
import type {
  CalendarEvent,
  EcampusAssignment,
  KookminImportItem,
  KookminImportResult,
  KookminScheduleItem,
  ReminderInput,
} from "@/lib/contracts";

export type ScheduleState = {
  status: "loading" | "ready" | "error";
  items: KookminScheduleItem[];
  error: string;
};

export const PRESETS = [
  { key: "d3", label: "D-3", days: 3 },
  { key: "d1", label: "D-1", days: 1 },
  { key: "d0", label: "당일", days: 0 },
] as const;
export type PresetKey = (typeof PRESETS)[number]["key"];

const DAY = 86_400_000;

/** 09:00 Seoul on D-n; only future instants that are not after the deadline. */
export function presetReminders(
  date: string,
  time: string | null,
  presets: readonly PresetKey[],
): ReminderInput[] {
  const deadline = new Date(`${date}T${time ?? "23:59"}:00+09:00`).getTime();
  const base = new Date(`${date}T09:00:00+09:00`).getTime();
  if (!Number.isFinite(deadline) || !Number.isFinite(base)) return [];
  const now = Date.now();
  return PRESETS.filter((preset) => presets.includes(preset.key))
    .map((preset) => base - preset.days * DAY)
    .filter((at) => at > now && at <= deadline)
    .map((at) => ({ at: new Date(at).toISOString(), channel: "app" as const }));
}

export function scheduleToImport(
  item: KookminScheduleItem,
  presets: readonly PresetKey[],
): KookminImportItem {
  return {
    kind: "academic",
    title: item.title,
    date: item.startDate,
    time: null,
    notes:
      item.startDate === item.endDate
        ? ""
        : `기간: ${item.startDate} ~ ${item.endDate}`,
    source: item.source,
    idempotencyKey: item.id,
    reminders: presetReminders(item.startDate, null, presets),
  };
}

export function assignmentToImport(
  item: EcampusAssignment,
  presets: readonly PresetKey[],
): KookminImportItem {
  return {
    kind: "assignment",
    title: item.title,
    date: item.date,
    time: item.time,
    notes: [item.course && `과목: ${item.course}`, item.description]
      .filter(Boolean)
      .join("\n")
      .slice(0, 5000),
    source: item.url ?? "eCampus",
    idempotencyKey: `ecampus-${item.uid}`,
    reminders: presetReminders(item.date, item.time, presets),
  };
}

/**
 * Imported events keep the import key, so an event the user renamed or moved
 * still counts. Kind + date + title covers events saved without a key.
 */
export function isScheduleImported(
  events: CalendarEvent[],
  item: KookminScheduleItem,
) {
  return events.some(
    (event) =>
      event.idempotencyKey === item.id ||
      (event.kind === "academic" &&
        event.date === item.startDate &&
        event.title === item.title),
  );
}

export function isAssignmentImported(
  events: CalendarEvent[],
  item: EcampusAssignment,
) {
  return events.some(
    (event) =>
      event.idempotencyKey === `ecampus-${item.uid}` ||
      (event.kind === "assignment" &&
        event.date === item.date &&
        event.title === item.title),
  );
}

/** Toast text after an import, e.g. "학사일정 3개를 가져왔습니다 (중복 1개 건너뜀)". */
export function importMessage(label: string, result: KookminImportResult) {
  const notes = [
    result.skipped ? `중복 ${result.skipped}개 건너뜀` : "",
    result.failed.length ? `${result.failed.length}개 실패` : "",
  ].filter(Boolean);
  const suffix = notes.length ? ` (${notes.join(", ")})` : "";
  return `${label} ${result.created}개를 가져왔습니다${suffix}`;
}

export function upcomingSchedule(items: KookminScheduleItem[], today: string) {
  return items
    .filter((item) => item.endDate >= today)
    .sort((a, b) =>
      `${a.startDate}${a.endDate}`.localeCompare(`${b.startDate}${b.endDate}`),
    );
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "10.3 (토)" for a yyyy-MM-dd date, without timezone drift. */
export function shortDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}.${day} (${weekday})`;
}

export function dateRange(startDate: string, endDate: string) {
  return startDate === endDate
    ? shortDate(startDate)
    : `${shortDate(startDate)} ~ ${shortDate(endDate)}`;
}

export function ReminderPresets({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: PresetKey[];
  onChange: (next: PresetKey[]) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  return (
    <fieldset className="kmu-presets" disabled={disabled}>
      <legend>앱 알림 (오전 9시)</legend>
      {PRESETS.map((preset) => (
        <label className="kmu-check" key={preset.key}>
          <input
            type="checkbox"
            id={`${idPrefix}-${preset.key}`}
            checked={value.includes(preset.key)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, preset.key]
                  : value.filter((key) => key !== preset.key),
              )
            }
          />
          {preset.label}
        </label>
      ))}
    </fieldset>
  );
}

export function ImportFailures({
  failed,
  titles,
}: {
  failed: KookminImportResult["failed"];
  titles: Map<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The import button sits in a sticky bar far below this list on long pages.
  useEffect(() => {
    if (failed.length) ref.current?.scrollIntoView({ block: "nearest" });
  }, [failed]);
  if (!failed.length) return null;
  return (
    <div ref={ref} className="kmu-failures" role="alert">
      <strong>가져오지 못한 항목 {failed.length}개</strong>
      <ul>
        {failed.map((item) => (
          <li key={item.idempotencyKey}>
            {titles.get(item.idempotencyKey) ?? item.idempotencyKey} —{" "}
            {item.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
