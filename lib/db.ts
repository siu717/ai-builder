import { createClient, type Client } from "@libsql/client";
import { existsSync } from "node:fs";
import { chmod, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ANONYMOUS_COOKIE_NAME, closeAnonymousDatabases, getAnonymousDatabase, isAnonymousPublicMode, validateAnonymousSession } from "./anonymous-session";
import { RouteError } from "./http";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS campus_profile (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS campus_settings (id INTEGER PRIMARY KEY CHECK(id = 1), token TEXT NOT NULL DEFAULT '', chat_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0, bot_username TEXT, worker_last_seen TEXT, anthropic_api_key TEXT NOT NULL DEFAULT '', data_go_kr_api_key TEXT NOT NULL DEFAULT '', saramin_api_key TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS campus_events (id TEXT PRIMARY KEY, value TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, idempotency_key TEXT UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS campus_reminders (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, scheduled_at TEXT NOT NULL, channel TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, sent_at TEXT, is_read INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, lease_until TEXT, claimed_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS campus_reminders_due ON campus_reminders(status, scheduled_at, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS campus_reminders_event ON campus_reminders(event_id)`,
  `INSERT OR IGNORE INTO campus_settings(id) VALUES (1)`,
  // 국민대 장학공지: 자동 등록 규칙과 등록 이력은 방문자별, 수집한 공지는 공용 DB에 둔다.
  `CREATE TABLE IF NOT EXISTS scholarship_preferences (id INTEGER PRIMARY KEY CHECK(id = 1), enabled INTEGER NOT NULL DEFAULT 0, keywords TEXT NOT NULL DEFAULT '')`,
  `INSERT OR IGNORE INTO scholarship_preferences(id) VALUES (1)`,
  `CREATE TABLE IF NOT EXISTS scholarship_imports (notice_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, content_hash TEXT NOT NULL, ignored INTEGER NOT NULL DEFAULT 0)`,
];

const SHARED_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scholarship_notices (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, value TEXT NOT NULL, content_hash TEXT NOT NULL, collected_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS collection_state (source TEXT PRIMARY KEY, last_attempt TEXT, last_success TEXT, next_run TEXT, lease_until TEXT, lease_token TEXT, error TEXT, count INTEGER NOT NULL DEFAULT 0)`,
];

async function protectSidecars(path: string): Promise<void> {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await chmod(`${path}${suffix}`, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function createDatabase(databaseUrl: string): Promise<Client> {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a local SQLite file URL.");
  }
  const path = resolve(decodeURIComponent(databaseUrl.slice(5)));
  const createdDirectory = await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (createdDirectory) await chmod(dirname(path), 0o700);
  // SQLite derives new WAL/SHM modes from the main file when opening it.
  const file = await open(path, "a", 0o600);
  try {
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
  await protectSidecars(path);
  const client = createClient({ url: `file:${path}` });
  try {
    await client.execute("PRAGMA busy_timeout = 5000");
    await client.execute("PRAGMA journal_mode = WAL");
    await client.batch(SCHEMA, "write");
    const migration = await client.transaction("write");
    try {
      const columns = await migration.execute("PRAGMA table_info(campus_settings)");
      for (const name of ["anthropic_api_key", "data_go_kr_api_key", "saramin_api_key"]) {
        if (!columns.rows.some((column) => column.name === name)) {
          await migration.execute(`ALTER TABLE campus_settings ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
        }
      }
      await migration.commit();
    } finally {
      migration.close();
    }
    await protectSidecars(path);
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

let database: Promise<Client> | undefined;

export async function getDatabase(): Promise<Client> {
  if (isAnonymousPublicMode()) {
    const { cookies } = await import("next/headers");
    const session = await validateAnonymousSession((await cookies()).get(ANONYMOUS_COOKIE_NAME)?.value);
    if (!session) throw new RouteError(403, "방문자 세션이 필요합니다. 페이지를 새로고침해주세요.");
    return getAnonymousDatabase(session);
  }
  return getSharedDatabase();
}

export async function createSharedDatabase(databaseUrl: string): Promise<Client> {
  const client = await createDatabase(databaseUrl);
  try {
    await client.batch(SHARED_SCHEMA, "write");
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

// 방문자와 무관한 데이터(수집한 학교 공지)를 담는 DB. 비밀번호 보호 모드에서는 개인 DB와 같다.
export function getSharedDatabase(): Promise<Client> {
  const databaseUrl = process.env.DATABASE_URL || "file:data/campus.db";
  // 운영 서버는 DATABASE_REQUIRE_EXISTING=1로 경로가 바뀌었을 때 빈 DB를 만들어 설정이 사라진 것처럼 보이지 않게 한다.
  if (!database && process.env.DATABASE_REQUIRE_EXISTING === "1" && databaseUrl.startsWith("file:")
    && !existsSync(resolve(decodeURIComponent(databaseUrl.slice(5))))) {
    return Promise.reject(new Error(`DB 파일이 없습니다 (${databaseUrl}). 저장된 설정을 지키기 위해 빈 DB를 만들지 않습니다.`));
  }
  database ??= createSharedDatabase(databaseUrl).catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (database) (await database).close();
  database = undefined;
  await closeAnonymousDatabases();
}
