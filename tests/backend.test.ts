import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createDatabase } from "../lib/db";
import { DEFAULT_PROFILE, type EventInput } from "../lib/contracts";
import { assertSameOrigin, apiError } from "../lib/http";
import { createEvent, deleteEvent, getState, saveProfile, saveSettings, updateEvent } from "../lib/store";
import { validateEvent } from "../lib/validation";

const now = new Date("2026-10-03T00:00:00Z");
const input: EventInput = {
  title: "과제 제출", kind: "assignment", date: "2026-10-05", time: "18:00", notes: "LMS 제출", source: "수업 공지", isSample: false,
  reminders: [{ at: "2026-10-04T09:00:00+09:00", channel: "app" }],
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-backend-"));
  const path = join(directory, "private", "campus.db");
  const db = await createDatabase(`file:${path}`);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  return { db, path };
}

test("SQLite persists profile, schedules, checklist and safe settings across connections", async (t) => {
  const { db, path } = await fixture(t);
  await saveProfile({ ...DEFAULT_PROFILE, name: "김학생", major: "컴퓨터공학" }, db);
  await createEvent({ ...input, checklist: [{ id: "033d92b7-ce86-409d-9e4d-fb68ffac4ba8", text: "제출 파일 확인", completed: true }] }, db, now);
  const second = await createDatabase(`file:${path}`);
  t.after(() => second.close());
  const state = await getState(second);
  assert.equal(state.profile.name, "김학생");
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].checklist?.[0].completed, true);
  assert.equal(state.notifications.length, 1);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(path, ".."))).mode & 0o777, 0o700);
});

test("date and Seoul reminder validation reject impossible, past, late and duplicate reminders", () => {
  assert.throws(() => validateEvent({ ...input, date: "2026-02-30" }, now));
  assert.throws(() => validateEvent({ ...input, reminders: [{ at: now.toISOString(), channel: "app" }] }, now));
  assert.throws(() => validateEvent({ ...input, reminders: [{ at: "2026-10-05T18:01:00+09:00", channel: "app" }] }, now));
  assert.throws(() => validateEvent({ ...input, reminders: [input.reminders[0], input.reminders[0]] }, now));
  assert.throws(() => validateEvent({ ...input, reminders: [{ at: "not-a-date", channel: "app" }] }, now));
  const dateOnly = validateEvent({ ...input, time: null, reminders: [{ at: "2026-10-05T23:59:00+09:00", channel: "app" }] }, now);
  assert.equal(dateOnly.time, null);
  assert.throws(() => validateEvent({ ...input, time: null, reminders: [{ at: "2026-10-06T00:00:00+09:00", channel: "app" }] }, now));
});

test("event idempotency and complete, undo, edit, delete preserve reservation lifecycle", async (t) => {
  const { db } = await fixture(t);
  await createEvent({ ...input, idempotencyKey: "notice-1" }, db, now);
  let state = await createEvent({ ...input, idempotencyKey: "notice-1" }, db, now);
  assert.equal(state.events.length, 1);
  assert.equal(state.notifications.length, 1);
  const id = state.events[0].id;
  state = await updateEvent(id, { completed: true }, db, now);
  assert.equal(state.notifications[0].status, "cancelled");
  state = await updateEvent(id, { completed: false }, db, now);
  assert.equal(state.notifications[0].status, "pending");
  state = await updateEvent(id, { ...input, title: "과제 수정" }, db, now);
  assert.equal(state.notifications.filter((item) => item.status === "pending").length, 1);
  assert.equal(state.notifications.filter((item) => item.status === "cancelled").length, 1);
  state = await deleteEvent(id, db);
  assert.equal(state.events.length, 0);
  assert.ok(state.notifications.every((item) => item.status === "cancelled"));
});

