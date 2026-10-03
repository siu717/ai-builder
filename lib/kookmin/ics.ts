// iCalendar(RFC 5545) 파서. Moodle(eCampus)이 내보낸 달력에서 과제 마감을 읽는다.
// 브라우저에서도 쓸 수 있도록 node 모듈을 쓰지 않는다.
import type { EcampusAssignment } from "../contracts";
import { addDays, cleanAssignmentTitle, formatDate, htmlToText, isValidDate, pad2, seoulParts, stableHash, truncate } from "./text";

export const ICS_MAX_ITEMS = 200;
const TITLE_LIMIT = 200;
const COURSE_LIMIT = 200;
const DESCRIPTION_LIMIT = 2000;
const UID_LIMIT = 180;

export class IcsFormatError extends Error {
  constructor() {
    super("ICS(iCalendar) 형식이 아닙니다.");
    this.name = "IcsFormatError";
  }
}

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** 접힌 줄을 편다. 줄바꿈 뒤에 공백이나 탭으로 시작하는 줄은 앞줄의 연속이다. */
export function unfoldIcs(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length) lines[lines.length - 1] += raw.slice(1);
    else if (raw.trim()) lines.push(raw);
  }
  return lines;
}

function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === "\"") quoted = !quoted;
    if (char === separator && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

export function parseIcsLine(line: string): IcsProperty | null {
  let colon = -1;
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\"") quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon <= 0) return null;
  const [rawName, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ";");
  const name = rawName.trim().toUpperCase();
  if (!/^[A-Z0-9.-]+$/.test(name)) return null;
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const equals = param.indexOf("=");
    if (equals > 0) params[param.slice(0, equals).trim().toUpperCase()] = param.slice(equals + 1).trim().replace(/^"|"$/g, "");
  }
  return { name, params, value: line.slice(colon + 1) };
}

/** TEXT 값의 이스케이프(`\n`, `\,`, `\;`, `\\`)를 푼다. */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

interface Moment {
  date: string;
  time: string | null;
}

/** 시간대의 벽시계 시각을 실제 시각으로 바꾼다. 모르는 시간대면 null. */
function zonedInstant(timeZone: string, year: number, month: number, day: number, hour: number, minute: number, second: number): Date | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return null;
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const shown = (instant: number) => {
    const parts: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(instant))) if (part.type !== "literal") parts[part.type] = Number(part.value);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  };
  // 서머타임 경계에서도 맞도록 두 번 보정한다.
  let instant = wall - (shown(wall) - wall);
  instant = wall - (shown(instant) - instant);
  return new Date(instant);
}

/** DTSTART/DTEND 값을 Asia/Seoul 날짜와 시각으로 바꾼다. 날짜만 있으면 시각은 null이다. */
export function parseIcsDate(property: IcsProperty): Moment | null {
  const raw = property.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [year, month, day] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])];
    return isValidDate(year, month, day) ? { date: formatDate(year, month, day), time: null } : null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(raw);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)];
  if (!isValidDate(year, month, day) || hour > 23 || minute > 59 || second > 60) return null;
  if (match[7]) {
    const seoul = seoulParts(new Date(Date.UTC(year, month - 1, day, hour, minute, second)));
    return { date: seoul.date, time: seoul.time };
  }
  const zone = property.params.TZID?.trim();
  if (zone && !/^(?:.*\/)?Asia\/Seoul$/i.test(zone)) {
    // `/softwarestudio.org/Tzfile/Europe/London` 같은 접두어가 붙은 이름도 받는다.
    const instant = zonedInstant(zone, year, month, day, hour, minute, second)
      ?? zonedInstant(zone.split("/").slice(-2).join("/"), year, month, day, hour, minute, second);
    if (instant) {
      const seoul = seoulParts(instant);
      return { date: seoul.date, time: seoul.time };
    }
  }
  // 시간대가 없거나 알 수 없으면 한국 시각으로 본다.
  return { date: formatDate(year, month, day), time: `${pad2(hour)}:${pad2(minute)}` };
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * VEVENT 하나를 과제 항목으로 바꾼다. 마감은 DTEND(없으면 DUE, DTSTART)로 본다.
 * 날짜를 읽을 수 없거나 취소된 일정이면 null이다.
 */
