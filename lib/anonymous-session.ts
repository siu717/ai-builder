import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Client } from "@libsql/client";
import { RouteError } from "./http";
import type { ReminderWorkerOptions } from "./reminder-worker";

export const ANONYMOUS_COOKIE_NAME = "campus_guest";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_SESSIONS = 200;
const SESSION_PATTERN = /^([a-f0-9]{64})\.(\d{13})\.([a-f0-9]{64})$/;
const SESSION_FILE_PATTERN = /^([a-f0-9]{64})\.session$/;

export interface AnonymousSession {
  id: string;
  expiresAt: number;
}

export function isAnonymousPublicMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.PUBLIC_ACCESS_MODE === "anonymous";
}

function sessionDirectory(): string {
  return resolve(/* turbopackIgnore: true */ process.env.PUBLIC_SESSION_DIR || "data/public-sessions");
}

async function privateDirectory(): Promise<string> {
  const directory = sessionDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await stat(/* turbopackIgnore: true */ directory);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) {
    throw new RouteError(503, "공개 방문자 저장소의 권한을 확인해주세요.");
  }
  return directory;
}

const secrets = new Map<string, Promise<Buffer>>();

async function loadSecret(directory: string): Promise<Buffer> {
  const path = join(directory, ".session-secret");
  try {
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(randomBytes(32));
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Another process may still be finishing its exclusive creation.
  for (let attempt = 0; attempt < 20; attempt++) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o077) !== 0) throw new RouteError(503, "방문자 인증 저장소의 권한을 확인해주세요.");
      const secret = await file.readFile();
      if (secret.length === 32) return secret;
    } finally {
      await file.close();
    }
    await new Promise((finish) => setTimeout(finish, 10));
  }
  throw new RouteError(503, "방문자 인증 저장소를 준비하지 못했습니다.");
}

async function signingSecret(): Promise<Buffer> {
  const directory = await privateDirectory();
  let secret = secrets.get(directory);
  if (!secret) {
    secret = loadSecret(directory);
    secrets.set(directory, secret);
    secret.catch(() => secrets.delete(directory));
  }
  return secret;
}

