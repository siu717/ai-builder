import assert from "node:assert/strict";
import test from "node:test";

import {
  AIInputError, analysisResultSchema, analyzeRequestSchema, analyzeText, coachResume,
  coachingRequestSchema, coachingResultSchema, isCalendarDate, validateCoachingQuotes,
} from "../lib/ai";
import { getCatalog } from "../lib/catalog";
import { COACH_JOB_SAMPLE, COACH_RESUME_SAMPLE, DEFAULT_PROFILE, TASK_SAMPLE } from "../lib/contracts";

test("input validation rejects nonexistent calendar days, invalid time and blank documents", () => {
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(analyzeRequestSchema.safeParse({ text: TASK_SAMPLE, kind: "assignment", referenceDate: "2026-02-30", classTime: null, sample: true }).success, false);
  assert.equal(analyzeRequestSchema.safeParse({ text: TASK_SAMPLE, kind: "assignment", referenceDate: null, classTime: "24:00", sample: true }).success, false);
  assert.equal(coachingRequestSchema.safeParse({ jobText: " ", resumeText: "서류", sample: false }).success, false);
});

test("task sample follows the supplied reference date and class time", async () => {
  const result = await analyzeText({ text: TASK_SAMPLE, kind: "assignment", referenceDate: "2026-10-03", classTime: "09:00", sample: true }, DEFAULT_PROFILE);
  assert.equal(result.mode, "sample");
  assert.equal(result.date, "2026-10-08");
  assert.equal(result.time, "09:00");
  assert.equal(result.submission, "LMS 과제함에 ZIP 파일 제출");
  const monday = await analyzeText({ text: TASK_SAMPLE, kind: "assignment", referenceDate: "2026-10-05", classTime: "09:00", sample: true }, DEFAULT_PROFILE);
  assert.equal(monday.date, "2026-10-15");
});

test("missing reference date or class time never produces a fabricated deadline", async () => {
  const noDate = await analyzeText({ text: TASK_SAMPLE, kind: "assignment", referenceDate: null, classTime: "09:00", sample: true }, DEFAULT_PROFILE);
  assert.equal(noDate.date, null);
  assert.equal(noDate.time, null);
  assert.ok(noDate.missing.some((item) => item.includes("작성일")));
  const noTime = await analyzeText({ text: TASK_SAMPLE, kind: "assignment", referenceDate: "2026-10-03", classTime: null, sample: true }, DEFAULT_PROFILE);
  assert.equal(noTime.date, "2026-10-08");
  assert.equal(noTime.time, null);
  assert.ok(noTime.missing.some((item) => item.includes("시작 시간")));
});

test("sample analysis only accepts the exact supplied sample document", async () => {
  await assert.rejects(analyzeText({ text: `${TASK_SAMPLE}\n임의 수정`, kind: "assignment", referenceDate: "2026-10-03", classTime: "09:00", sample: true }, DEFAULT_PROFILE), (error) => error instanceof AIInputError && error.status === 422);
  const now = new Date("2026-10-03T12:00:00Z");
  const sample = getCatalog(DEFAULT_PROFILE, now).find((item) => item.time === null)!;
  const result = await analyzeText({ text: sample.originalText, kind: sample.kind, referenceDate: null, classTime: null, sample: true }, DEFAULT_PROFILE, now);
  assert.equal(result.date, sample.date);
  assert.equal(result.time, null);
});

test("AI key absence returns an actionable error instead of pretending to analyze arbitrary text", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(analyzeText({ text: "내 실제 과제 공지", kind: "assignment", referenceDate: null, classTime: null, sample: false }, DEFAULT_PROFILE), (error) => error instanceof AIInputError && error.status === 503 && error.message.includes("ANTHROPIC_API_KEY"));
    await assert.rejects(coachResume({ jobText: "내 실제 공고", resumeText: "내 실제 서류", sample: false }), (error) => error instanceof AIInputError && error.status === 503);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("analysis result validation rejects nonexistent dates and time without a date", () => {
  const result = { title: "과제", kind: "assignment", date: "2026-02-30", time: "09:00", subject: "수업", submission: "LMS", summary: "제출", missing: [], documents: [], conditions: [] };
  assert.equal(analysisResultSchema.safeParse(result).success, false);
  assert.equal(analysisResultSchema.safeParse({ ...result, date: null, missing: ["마감 날짜 확인"] }).success, false);
  assert.equal(analysisResultSchema.safeParse({ ...result, date: "2026-03-01", time: null }).success, true);
});

test("coaching sample quotes only submitted facts and rejects changed sample input", async () => {
  const result = await coachResume({ jobText: COACH_JOB_SAMPLE, resumeText: COACH_RESUME_SAMPLE, sample: true });
  assert.equal(result.mode, "sample");
  const { mode: _mode, ...payload } = result;
  assert.equal(coachingResultSchema.safeParse(payload).success, true);
  validateCoachingQuotes(payload, COACH_RESUME_SAMPLE);
  assert.throws(() => validateCoachingQuotes({ ...payload, feedback: [{ quote: "매출 3배 달성", suggestion: "수정", reason: "근거" }] }, COACH_RESUME_SAMPLE), (error) => error instanceof AIInputError && error.status === 502);
  await assert.rejects(coachResume({ jobText: COACH_JOB_SAMPLE, resumeText: `${COACH_RESUME_SAMPLE} 수정`, sample: true }), (error) => error instanceof AIInputError && error.status === 422);
});

test("live analysis uses the SDK structured output contract and validates mocked responses", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-only-not-a-live-key";
  process.env.ANTHROPIC_MODEL = "claude-sonnet-4-6";
  let requestBody: Record<string, unknown> | undefined;
  let responseDate = "2026-10-08";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-4-6",
      content: [{ type: "text", text: JSON.stringify({
        title: "과제 제출", kind: "assignment", date: responseDate, time: null,
        subject: "수업", submission: "LMS", summary: "과제 제출 공지", missing: ["마감 시간 확인 필요"], documents: [], conditions: [],
      }) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
  try {
    const result = await analyzeText({ text: "2026-10-08까지 과제 제출", kind: "assignment", referenceDate: null, classTime: null, sample: false }, DEFAULT_PROFILE);
    assert.equal(result.mode, "live");
    assert.equal(result.time, null);
    assert.equal(requestBody?.model, "claude-sonnet-4-6");
    assert.deepEqual((requestBody?.output_config as { format: { type: string } }).format.type, "json_schema");
    assert.ok(String(requestBody?.system).includes("신뢰하지 않는 데이터"));
    responseDate = "2026-02-30";
    await assert.rejects(analyzeText({ text: "날짜 분석", kind: "assignment", referenceDate: null, classTime: null, sample: false }, DEFAULT_PROFILE), (error) => error instanceof AIInputError && error.status === 502 && !error.message.includes("test-only-not-a-live-key"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = previousModel;
  }
});
