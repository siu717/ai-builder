import assert from "node:assert/strict";
import { createClient, type Client } from "@libsql/client";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DELETE, PUT } from "../app/api/settings/ai/route";
import { closeDatabase, createDatabase } from "../lib/db";
import { deleteAnthropicApiKey, getAnthropicApiKey, getState, saveAnthropicApiKey } from "../lib/store";
import { apiError } from "../lib/http";
import { aiSettingsSchema } from "../lib/validation";

const savedKey = "sk-ant-test-saved-sensitive-001";
const environmentKey = "sk-ant-test-environment-sensitive-002";

function withEnvironment(t: TestContext, name: string, value: string | undefined) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-ai-settings-"));
  const path = join(directory, "private", "campus.db");
  const db = await createDatabase(`file:${path}`);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  return { db, path };
}

test("saved API keys persist across SQLite reopen without appearing in public state", async (t) => {
  withEnvironment(t, "ANTHROPIC_API_KEY", undefined);
  const { db, path } = await fixture(t);
  const state = await saveAnthropicApiKey({ apiKey: `  ${savedKey}  ` }, db);
  assert.equal(state.settings.aiConfigured, true);
  assert.equal(state.settings.aiKeySource, "saved");
  assert.equal(await getAnthropicApiKey(db), savedKey);
  assert.ok(!JSON.stringify(state).includes(savedKey));
  assert.ok(!JSON.stringify(state).includes("sensitive-001"));
  assert.ok(!("apiKey" in state.settings));
  assert.ok(!("anthropicApiKey" in state.settings));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const reopened = await createDatabase(`file:${path}`);
  t.after(() => reopened.close());
  assert.equal(await getAnthropicApiKey(reopened), savedKey);
  assert.equal((await getState(reopened)).settings.aiKeySource, "saved");
});

test("saved keys override the trimmed environment, and deleting restores the fallback", async (t) => {
  withEnvironment(t, "ANTHROPIC_API_KEY", `  ${environmentKey}\n`);
  const { db } = await fixture(t);
  assert.equal(await getAnthropicApiKey(db), environmentKey);
  assert.equal((await getState(db)).settings.aiKeySource, "environment");
  await saveAnthropicApiKey({ apiKey: savedKey }, db);
  assert.equal(await getAnthropicApiKey(db), savedKey);
  const cleared = await deleteAnthropicApiKey(db);
  assert.equal(await getAnthropicApiKey(db), environmentKey);
  assert.equal(cleared.settings.aiKeySource, "environment");
  assert.equal(cleared.settings.aiConfigured, true);
  assert.ok(!JSON.stringify(cleared).includes(environmentKey));
  process.env.ANTHROPIC_API_KEY = " \n ";
  const unconfigured = await deleteAnthropicApiKey(db);
  assert.equal(await getAnthropicApiKey(db), "");
  assert.equal(unconfigured.settings.aiConfigured, false);
  assert.equal(unconfigured.settings.aiKeySource, null);
});

test("blank, excessive, whitespace and control-character saves reject and preserve the saved key", async (t) => {
  const { db } = await fixture(t);
  await saveAnthropicApiKey({ apiKey: savedKey }, db);
  const invalid: unknown[] = [
    { apiKey: "" }, { apiKey: " \n\t " }, { apiKey: "x".repeat(4097) },
    { apiKey: "sk-ant-test invalid" }, { apiKey: "sk-ant-test\ninvalid" },
    { apiKey: "sk-ant-test\u0000invalid" }, { apiKey: "sk-ant-test\u0085invalid" },
    { apiKey: savedKey, unexpected: true }, { apiKey: 123 }, {},
  ];
  for (const input of invalid) {
    let caught: unknown;
    try { await saveAnthropicApiKey(input, db); } catch (error) { caught = error; }
    assert.ok(caught);
    const response = apiError(caught);
    assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes(savedKey));
    assert.equal(await getAnthropicApiKey(db), savedKey);
  }
  assert.equal(aiSettingsSchema.parse({ apiKey: `sk-ant-${"x".repeat(4089)}` }).apiKey.length, 4096);
  assert.equal(aiSettingsSchema.parse({ apiKey: "sk-proj-openai-style-key" }).apiKey, "sk-proj-openai-style-key");
  assert.throws(() => aiSettingsSchema.parse({ apiKey: "AIza-not-supported" }), /OpenAI/);
});

