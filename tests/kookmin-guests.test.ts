import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closeAnonymousDatabases, forEachAnonymousDatabase, getAnonymousDatabase, resolveAnonymousSession } from "../lib/anonymous-session";
import { createDatabase } from "../lib/db";
import { parseScholarship, saveScholarshipPreferences, syncScholarshipEvents } from "../lib/scholarships";
import { createEvent, getState, saveSettings, testTelegram } from "../lib/store";

const url = "https://www.kookmin.ac.kr/user/kmuNews/notice/7/12345/view.do";
const html = `<div class="board_view"><p class="view_tit">소프트웨어 생활비 장학금</p><div class="board_etc">작성일 2026.10.01</div><div class="view_inner"><p>신청기간: 2026.10.01.(목) ~ 2099.10.15.(목) 18:00</p></div></div>`;

test("automatic registration runs for each guest that enabled it and no one else", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-kookmin-guests-"));
  const previous = { ...process.env };
  t.after(async () => {
    await closeAnonymousDatabases();
    process.env = previous;
    await rm(directory, { recursive: true, force: true });
  });
  process.env.PUBLIC_ACCESS_MODE = "anonymous";
  process.env.PUBLIC_SESSION_DIR = directory;
  const now = new Date();
  const first = await getAnonymousDatabase((await resolveAnonymousSession(undefined, now)).session);
  const second = await getAnonymousDatabase((await resolveAnonymousSession(undefined, now)).session);
  await saveScholarshipPreferences({ enabled: true, keywords: "생활비" }, first);
  const notice = parseScholarship(html, url, now);

  const totals = await forEachAnonymousDatabase((database) => syncScholarshipEvents([notice], database, now));
  assert.deepEqual(totals, { processed: 2, failed: 0 });
  const created = (await getState(first)).events;
  assert.equal(created.length, 1);
  assert.equal(created[0].date, "2099-10-15");
  assert.equal(created[0].time, "18:00");
  assert.equal((await getState(second)).events.length, 0);

  await forEachAnonymousDatabase((database) => syncScholarshipEvents([notice], database, now));
  assert.equal((await getState(first)).events.length, 1, "repeated worker passes do not duplicate events");
});

test("the Telegram test sends the nearest open event in the real reminder format", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-telegram-test-"));
  const db = await createDatabase(`file:${join(directory, "campus.db")}`);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const verify: typeof fetch = async () => Response.json({ ok: true, result: { username: "demo_bot" } });
  await saveSettings({ telegramToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ", telegramChatId: "42", telegramEnabled: false }, db, verify);
  const base = { kind: "scholarship" as const, notes: "재학증명서 준비", source: "", isSample: false, reminders: [] };
  await createEvent({ ...base, title: "나중 마감", date: "2099-12-01", time: null }, db);
  await createEvent({ ...base, title: "가까운 마감", date: "2099-11-01", time: "18:00" }, db);

  const sent: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    sent.push(String(JSON.parse(String(init?.body)).text));
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  const result = await testTelegram(db, fetcher);
  assert.match(result.message, /가까운 마감/);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^\[테스트 알림\]/);
  assert.match(sent[0], /가까운 마감\n마감: 2099-11-01 18:00 \(한국 시간\)/);
  assert.equal((await getState(db)).notifications.length, 0, "a test send does not create reminder records");
});
