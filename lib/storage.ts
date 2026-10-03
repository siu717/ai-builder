import type { Client } from "@libsql/client";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isAnonymousPublicMode } from "./anonymous-session";
import type { BackupFile, StorageOverview } from "./contracts";
import { getDatabase, getSharedDatabase } from "./db";
import { RouteError } from "./http";
import { getProfile } from "./store";

// 자동 백업은 6시간마다 만들고 최근 28개(약 7일)만 남긴다. 수동·배포 전 백업은 지우지 않는다.
export const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60_000;
export const AUTO_BACKUP_KEEP = 28;
const AUTO_PREFIX = "auto-";

export function databaseFilePath(databaseUrl = process.env.DATABASE_URL || "file:data/campus.db"): string {
  if (!databaseUrl.startsWith("file:")) throw new Error("DATABASE_URL must be a local SQLite file URL.");
  return resolve(decodeURIComponent(databaseUrl.slice(5)));
}

export function backupDirectory(databasePath = databaseFilePath()): string {
  return join(dirname(databasePath), "backups");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "").replace("T", "-");
}

export async function listBackups(directory = backupDirectory()): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(names.filter((name) => name.endsWith(".db")).map(async (name) => {
    const info = await stat(join(directory, name));
    return { name, createdAt: info.mtime.toISOString(), sizeBytes: info.size, automatic: name.startsWith(AUTO_PREFIX) };
  }));
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

// VACUUM INTO는 쓰기 중에도 일관된 스냅샷을 새 파일로 만든다. 원본 DB는 건드리지 않는다.
export async function backupDatabase(database: Client, kind: "auto" | "manual", now = new Date(), directory = backupDirectory()): Promise<BackupFile> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let target = join(directory, `${kind}-${stamp(now)}.db`);
  for (let suffix = 2; existsSync(target); suffix += 1) target = join(directory, `${kind}-${stamp(now)}-${suffix}.db`);
  await database.execute({ sql: "VACUUM INTO ?", args: [target] });
  await chmod(target, 0o600);
  if (kind === "auto") await pruneAutomaticBackups(directory);
  const info = await stat(target);
  return { name: basename(target), createdAt: info.mtime.toISOString(), sizeBytes: info.size, automatic: kind === "auto" };
}

async function pruneAutomaticBackups(directory: string, keep = AUTO_BACKUP_KEEP): Promise<void> {
  const automatic = (await listBackups(directory)).filter((file) => file.automatic);
  for (const file of automatic.slice(keep)) await unlink(join(directory, file.name));
}

export async function backupIfDue(database: Client, now = new Date(), directory = backupDirectory()): Promise<BackupFile | null> {
  const latest = (await listBackups(directory)).find((file) => file.automatic);
  if (latest && now.getTime() - new Date(latest.createdAt).getTime() < AUTO_BACKUP_INTERVAL_MS) return null;
  return backupDatabase(database, "auto", now, directory);
}

export function maskSecret(value: string): string | null {
  const secret = value.trim();
  if (!secret) return null;
  return secret.length <= 10 ? "••••" : `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

async function count(database: Client, sql: string): Promise<number> {
  return Number((await database.execute(sql)).rows[0]?.count ?? 0);
}

export async function getStorageOverview(database?: Client): Promise<StorageOverview> {
  const db = database || await getDatabase();
  const anonymous = isAnonymousPublicMode();
  const settings = (await db.execute("SELECT * FROM campus_settings WHERE id = 1")).rows[0] || {};
  const saved = (column: string) => maskSecret(String(settings[column] || ""));
  const shared = anonymous ? await getSharedDatabase() : db;
  const path = anonymous ? null : databaseFilePath();
  const file = path && existsSync(path) ? await stat(path) : null;
  const backups = anonymous ? [] : await listBackups();
  return {
    accessMode: anonymous ? "anonymous" : "private",
    database: {
      path,
      sizeBytes: file?.size ?? null,
      modifiedAt: file?.mtime.toISOString() ?? null,
    },
    keys: {
      anthropic: saved("anthropic_api_key"),
      dataGoKr: saved("data_go_kr_api_key"),
      saramin: saved("saramin_api_key"),
      telegramToken: saved("token"),
    },
    telegram: {
      chatId: String(settings.chat_id || ""),
      enabled: Boolean(settings.enabled),
      botUsername: settings.bot_username ? String(settings.bot_username) : null,
    },
    profile: await getProfile(db),
    counts: {
      events: await count(db, "SELECT COUNT(*) AS count FROM campus_events"),
      reminders: await count(db, "SELECT COUNT(*) AS count FROM campus_reminders"),
      sentReminders: await count(db, "SELECT COUNT(*) AS count FROM campus_reminders WHERE status = 'sent'"),
      scholarshipNotices: await count(shared, "SELECT COUNT(*) AS count FROM scholarship_notices"),
    },
    backups: {
      directory: anonymous ? null : backupDirectory(),
      intervalHours: AUTO_BACKUP_INTERVAL_MS / 3_600_000,
      keep: AUTO_BACKUP_KEEP,
      latest: backups.slice(0, 8),
      total: backups.length,
    },
  };
}

export async function createManualBackup(now = new Date()): Promise<StorageOverview> {
  if (isAnonymousPublicMode()) throw new RouteError(409, "방문자별 저장 모드에서는 서버 백업을 만들 수 없습니다.");
  const database = await getSharedDatabase();
  await backupDatabase(database, "manual", now);
  return getStorageOverview(database);
}
