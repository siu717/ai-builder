import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createDatabase } from "../lib/db";
import type { EventInput } from "../lib/contracts";
import { processDueReminders } from "../lib/reminder-worker";
import { createEvent, getState, markNotificationsRead, updateEvent } from "../lib/store";

const before = new Date("2026-10-03T00:00:00Z");
const due = new Date("2026-10-04T00:00:00Z");
const event: EventInput = {
  title: "장학금 신청", kind: "scholarship", date: "2026-10-05", time: null, notes: "성적표 첨부", source: "학생지원팀", isSample: false,
  reminders: [{ at: due.toISOString(), channel: "telegram" }],
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-worker-"));
  const path = join(directory, "campus.db");
  const db = await createDatabase(`file:${path}`);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined); });
  await db.execute("UPDATE campus_settings SET token = '123456:abcdefghijklmnopqrstuvwxy', chat_id = '123', enabled = 1 WHERE id = 1");
  return { db, path };
}

test("parallel durable workers send each reservation once and app notifications become readable", async (t) => {
  const { db, path } = await fixture(t);
  const second = await createDatabase(`file:${path}`);
  t.after(() => second.close());
  await createEvent({ ...event, reminders: [event.reminders[0], { at: due.toISOString(), channel: "app" }] }, db, before);
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
    assert.equal(body.chat_id, "123");
    assert.ok(body.text.includes("장학금 신청"));
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  await Promise.all([
    processDueReminders({ database: db, now: due, fetcher, workerId: "one" }),
    processDueReminders({ database: second, now: due, fetcher, workerId: "two" }),
  ]);
  await processDueReminders({ database: db, now: due, fetcher });
  const state = await getState(db);
  assert.equal(calls, 1);
  assert.ok(state.notifications.every((item) => item.status === "sent" && item.sentAt));
  assert.ok(state.settings.workerLastSeen);
  assert.ok((await markNotificationsRead(undefined, db)).notifications.every((item) => item.read));
});

test("Telegram 429 schedules backoff and stops after three definitive failed attempts", async (t) => {
  const { db } = await fixture(t);
  await createEvent(event, db, before);
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 10 } }, { status: 429 }); };
  await processDueReminders({ database: db, now: due, fetcher });
  await processDueReminders({ database: db, now: new Date(due.getTime() + 9000), fetcher });
  assert.equal(calls, 1);
  await processDueReminders({ database: db, now: new Date(due.getTime() + 10000), fetcher });
  await processDueReminders({ database: db, now: new Date(due.getTime() + 20000), fetcher });
  await processDueReminders({ database: db, now: new Date(due.getTime() + 30000), fetcher });
  const reminder = (await getState(db)).notifications[0];
  assert.equal(calls, 3);
  assert.equal(reminder.status, "failed");
  assert.equal(reminder.attempts, 3);
  assert.equal(reminder.sentAt, null);
});

test("successful Telegram backoff retry records delivery without duplicate sends", async (t) => {
  const { db } = await fixture(t);
  await createEvent(event, db, before);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return calls === 1 ? Response.json({ ok: false, error_code: 429, parameters: { retry_after: 1 } }, { status: 429 }) : Response.json({ ok: true });
  };
  await processDueReminders({ database: db, now: due, fetcher });
  const next = new Date(due.getTime() + 1000);
  await processDueReminders({ database: db, now: next, fetcher });
  await processDueReminders({ database: db, now: next, fetcher });
  assert.equal(calls, 2);
  assert.equal((await getState(db)).notifications[0].status, "sent");
});

test("sample and disabled Telegram reminders never send, and enabled reservations resume", async (t) => {
  const { db } = await fixture(t);
  await createEvent({ ...event, isSample: true }, db, before);
  await createEvent(event, db, before);
  await db.execute("UPDATE campus_settings SET enabled = 0 WHERE id = 1");
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ ok: true }); };
  await processDueReminders({ database: db, now: due, fetcher });
  assert.equal(calls, 0);
  const paused = (await getState(db)).notifications;
  assert.equal(paused.filter((item) => item.status === "cancelled").length, 1);
  assert.equal(paused.filter((item) => item.status === "pending").length, 1);
  await db.execute("UPDATE campus_settings SET enabled = 1 WHERE id = 1");
  await processDueReminders({ database: db, now: due, fetcher });
  assert.equal(calls, 1);
});

test("ambiguous network failures and expired leases are visible and never auto-retried", async (t) => {
  const { db } = await fixture(t);
  await createEvent(event, db, before);
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("https://api.telegram.org/botSECRET_TOKEN/sendMessage"); };
  await processDueReminders({ database: db, now: due, fetcher });
  await processDueReminders({ database: db, now: new Date(due.getTime() + 120000), fetcher });
  let reminder = (await getState(db)).notifications[0];
  assert.equal(calls, 1);
  assert.equal(reminder.status, "failed");
  assert.ok(!JSON.stringify(reminder).includes("SECRET_TOKEN"));
  await db.execute({ sql: "UPDATE campus_reminders SET status = 'sending', claimed_by = 'dead-worker', lease_until = ?, next_attempt_at = NULL", args: [before.toISOString()] });
  await processDueReminders({ database: db, now: due, fetcher });
  reminder = (await getState(db)).notifications[0];
  assert.equal(reminder.status, "failed");
  assert.ok(reminder.error?.includes("중단"));
  assert.equal(calls, 1);
});

test("completion during an in-flight send cancels reservations but confirms actual delivery truthfully", async (t) => {
  const { db } = await fixture(t);
  const created = await createEvent(event, db, before);
  const id = created.events[0].id;
  const fetcher: typeof fetch = async () => {
    await updateEvent(id, { completed: true }, db, due);
    return Response.json({ ok: true });
  };
  await processDueReminders({ database: db, now: due, fetcher });
  const reminder = (await getState(db)).notifications[0];
  assert.equal(reminder.status, "sent");
  assert.ok(reminder.error?.includes("변경 직전"));
});