test("legacy databases migrate once under concurrent initialization and preserve Telegram settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-ai-migration-"));
  const path = join(directory, "campus.db");
  const connections: Client[] = [];
  t.after(async () => { for (const db of connections) db.close(); await rm(directory, { recursive: true, force: true }); });
  const legacy = createClient({ url: `file:${path}` });
  await legacy.execute("CREATE TABLE campus_settings (id INTEGER PRIMARY KEY CHECK(id = 1), token TEXT NOT NULL DEFAULT '', chat_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, bot_username TEXT, worker_last_seen TEXT)");
  await legacy.execute("INSERT INTO campus_settings(id, token, chat_id, enabled, bot_username) VALUES(1, 'existing-telegram-token', '1234', 1, 'existing_bot')");
  legacy.close();
  const [first, second] = await Promise.all([createDatabase(`file:${path}`), createDatabase(`file:${path}`)]);
  connections.push(first, second);
  const columns = await first.execute("PRAGMA table_info(campus_settings)");
  assert.equal(columns.rows.filter((column) => column.name === "anthropic_api_key").length, 1);
  const retained = (await first.execute("SELECT token, chat_id, enabled, bot_username, anthropic_api_key FROM campus_settings WHERE id = 1")).rows[0];
  assert.equal(retained.token, "existing-telegram-token");
  assert.equal(retained.chat_id, "1234");
  assert.equal(retained.enabled, 1);
  assert.equal(retained.bot_username, "existing_bot");
  assert.equal(retained.anthropic_api_key, "");
  await saveAnthropicApiKey({ apiKey: savedKey }, first);
  const reopened = await createDatabase(`file:${path}`);
  connections.push(reopened);
  assert.equal(await getAnthropicApiKey(reopened), savedKey);
});

test("existing shared directories retain their mode while old SQLite files and recreated sidecars stay private", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-ai-permissions-"));
  await chmod(directory, 0o755);
  const path = join(directory, "campus.db");
  const legacy = createClient({ url: `file:${path}` });
  const connections: Client[] = [legacy];
  t.after(async () => { for (const db of connections) db.close(); await rm(directory, { recursive: true, force: true }); });
  await legacy.execute("PRAGMA journal_mode = WAL");
  await legacy.execute("CREATE TABLE existing_data (value TEXT NOT NULL)");
  await legacy.execute("INSERT INTO existing_data(value) VALUES ('preserve this row')");
  for (const file of [path, `${path}-wal`, `${path}-shm`]) await chmod(file, 0o644);

  const secured = await createDatabase(`file:${path}`);
  connections.push(secured);
  await saveAnthropicApiKey({ apiKey: savedKey }, secured);
  for (const file of [path, `${path}-wal`, `${path}-shm`]) assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o755);
  assert.equal((await secured.execute("SELECT value FROM existing_data")).rows[0].value, "preserve this row");
  legacy.close();
  secured.close();

  const reopened = await createDatabase(`file:${path}`);
  connections.push(reopened);
  assert.equal(await getAnthropicApiKey(reopened), savedKey);
  for (const file of [path, `${path}-wal`, `${path}-shm`]) assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o755);
});

test("new SQLite WAL and SHM inherit private permissions in an existing public directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-ai-new-permissions-"));
  await chmod(directory, 0o755);
  const path = join(directory, "campus.db");
  const db = await createDatabase(`file:${path}`);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  await saveAnthropicApiKey({ apiKey: savedKey }, db);
  for (const file of [path, `${path}-wal`, `${path}-shm`]) assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o755);
});

test("AI settings routes require same-origin JSON, redact responses and delete without a body", async (t) => {
  withEnvironment(t, "ANTHROPIC_API_KEY", undefined);
  const { db, path } = await fixture(t);
  withEnvironment(t, "DATABASE_URL", `file:${path}`);
  await closeDatabase();
  const request = (body: unknown, origin = "http://127.0.0.1:3000", contentType = "application/json") => new Request("http://localhost:3000/api/settings/ai", {
    method: "PUT",
    headers: { host: "127.0.0.1:3000", origin, "content-type": contentType },
    body: JSON.stringify(body),
  });
  try {
    const forbidden = await PUT(request({ apiKey: savedKey }, "https://foreign.example"));
    assert.equal(forbidden.status, 403);
    assert.equal(await getAnthropicApiKey(db), "");
    const wrongType = await PUT(request({ apiKey: savedKey }, "http://127.0.0.1:3000", "text/plain"));
    assert.equal(wrongType.status, 415);
    const response = await PUT(request({ apiKey: savedKey }));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(savedKey));
    assert.ok(!text.includes("sensitive-001"));
    assert.equal(await getAnthropicApiKey(db), savedKey);
    const blank = await PUT(request({ apiKey: "" }));
    assert.equal(blank.status, 400);
    assert.equal(await getAnthropicApiKey(db), savedKey);
    const hostileDelete = await DELETE(new Request("http://localhost:3000/api/settings/ai", { method: "DELETE", headers: { host: "127.0.0.1:3000", origin: "null" } }));
    assert.equal(hostileDelete.status, 403);
    const cleared = await DELETE(new Request("http://localhost:3000/api/settings/ai", { method: "DELETE", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }));
    assert.equal(cleared.status, 200);
    assert.equal(await getAnthropicApiKey(db), "");
  } finally {
    await closeDatabase();
  }
});