async function signSession(session: AnonymousSession): Promise<string> {
  const payload = `${session.id}.${session.expiresAt}`;
  const signature = createHmac("sha256", await signingSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export async function validateAnonymousSession(value: string | undefined, now = new Date()): Promise<AnonymousSession | null> {
  const match = value?.match(SESSION_PATTERN);
  if (!match) return null;
  const session = { id: match[1], expiresAt: Number(match[2]) };
  if (session.expiresAt <= now.getTime() || session.expiresAt > now.getTime() + SESSION_TTL_SECONDS * 1000) return null;
  const expected = (await signSession(session)).split(".")[2];
  if (!timingSafeEqual(Buffer.from(match[3], "hex"), Buffer.from(expected, "hex"))) return null;
  return session;
}

async function storedSession(directory: string, id: string, now: Date): Promise<AnonymousSession | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  try {
    const value = await readFile(join(directory, `${id}.session`), "utf8");
    const session = await validateAnonymousSession(value, now);
    return session?.id === id ? session : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

interface CachedDatabase {
  client: Promise<Client>;
  expiresAt: number;
}

const databases = new Map<string, CachedDatabase>();

async function removeSession(directory: string, id: string): Promise<void> {
  const path = join(directory, `${id}.db`);
  const cached = databases.get(path);
  databases.delete(path);
  if (cached) (await cached.client.catch(() => null))?.close();
  for (const suffix of [".db", ".db-wal", ".db-shm", ".session"]) {
    await rm(join(/* turbopackIgnore: true */ directory, `${id}${suffix}`), { force: true });
  }
}

async function activeSessions(directory: string, now: Date): Promise<AnonymousSession[]> {
  const active: AnonymousSession[] = [];
  for (const file of await readdir(directory)) {
    const match = file.match(SESSION_FILE_PATTERN);
    if (!match) continue;
    const session = await storedSession(directory, match[1], now);
    if (session) active.push(session);
    else await removeSession(directory, match[1]);
  }
  return active;
}

async function allocationLock(directory: string): Promise<() => Promise<void>> {
  const path = join(directory, ".allocation-lock");
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(path, { mode: 0o700 });
      return () => rm(path, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 60_000) await rm(path, { recursive: true, force: true });
      else await new Promise((finish) => setTimeout(finish, 20));
    }
  }
  throw new RouteError(503, "방문자 저장소가 사용 중입니다. 잠시 후 다시 시도해주세요.");
}

export async function resolveAnonymousSession(cookieValue?: string, now = new Date()): Promise<{ value: string; session: AnonymousSession; fresh: boolean }> {
  const directory = await privateDirectory();
  const incoming = await validateAnonymousSession(cookieValue, now);
  if (incoming) {
    const stored = await storedSession(directory, incoming.id, now);
    if (stored?.expiresAt === incoming.expiresAt) return { value: cookieValue!, session: incoming, fresh: false };
  }
  const unlock = await allocationLock(directory);
  try {
    if ((await activeSessions(directory, now)).length >= MAX_SESSIONS) {
      throw new RouteError(503, "현재 공개 방문자 한도에 도달했습니다. 잠시 후 다시 방문해주세요.");
    }
    const session = { id: randomBytes(32).toString("hex"), expiresAt: now.getTime() + SESSION_TTL_SECONDS * 1000 };
    const value = await signSession(session);
    const file = await open(join(directory, `${session.id}.session`), "wx", 0o600);
    try {
      await file.writeFile(value);
      await file.sync();
    } finally {
      await file.close();
    }
    return { value, session, fresh: true };
  } finally {
    await unlock();
  }
}

export async function getAnonymousDatabase(session: AnonymousSession): Promise<Client> {
  const directory = await privateDirectory();
  const stored = await storedSession(directory, session.id, new Date());
  if (!stored || stored.expiresAt !== session.expiresAt) throw new RouteError(403, "방문자 세션이 만료되었습니다. 페이지를 새로고침해주세요.");
  const path = join(directory, `${session.id}.db`);
  let cached = databases.get(path);
  if (!cached) {
    for (const [existingPath, entry] of databases) {
      if (entry.expiresAt <= Date.now()) {
        databases.delete(existingPath);
        (await entry.client.catch(() => null))?.close();
      }
    }
    if (databases.size >= MAX_SESSIONS) throw new RouteError(503, "방문자 저장소가 사용 중입니다. 잠시 후 다시 시도해주세요.");
    const client = import("./db").then(({ createDatabase }) => createDatabase(`file:${path}`));
    cached = { client, expiresAt: session.expiresAt };
    databases.set(path, cached);
    client.catch(() => databases.delete(path));
  }
  return cached.client;
}

export async function processAnonymousReminders(options: Omit<ReminderWorkerOptions, "database"> = {}) {
  if (!isAnonymousPublicMode()) throw new RouteError(403, "공개 방문자 모드가 아닙니다.");
  const directory = await privateDirectory();
  const now = options.now || new Date();
  const unlock = await allocationLock(directory);
  let sessions: AnonymousSession[];
  try {
    sessions = await activeSessions(directory, now);
  } finally {
    await unlock();
  }
  const { processDueReminders } = await import("./reminder-worker");
  const totals = { processed: 0, sent: 0, failed: 0 };
  for (const session of sessions) {
    if (!options.now && session.expiresAt <= Date.now()) continue;
    try {
      const database = await getAnonymousDatabase(session);
      const fetcher: typeof fetch = async (input, init) => {
        if (session.expiresAt <= (options.now?.getTime() ?? Date.now())) throw new RouteError(403, "방문자 세션이 만료되었습니다.");
        return (options.fetcher || fetch)(input, init);
      };
      const result = await processDueReminders({ ...options, database, fetcher });
      totals.processed += result.processed;
      totals.sent += result.sent;
      totals.failed += result.failed;
    } catch {
      // One unavailable guest database must not stop reminders for other visitors.
      totals.failed++;
    }
  }
  return totals;
}

// 방문자 DB마다 같은 작업을 실행한다. 한 방문자의 실패가 다른 방문자 처리를 막지 않는다.
export async function forEachAnonymousDatabase(action: (database: Client) => Promise<unknown>, now = new Date()): Promise<{ processed: number; failed: number }> {
  if (!isAnonymousPublicMode()) throw new RouteError(403, "공개 방문자 모드가 아닙니다.");
  const directory = await privateDirectory();
  const unlock = await allocationLock(directory);
  let sessions: AnonymousSession[];
  try {
    sessions = await activeSessions(directory, now);
  } finally {
    await unlock();
  }
  const totals = { processed: 0, failed: 0 };
  for (const session of sessions) {
    if (session.expiresAt <= Date.now()) continue;
    try {
      await action(await getAnonymousDatabase(session));
      totals.processed++;
    } catch {
      totals.failed++;
    }
  }
  return totals;
}

export async function closeAnonymousDatabases(): Promise<void> {
  const pending = [...databases.values()];
  databases.clear();
  for (const entry of pending) (await entry.client.catch(() => null))?.close();
}