export function assignmentFromVevent(properties: readonly IcsProperty[]): EcampusAssignment | null {
  const find = (name: string) => properties.find((property) => property.name === name);
  const text = (name: string) => {
    const property = find(name);
    return property ? unescapeIcsText(property.value).trim() : "";
  };
  if (text("STATUS").toUpperCase() === "CANCELLED") return null;

  const startProperty = find("DTSTART");
  const endProperty = find("DTEND") ?? find("DUE");
  const start = startProperty ? parseIcsDate(startProperty) : null;
  const end = endProperty ? parseIcsDate(endProperty) : null;
  let deadline = end ?? start;
  if (!deadline) return null;
  // 종일 일정의 DTEND는 끝나는 다음 날을 가리킨다.
  if (end && end.time === null && start && start.time === null && end.date > start.date && find("DTEND")) {
    deadline = { date: addDays(end.date, -1), time: null };
  }

  const summary = text("SUMMARY");
  const rawDescription = text("DESCRIPTION");
  const description = (/<[a-z][\s\S]*>/i.test(rawDescription) ? htmlToText(rawDescription) : rawDescription.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n")).trim();
  const course = text("CATEGORIES").replace(/\s+/g, " ");
  const uid = text("UID") || `nouid-${stableHash(`${summary}|${startProperty?.value ?? ""}|${endProperty?.value ?? ""}|${course}`)}`;
  return {
    uid: truncate(uid, UID_LIMIT),
    title: truncate(cleanAssignmentTitle(summary) || "제목 없는 일정", TITLE_LIMIT),
    course: course ? truncate(course, COURSE_LIMIT) : null,
    date: deadline.date,
    time: deadline.time,
    description: description ? truncate(description, DESCRIPTION_LIMIT) : null,
    url: safeUrl(find("URL")?.value),
  };
}

export interface ParsedIcs {
  calendarName: string | null;
  items: EcampusAssignment[];
}

/** ICS 전체를 읽어 마감이 빠른 순서로 돌려준다. 달력이 아니면 IcsFormatError를 던진다. */
export function parseIcs(text: string): ParsedIcs {
  const lines = unfoldIcs(text);
  if (!lines.some((line) => /^BEGIN:VCALENDAR\s*$/i.test(line))) throw new IcsFormatError();
  const stack: string[] = [];
  let calendarName: string | null = null;
  let current: IcsProperty[] | null = null;
  const byUid = new Map<string, EcampusAssignment>();
  for (const line of lines) {
    const property = parseIcsLine(line);
    if (!property) continue;
    const component = property.value.trim().toUpperCase();
    if (property.name === "BEGIN") {
      stack.push(component);
      if (component === "VEVENT") current = [];
      continue;
    }
    if (property.name === "END") {
      if (component === "VEVENT" && current) {
        const item = assignmentFromVevent(current);
        if (item && !byUid.has(item.uid)) byUid.set(item.uid, item);
        current = null;
      }
      const opened = stack.lastIndexOf(component);
      if (opened >= 0) stack.length = opened;
      continue;
    }
    const scope = stack[stack.length - 1];
    // VALARM처럼 VEVENT 안에 들어 있는 하위 구성요소의 속성은 일정 속성이 아니다.
    if (scope === "VEVENT" && current) current.push(property);
    else if (scope === "VCALENDAR" && property.name === "X-WR-CALNAME") calendarName = truncate(unescapeIcsText(property.value).trim(), 200) || null;
  }
  const order = (item: EcampusAssignment) => `${item.date}T${item.time ?? "99:99"}`;
  const items = [...byUid.values()].sort((a, b) => order(a).localeCompare(order(b)));
  // 가져오기는 한 번에 200개까지다. 넘으면 오래된 일정부터 뺀다.
  return { calendarName, items: items.slice(-ICS_MAX_ITEMS) };
}
