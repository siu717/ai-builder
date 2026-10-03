import assert from "node:assert/strict";
import test from "node:test";

import { eligibilitySummary, getCatalog, seoulToday } from "../lib/catalog";
import { DEFAULT_PROFILE, type Profile } from "../lib/contracts";

const NOW = new Date("2026-10-03T15:30:00Z");
const PROFILE: Profile = {
  ...DEFAULT_PROFILE, year: "3", major: "컴퓨터공학", gpa: "3.8", gpaScale: "4.5",
  interests: "프론트엔드 개발", experience: "JavaScript 프로젝트와 Git 협업 경험",
};

test("catalog uses Seoul dates and marks all six opportunities as samples", () => {
  assert.equal(seoulToday(NOW), "2026-10-04");
  const opportunities = getCatalog(PROFILE, NOW);
  assert.equal(opportunities.length, 6);
  assert.equal(opportunities.filter((item) => item.kind === "scholarship").length, 3);
  for (const item of opportunities) {
    assert.equal(item.isSample, true);
    assert.ok(item.originalText.includes("실제 모집 정보가 아닙니다"));
    assert.ok(item.date > "2026-10-04");
    assert.ok(item.originalText.includes(item.date));
    for (const condition of item.conditions) assert.ok(condition.reason.includes("공고 근거:"));
  }
});

test("scholarship requirements distinguish eligible, ineligible and incomplete profiles", () => {
  const first = (profile: Profile) => getCatalog(profile, NOW)[0];
  assert.equal(eligibilitySummary(first(PROFILE).conditions), "met");
  assert.equal(eligibilitySummary(first({ ...PROFILE, gpa: "2.5" }).conditions), "unmet");
  assert.equal(eligibilitySummary(first(DEFAULT_PROFILE).conditions), "unknown");
  const income = getCatalog(PROFILE, NOW).find((item) => item.id === "sample-scholarship-opportunity")!;
  assert.equal(income.conditions.find((item) => item.label.includes("지원구간"))!.status, "unknown");
});

test("different GPA scales require confirmation instead of an invented conversion", () => {
  const catalog = getCatalog({ ...PROFILE, gpa: "3.8", gpaScale: "4.3" }, NOW);
  const condition = catalog[0].conditions.find((item) => item.label.includes("학점"))!;
  assert.equal(condition.status, "unknown");
  assert.match(condition.reason, /환산 기준/);
});

test("job interests remain separate from mandatory eligibility and preferred experience", () => {
  const job = getCatalog(PROFILE, NOW).find((item) => item.id === "sample-job-frontend")!;
  assert.match(job.recommendation, /관심 직무.*프론트엔드/);
  assert.equal(job.conditions.find((condition) => condition.label.startsWith("우대:"))!.status, "unknown");
  assert.equal(eligibilitySummary(job.conditions), "met");
  const incomplete = getCatalog({ ...PROFILE, experience: "" }, NOW).find((item) => item.id === job.id)!;
  assert.match(incomplete.recommendation, /관심 직무.*프론트엔드/);
  assert.equal(eligibilitySummary(incomplete.conditions), "unknown");
});

test("omitted skills are unknown while explicitly absent skills are unmet", () => {
  const job = (experience: string) => getCatalog({ ...PROFILE, experience }, NOW).find((item) => item.id === "sample-job-frontend")!;
  assert.equal(job("Java 개발 경험").conditions.find((item) => item.label.includes("JavaScript"))!.status, "unknown");
  assert.equal(job("JavaScript 경험 없음").conditions.find((item) => item.label.includes("JavaScript"))!.status, "unmet");
});
