import { createClient, type Client } from "@libsql/client";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS campus_profile (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS campus_settings (id INTEGER PRIMARY KEY CHECK(id = 1), token TEXT NOT NULL DEFAULT '', chat_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, bot_username TEXT, worker_last_seen TEXT)`,
  `CREATE TABLE IF NOT EXISTS campus_events (id TEXT PRIMARY KEY, value TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, idempotency_key TEXT UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS campus_reminders (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, scheduled_at TEXT NOT NULL, channel TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, sent_at TEXT, is_read INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, lease_until TEXT, claimed_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS campus_reminders_due ON campus_reminders(status, scheduled_at, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS campus_reminders_event ON campus_reminders(event_id)`,
  `INSERT OR IGNORE INTO campus_settings(id) VALUES (1)`,
  `CREATE TABLE IF NOT EXISTS campus_sources (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '', auto_add INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_synced_at TEXT, last_error TEXT, last_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS campus_imports (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, external_id TEXT NOT NULL, value TEXT NOT NULL, date TEXT, dismissed INTEGER NOT NULL DEFAULT 0, first_seen_at TEXT NOT NULL, added_at TEXT, UNIQUE(source_id, external_id))`,
  `CREATE INDEX IF NOT EXISTS campus_imports_date ON campus_imports(date)`,
];

export async function createDatabase(databaseUrl: string): Promise<Client> {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a local SQLite file URL.");
  }
  const path = resolve(decodeURIComponent(databaseUrl.slice(5)));
  const createdDirectory = await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (createdDirectory) await chmod(dirname(path), 0o700);
  const client = createClient({ url: `file:${path}` });
  try {
    await client.execute("PRAGMA busy_timeout = 5000");
    await client.execute("PRAGMA journal_mode = WAL");
    await client.batch(SCHEMA, "write");
    await chmod(path, 0o600);
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

let database: Promise<Client> | undefined;

export function getDatabase(): Promise<Client> {
  database ??= createDatabase(process.env.DATABASE_URL || "file:data/campus.db");
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (database) (await database).close();
  database = undefined;
}
