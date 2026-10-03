import assert from "node:assert/strict";
import test from "node:test";

import { TASK_SAMPLE } from "../lib/contracts";
import {
  CLASS_TIME_MISSING_HINT, MAX_TIMETABLE_SLOTS, isValidTime, loadTimetable, mentionsBeforeClass,
  parseTimetable, saveTimetable, slotForWeekday, slotHint, weekdayFromText, weekdayLabel,
  type TimetableSlot,
} from "../lib/timetable";

const slot = (id: string, weekday: number, time: string, course = ""): TimetableSlot => ({ id, weekday, time, course });

test("weekdayFromText reads full weekday names using the JavaScript weekday index", () => {
  assert.equal(weekdayFromText("일요일 자정까지"), 0);
  assert.equal(weekdayFromText("월요일 수업 전 제출"), 1);
  assert.equal(weekdayFromText("화요일"), 2);
  assert.equal(weekdayFromText("수요일"), 3);
  assert.equal(weekdayFromText("금요일"), 5);
  assert.equal(weekdayFromText("토요일"), 6);
  assert.equal(weekdayFromText(TASK_SAMPLE), 4);
});

test("weekdayFromText returns the first occurrence and handles compound and abbreviated forms", () => {
  assert.equal(weekdayFromText("목요일 공지: 다음 주 화요일 수업 전까지 제출"), 4);
  assert.equal(weekdayFromText("월·수요일 수업 전에 제출"), 1);
  assert.equal(weekdayFromText("화, 목요일 분반"), 2);
  assert.equal(weekdayFromText("10월 8일(목) 수업 전까지"), 4);
  assert.equal(weekdayFromText("10/9(금) 제출, 늦어도 월요일까지"), 5);
  assert.equal(weekdayFromText("수 요일"), 3);
});

test("weekdayFromText never treats months or unrelated words as weekdays", () => {
  assert.equal(weekdayFromText("10월 8일까지 제출"), null);
  assert.equal(weekdayFromText("월간 보고서를 금주 내 제출"), null);
  assert.equal(weekdayFromText("제출 요일은 추후 공지"), null);
  assert.equal(weekdayFromText(""), null);
  // "10월, 수요일" is October + Wednesday, not a 월·수 compound.
  assert.equal(weekdayFromText("10월, 수요일 수업 전"), 3);
});

test("slotForWeekday proposes the earliest class unless the notice names a course", () => {
  const timetable = [
    slot("a", 1, "09:00", "웹프로그래밍"),
    slot("b", 4, "13:00", "자료구조"),
    slot("c", 4, "09:00", "웹 프로그래밍"),
    slot("d", 4, "", "시각 미입력 수업"),
  ];
  assert.equal(slotForWeekday(timetable, 4)?.id, "c");
  assert.equal(slotForWeekday(timetable, 4, "자료구조 과제를 목요일 수업 전까지 제출")?.id, "b");
  assert.equal(slotForWeekday(timetable, 4, TASK_SAMPLE)?.id, "c");
  assert.equal(slotForWeekday(timetable, 4, "관련 없는 공지")?.id, "c");
  assert.equal(slotForWeekday(timetable, 1)?.time, "09:00");
  assert.equal(slotForWeekday(timetable, 2), null);
  assert.equal(slotForWeekday([], 4), null);
  // A class without a start time can never become a deadline candidate.
  assert.equal(slotForWeekday([slot("d", 4, "")], 4), null);
});

test("QA-04: Thursday 09:00 class is offered as the deadline candidate for the sample notice", () => {
  const timetable = [slot("thu", 4, "09:00", "웹 프로그래밍")];
  const weekday = weekdayFromText(TASK_SAMPLE);
  assert.equal(weekday, 4);
  assert.equal(mentionsBeforeClass(TASK_SAMPLE), true);
  const matched = slotForWeekday(timetable, weekday!, TASK_SAMPLE);
  assert.equal(matched?.time, "09:00");
  assert.equal(slotHint(matched!), "시간표의 목요일 09:00 수업 시작 시각을 마감 후보로 사용합니다");
});

test("QA-05: without a matching class no time is invented", () => {
  const weekday = weekdayFromText(TASK_SAMPLE)!;
  assert.equal(slotForWeekday([slot("mon", 1, "09:00")], weekday, TASK_SAMPLE), null);
  assert.equal(mentionsBeforeClass("수업 시작 전에 업로드"), true);
  assert.equal(mentionsBeforeClass("10월 8일 18시까지 제출"), false);
  assert.equal(CLASS_TIME_MISSING_HINT, "수업 시간을 입력하면 정확한 마감 시각을 제안합니다");
  assert.equal(weekdayLabel(4), "목요일");
});

test("parseTimetable drops malformed storage instead of throwing", () => {
  assert.deepEqual(parseTimetable(null), []);
  assert.deepEqual(parseTimetable("not json"), []);
  assert.deepEqual(parseTimetable(JSON.stringify({ weekday: 4 })), []);
  const parsed = parseTimetable(JSON.stringify([
    slot("ok", 4, "09:00", "웹 프로그래밍"),
    { id: "bad-day", weekday: 9, time: "09:00", course: "" },
    { id: "", weekday: 1, time: "09:00", course: "" },
    { id: "no-course", weekday: 1, time: "09:00" },
    slot("bad-time", 2, "25:99", "시간 오류"),
    "문자열",
  ]));
  assert.deepEqual(parsed.map((item) => item.id), ["ok", "bad-time"]);
  assert.equal(parsed[1].time, "");
  assert.equal(isValidTime("23:59"), true);
  assert.equal(isValidTime("24:00"), false);
  const many = Array.from({ length: MAX_TIMETABLE_SLOTS + 5 }, (_, index) => slot(`s${index}`, 1, "09:00"));
  assert.equal(parseTimetable(JSON.stringify(many)).length, MAX_TIMETABLE_SLOTS);
});

test("load and save are no-ops outside the browser", () => {
  assert.deepEqual(loadTimetable(), []);
  assert.doesNotThrow(() => saveTimetable([slot("a", 1, "09:00")]));
});
