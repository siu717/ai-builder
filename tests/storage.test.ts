import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { GET, POST } from "../app/api/storage/route";
import { closeDatabase, createSharedDatabase, getSharedDatabase } from "../lib/db";
import { AUTO_BACKUP_KEEP, backupDatabase, backupIfDue, listBackups, maskSecret } from "../lib/storage";

async function temporary(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function withEnvironment(t: TestContext, name: string, value: string | undefined) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test("backups are consistent copies that keep saved settings, and only old automatic ones are pruned", async (t) => {
  const directory = await temporary(t);
  const database = await createSharedDatabase(`file:${join(directory, "campus.db")}`);
  t.after(() => database.close());
  await database.execute("UPDATE campus_settings SET anthropic_api_key = 'sk-ant-test-1234567890', chat_id = '777' WHERE id = 1");
  const backups = join(directory, "backups");

  const manual = await backupDatabase(database, "manual", new Date("2026-10-01T00:00:00Z"), backups);
  assert.equal(manual.automatic, false);
  assert.equal((await stat(join(backups, manual.name))).mode & 0o777, 0o600);
  const copy = createClient({ url: `file:${join(backups, manual.name)}` });
  const row = (await copy.execute("SELECT anthropic_api_key, chat_id FROM campus_settings")).rows[0];
  copy.close();
  assert.equal(row.anthropic_api_key, "sk-ant-test-1234567890");
  assert.equal(row.chat_id, "777");

  for (let index = 0; index < AUTO_BACKUP_KEEP + 3; index += 1) {
    const file = await backupDatabase(database, "auto", new Date(Date.UTC(2026, 9, 2, 0, index)), backups);
    const time = new Date(Date.UTC(2026, 9, 2, 0, index));
    await utimes(join(backups, file.name), time, time);
  }
  const files = await listBackups(backups);
  assert.equal(files.filter((file) => file.automatic).length, AUTO_BACKUP_KEEP);
  assert.ok(files.some((file) => file.name === manual.name), "manual backups are never pruned");
});

test("automatic backups run only when the latest one is older than the interval", async (t) => {
  const directory = await temporary(t);
  const database = await createSharedDatabase(`file:${join(directory, "campus.db")}`);
  t.after(() => database.close());
  const backups = join(directory, "backups");
  const first = await backupIfDue(database, new Date(), backups);
  assert.ok(first);
  assert.equal(await backupIfDue(database, new Date(Date.now() + 60 * 60_000), backups), null);
  assert.ok(await backupIfDue(database, new Date(Date.now() + 7 * 60 * 60_000), backups));
  assert.equal((await readdir(backups)).length, 2);
});

test("secrets are masked to their first and last four characters", () => {
  assert.equal(maskSecret(""), null);
  assert.equal(maskSecret("short"), "••••");
  assert.equal(maskSecret("sk-ant-api03-abcdefWXYZ"), "sk-a••••WXYZ");
});

test("the storage route shows saved values masked and creates a manual backup", async (t) => {
  const directory = await temporary(t);
  withEnvironment(t, "DATABASE_URL", `file:${join(directory, "campus.db")}`);
  withEnvironment(t, "PUBLIC_ACCESS_MODE", undefined);
  t.after(() => closeDatabase());
  const database = await getSharedDatabase();
  await database.execute("UPDATE campus_settings SET data_go_kr_api_key = 'abcd-secret-data-key-9876', token = '123456:telegram-secret-token', chat_id = '42', enabled = 1 WHERE id = 1");

  const overview = await (await GET()).json();
  assert.equal(overview.keys.dataGoKr, "abcd••••9876");
  assert.equal(overview.keys.anthropic, null);
  assert.equal(overview.keys.anthropicFormatValid, null);
  assert.equal(overview.telegram.chatId, "42");
  assert.equal(overview.telegram.enabled, true);
  assert.equal(overview.database.path, join(directory, "campus.db"));
  assert.ok(!JSON.stringify(overview).includes("secret"), "full secrets never leave the server");

  const forbidden = await POST(new Request("http://127.0.0.1:3000/api/storage", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "https://evil.example" } }));
  assert.equal(forbidden.status, 403);
  const created = await POST(new Request("http://127.0.0.1:3000/api/storage", { method: "POST", headers: { host: "127.0.0.1:3000" } }));
  assert.equal(created.status, 200);
  assert.equal((await created.json()).backups.total, 1);
});

test("a required database that is missing is never replaced by an empty one", async (t) => {
  const directory = await temporary(t);
  const path = join(directory, "public-demo.db");
  withEnvironment(t, "DATABASE_URL", `file:${path}`);
  withEnvironment(t, "DATABASE_REQUIRE_EXISTING", "1");
  t.after(() => closeDatabase());
  await assert.rejects(getSharedDatabase(), /빈 DB를 만들지 않습니다/);
  assert.equal(existsSync(path), false);

  await writeFile(path, "");
  assert.ok(await getSharedDatabase());
});
