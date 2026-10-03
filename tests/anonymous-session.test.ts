import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closeAnonymousDatabases, getAnonymousDatabase, processAnonymousReminders, resolveAnonymousSession, validateAnonymousSession } from "../lib/anonymous-session";
import { createEvent, getAnthropicApiKey, getState, saveAnthropicApiKey, saveSettings } from "../lib/store";

test("guest credentials stay isolated and expired sessions cannot dispatch reminders", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-guests-"));
  const previous = { ...process.env };
  t.after(async () => {
    await closeAnonymousDatabases();
    process.env = previous;
    await rm(directory, { recursive: true, force: true });
  });
  process.env.PUBLIC_ACCESS_MODE = "anonymous";
  process.env.PUBLIC_SESSION_DIR = directory;
  process.env.ANTHROPIC_API_KEY = "owner-ai-secret";
  process.env.TELEGRAM_BOT_TOKEN = "owner-bot-secret";
  process.env.TELEGRAM_CHAT_ID = "owner-chat";
  process.env.DATA_GO_KR_API_KEY = "owner-data-secret";
  process.env.SARAMIN_API_KEY = "owner-saramin-secret";
  const now = new Date();
  const first = await resolveAnonymousSession(undefined, now);
  const second = await resolveAnonymousSession(undefined, now);
  assert.notEqual(first.session.id, second.session.id);
  const changed = first.value.slice(0, -1) + (first.value.endsWith("0") ? "1" : "0");
  assert.equal(await validateAnonymousSession(changed, now), null);
  assert.equal((await resolveAnonymousSession(first.value, now)).fresh, false);
  const a = await getAnonymousDatabase(first.session);
  const b = await getAnonymousDatabase(second.session);
  const initial = await getState(a);
  assert.equal(initial.settings.aiConfigured, false);
  assert.equal(initial.settings.telegramChatId, "");
  assert.deepEqual(initial.settings.dataKeys, { dataGoKr: null, saramin: null });
  await saveAnthropicApiKey({ apiKey: "sk-ant-guest-ai-key" }, a);
  assert.equal(await getAnthropicApiKey(a), "sk-ant-guest-ai-key");
  assert.equal(await getAnthropicApiKey(b), "");
  const verify: typeof fetch = async () => Response.json({ ok: true, result: { username: "guest_bot" } });
  await saveSettings({ telegramToken: "123456:abcdefghijklmnopqrstuvwxy", telegramChatId: "12345", telegramEnabled: true }, a, verify);
  await createEvent({
    title: "Guest reminder", kind: "assignment", date: "2099-01-01", time: null,
    notes: "", source: "", isSample: false,
    reminders: [{ at: new Date(now.getTime() + 1000).toISOString(), channel: "telegram" }],
  }, a, now);
  const sentTo: string[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    sentTo.push(JSON.parse(String(init?.body)).chat_id);
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  await processAnonymousReminders({ now: new Date(now.getTime() + 2000), fetcher });
  assert.deepEqual(sentTo, ["12345"]);
  assert.equal((await getState(b)).notifications.length, 0);
  assert.equal((await stat(join(directory, ".session-secret"))).mode & 0o777, 0o600);
  await closeAnonymousDatabases();
  assert.equal(await getAnthropicApiKey(await getAnonymousDatabase(first.session)), "sk-ant-guest-ai-key");
  const expired = new Date(first.session.expiresAt + 1);
  assert.equal(await validateAnonymousSession(first.value, expired), null);
  await processAnonymousReminders({ now: expired, fetcher });
  assert.deepEqual(sentTo, ["12345"]);
  await assert.rejects(stat(join(directory, `${first.session.id}.db`)), { code: "ENOENT" });
});