test("undo restores only future reservations and editing completed events stays cancelled", async (t) => {
  const { db } = await fixture(t);
  const created = await createEvent(input, db, now);
  const id = created.events[0].id;
  await updateEvent(id, { completed: true }, db, now);
  const afterDue = new Date("2026-10-04T01:00:00Z");
  const state = await updateEvent(id, { completed: false }, db, afterDue);
  assert.equal(state.notifications[0].status, "cancelled");
  await updateEvent(id, { completed: true }, db, now);
  const edited = await updateEvent(id, { ...input, title: "완료 후 수정" }, db, now);
  assert.ok(edited.notifications.every((item) => item.status === "cancelled"));
  const reopened = await updateEvent(id, { completed: false }, db, now);
  assert.equal(reopened.notifications.filter((item) => item.status === "pending").length, 1);
});

test("Telegram settings validate the bot, redact tokens and retain tokens on blank updates", async (t) => {
  const { db } = await fixture(t);
  const token = "123456:abcdefghijklmnopqrstuvwxy";
  const fetcher: typeof fetch = async () => Response.json({ ok: true, result: { username: "campus_test_bot" } });
  let state = await saveSettings({ telegramToken: token, telegramChatId: "12345", telegramEnabled: true }, db, fetcher);
  assert.equal(state.settings.botUsername, "campus_test_bot");
  assert.equal(state.settings.telegramConfigured, true);
  assert.ok(!JSON.stringify(state).includes(token));
  state = await saveSettings({ telegramToken: "", telegramChatId: "12345", telegramEnabled: false }, db, fetcher);
  assert.equal(state.settings.telegramConfigured, true);
  assert.equal(state.settings.telegramEnabled, false);
  const failFetcher: typeof fetch = async () => { throw new Error(`secret URL ${token}`); };
  let error: unknown;
  try { await saveSettings({ telegramToken: token, telegramChatId: "12345", telegramEnabled: true }, db, failFetcher); } catch (caught) { error = caught; }
  const response = await apiError(error).json() as { error: string };
  assert.ok(!response.error.includes(token));
});

test("mutations reject foreign and null browser origins", () => {
  assert.throws(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/events", { headers: { origin: "https://foreign.example" } })));
  assert.throws(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/events", { headers: { origin: "null" } })));
  assert.throws(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/events", { headers: { "sec-fetch-site": "cross-site" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/events", { headers: { origin: "http://127.0.0.1:3000" } })));
});

test("same-origin checks accept the APP_URL host behind a proxy and nothing else", (t) => {
  const previous = process.env.APP_URL;
  t.after(() => { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; });
  const internal = "http://0.0.0.0:3000/api/events";
  delete process.env.APP_URL;
  assert.throws(() => assertSameOrigin(new Request(internal, { headers: { host: "knowverse.net", origin: "https://knowverse.net" } })));
  process.env.APP_URL = "https://knowverse.net";
  assert.doesNotThrow(() => assertSameOrigin(new Request(internal, { headers: { host: "knowverse.net", origin: "https://knowverse.net", "sec-fetch-site": "same-origin" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request(internal, { headers: { host: "KnowVerse.net", origin: "https://knowverse.net" } })));
  assert.throws(() => assertSameOrigin(new Request(internal, { headers: { host: "knowverse.net", origin: "http://knowverse.net" } })));
  assert.throws(() => assertSameOrigin(new Request(internal, { headers: { host: "knowverse.net", origin: "https://foreign.example" } })));
  assert.throws(() => assertSameOrigin(new Request(internal, { headers: { host: "knowverse.net", "sec-fetch-site": "cross-site" } })));
  assert.throws(() => assertSameOrigin(new Request(internal, { headers: { host: "knowverse.net.foreign.example", origin: "https://knowverse.net.foreign.example" } })));
  assert.throws(() => assertSameOrigin(new Request(internal, { headers: { host: "foreign@knowverse.net", origin: "https://knowverse.net" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })));
});

test("same-origin checks use the received loopback Host when Next rewrites its internal URL", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/events", { headers: { host: "localhost:3000", origin: "http://localhost:3000" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "[::1]:3000", origin: "http://[::1]:3000" } })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3001" } })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "foreign.example:3000", origin: "http://foreign.example:3000" } })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "foreign.example@127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "127.0.0.1:3000/extra", origin: "http://127.0.0.1:3000" } })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost:3000/api/events", { headers: { host: "127.0.0.1:3000", origin: "https://foreign.example", "x-forwarded-host": "foreign.example" } })));
});
