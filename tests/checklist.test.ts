import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { Client } from "@libsql/client";

import { checklistFromDocuments, MAX_CHECKLIST_ITEMS } from "../lib/checklist";
import type { EventInput } from "../lib/contracts";
import { createDatabase } from "../lib/db";
import { createEvent, getState, updateEvent } from "../lib/store";

const NOW = new Date("2026-10-03T00:00:00Z");
const EVENT: EventInput = {
  title: "장학금 신청",
  kind: "scholarship",
  date: "2026-10-10",
  time: "18:00",
  notes: "장학팀에 서류 제출",
  source: "샘플 장학금 공고",
  isSample: true,
  reminders: [{ at: "2026-10-09T00:00:00Z", channel: "app" }],
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-checklist-"));
  const url = `file:${join(directory, "test.db")}`;
  const clients: Client[] = [];
  const open = async () => {
    const db = await createDatabase(url);
    clients.push(db);
    return db;
  };
  t.after(async () => {
    clients.forEach((db) => db.close());
    await rm(directory, { recursive: true, force: true });
  });
  return { db: await open(), open };
}

test("checklist edits persist across database connections without completing the event or replacing reminders", async (t) => {
  const { db, open } = await fixture(t);
  const checklist = checklistFromDocuments(["재학증명서", "성적증명서"]);
  const created = await createEvent({ ...EVENT, checklist }, db, NOW);
  const id = created.events[0].id;
  const checked = checklist.map((item) => ({ ...item, completed: true }));
  const updated = await updateEvent(id, { ...EVENT, checklist: checked }, db, NOW);
  assert.deepEqual(updated.events[0].checklist, checked);
  assert.equal(updated.events[0].completed, false);
  assert.deepEqual(updated.notifications, created.notifications);

  const reopened = await getState(await open());
  assert.deepEqual(reopened.events[0].checklist, checked);
  assert.equal(reopened.events[0].completed, false);
  const edited = [{ ...checked[0], text: "재학증명서 PDF 발급", completed: false }];
  const saved = await updateEvent(id, { ...EVENT, checklist: edited }, db, NOW);
  assert.deepEqual(saved.events[0].checklist, edited);
  assert.deepEqual(saved.notifications, created.notifications);
});

test("older events and clients preserve checklists, while an explicit empty list clears them", async (t) => {
  const { db } = await fixture(t);
  const created = await createEvent(EVENT, db, NOW);
  const id = created.events[0].id;
  assert.deepEqual(created.events[0].checklist, []);
  const checklist = checklistFromDocuments(["신청서"]);
  await updateEvent(id, { ...EVENT, checklist }, db, NOW);
  const legacy = await updateEvent(id, { ...EVENT, notes: "방문 제출" }, db, NOW);
  assert.deepEqual(legacy.events[0].checklist, checklist);
  const cleared = await updateEvent(id, { ...EVENT, checklist: [] }, db, NOW);
  assert.deepEqual(cleared.events[0].checklist, []);
  assert.deepEqual(cleared.notifications, created.notifications);
});

test("invalid checklist input cannot create an event or discard an existing checklist", async (t) => {
  const { db } = await fixture(t);
  const valid = { id: randomUUID(), text: "재학증명서", completed: false };
  const invalid = [
    [{ ...valid, text: "  " }],
    [{ ...valid, text: "가".repeat(201) }],
    [{ ...valid, id: "bad-id" }],
    [{ ...valid, completed: "true" }],
    [valid, valid],
    Array.from({ length: MAX_CHECKLIST_ITEMS + 1 }, () => ({ ...valid, id: randomUUID() })),
  ];
  for (const checklist of invalid) {
    await assert.rejects(createEvent({ ...EVENT, checklist }, db, NOW));
  }
  assert.equal((await getState(db)).events.length, 0);
  const created = await createEvent({ ...EVENT, checklist: [valid] }, db, NOW);
  await assert.rejects(updateEvent(created.events[0].id, { ...EVENT, checklist: invalid[0] }, db, NOW));
  assert.deepEqual((await getState(db)).events[0].checklist, [valid]);
});

test("editing preparation on a completed event preserves future reminders for reopening", async (t) => {
  const { db } = await fixture(t);
  const checklist = checklistFromDocuments(["성적증명서"]);
  const created = await createEvent({ ...EVENT, checklist }, db, NOW);
  const id = created.events[0].id;
  const completed = await updateEvent(id, { completed: true }, db, NOW);
  assert.equal(completed.notifications[0].status, "cancelled");
  const checked = checklist.map((item) => ({ ...item, completed: true }));
  await updateEvent(id, { ...EVENT, checklist: checked }, db, NOW);
  const reopened = await updateEvent(id, { completed: false }, db, NOW);
  assert.equal(reopened.notifications.length, 1);
  assert.equal(reopened.notifications[0].id, created.notifications[0].id);
  assert.equal(reopened.notifications[0].status, "pending");
  assert.deepEqual(reopened.events[0].checklist, checked);
});

test("preparation edits preserve delivered history and do not recreate an overdue reminder", async (t) => {
  const { db } = await fixture(t);
  const created = await createEvent(EVENT, db, NOW);
  const id = created.events[0].id;
  await db.execute({
    sql: "UPDATE campus_reminders SET status = 'sent', sent_at = scheduled_at WHERE event_id = ?",
    args: [id],
  });
  const delivered = (await getState(db)).notifications;
  const later = new Date("2026-10-09T01:00:00Z");
  const updated = await updateEvent(id, {
    ...EVENT,
    reminders: [],
    checklist: checklistFromDocuments(["신청서 서명"]),
  }, db, later);
  assert.deepEqual(updated.notifications, delivered);
});

test("document suggestions remove duplicates and retain the original requirement text", () => {
  const longRequirement = "발급 조건 ".repeat(50);
  const suggestions = checklistFromDocuments([" 성적증명서 ", "성적증명서", "", longRequirement]);
  assert.deepEqual(suggestions.map((item) => item.text), ["성적증명서", longRequirement.trim()]);
  assert.ok(suggestions.every((item) => !item.completed));
  assert.notEqual(suggestions[0].id, checklistFromDocuments(["성적증명서"])[0].id);
});
