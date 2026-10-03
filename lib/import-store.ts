import { randomUUID } from "node:crypto";
import type { Client, Row } from "@libsql/client";
import { z } from "zod";
import { addCalendarDays, seoulToday } from "./catalog";
import { checklistFromDocuments, MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT_LENGTH } from "./checklist";
import { importEventKey, type AppState, type EventInput, type ImportCandidate, type ImportSource, type ImportState, type Profile, type ReminderInput } from "./contracts";
import { getDatabase } from "./db";
import { RouteError } from "./http";
import { deadlineFromDetail, discoverFeed, isFeed, matchesKeywords, parseBoard, parseFeed, type ImportedItem } from "./importers";
import { FETCHERS, PROVIDER_TYPES, PROVIDERS, profileMatches, profileTerms, providerConfigured, type ProviderType } from "./providers";
import { fetchPublicText, FetchError, normalizeFeedUrl, type TextFetcher } from "./safe-fetch";
import { createEvent, getPrivateSettings, getProfile } from "./store";

const MAX_SOURCES = 30;
const MAX_ITEMS_PER_SYNC = 300;
/** 한 번 수집할 때 자동 등록하는 최대 개수. 캘린더가 공고로 넘치지 않게 마감이 가까운 것부터 넣는다. */
const AUTO_ADD_PER_SYNC = 10;

const isProvider = (type: string): type is ProviderType => type in PROVIDERS;
const builtinId = (type: ProviderType) => `builtin-${type}`;

/** 사용자가 직접 추가하는 수집원은 학교·학과 공지 게시판뿐이다. */
export const sourceSchema = z.object({
  type: z.literal("rss"),
  name: z.string().trim().min(1, "수집원 이름을 입력해 주세요.").max(80),
  url: z.string().trim().max(2000),
  kind: z.enum(["scholarship", "job", "career", "assignment"]).optional(),
  keywords: z.string().trim().max(300),
  autoAdd: z.boolean(),
}).strict().superRefine((source, ctx) => {
  try {
    const url = new URL(normalizeFeedUrl(source.url));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    ctx.addIssue({ code: "custom", path: ["url"], message: "게시판 주소(http, https)를 확인해 주세요." });
  }
});

function sourceFromRow(row: Row): ImportSource {
  const type = String(row.type) as ImportSource["type"];
  return {
    id: String(row.id),
    type,
    builtin: isProvider(type),
    name: String(row.name),
    url: String(row.url),
    kind: String(row.kind) as ImportSource["kind"],
    keywords: String(row.keywords),
    autoAdd: Boolean(row.auto_add),
    enabled: Boolean(row.enabled),
    lastSyncedAt: row.last_synced_at == null ? null : String(row.last_synced_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    lastCount: Number(row.last_count),
  };
}

/** 서버에 키가 있는 기본 수집원을 켠다. 사용자가 꺼 둔 수집원은 그대로 둔다. */
export async function ensureBuiltinSources(db: Client, now = new Date()): Promise<void> {
  for (const type of PROVIDER_TYPES) {
    if (!providerConfigured(type)) continue;
    await db.execute({
      sql: "INSERT OR IGNORE INTO campus_sources(id, type, name, url, kind, keywords, auto_add, enabled, created_at) VALUES(?, ?, ?, '', ?, '', 1, 1, ?)",
      args: [builtinId(type), type, PROVIDERS[type].label, PROVIDERS[type].kind, now.toISOString()],
    });
  }
}

/** 프로필이 바뀌면 맞춤 검색어도 바뀌므로 기본 수집원을 다음 주기에 바로 다시 가져온다. */
export async function markBuiltinSourcesStale(database?: Client): Promise<void> {
  const db = database || await getDatabase();
  await db.execute("UPDATE campus_sources SET last_synced_at = NULL WHERE id LIKE 'builtin-%'");
}

async function candidates(db: Client, profile: Profile, now: Date, sourceId?: string): Promise<ImportCandidate[]> {
  const today = seoulToday(now);
  const sources = new Map((await db.execute("SELECT * FROM campus_sources")).rows.map((row) => [String(row.id), sourceFromRow(row)]));
  // 지난 마감과, 날짜 없이 한 달 넘게 남은 공지는 목록에서 내린다.
  const rows = await db.execute({
    sql: `SELECT * FROM campus_imports WHERE (date >= ? OR (date IS NULL AND first_seen_at >= ?))${sourceId ? " AND source_id = ?" : ""} ORDER BY date IS NULL, date, first_seen_at DESC LIMIT 2000`,
    args: [today, `${addCalendarDays(today, -30)}T00:00:00.000Z`, ...(sourceId ? [sourceId] : [])],
  });
  return rows.rows.flatMap((row) => {
    const source = sources.get(String(row.source_id));
    if (!source || (source.builtin && !providerConfigured(source.type as ProviderType))) return [];
    const value = JSON.parse(String(row.value)) as ImportedItem;
    return [{
      id: String(row.id), sourceId: source.id, sourceName: source.name,
      kind: value.kind, title: value.title, organization: value.organization,
      date: value.date, time: value.time, url: value.url, summary: value.summary,
      documents: value.documents, dateNote: value.dateNote,
      matched: profileMatches(value, profile),
      dismissed: Boolean(row.dismissed), firstSeenAt: String(row.first_seen_at),
    }];
  });
}

export async function getImportState(database?: Client, now = new Date()): Promise<ImportState> {
  const db = database || await getDatabase();
  await ensureBuiltinSources(db, now);
  const profile = await getProfile(db);
  const sources = (await db.execute("SELECT * FROM campus_sources ORDER BY id LIKE 'builtin-%' DESC, created_at, id")).rows.map(sourceFromRow)
    .filter((source) => !source.builtin || providerConfigured(source.type as ProviderType));
  return {
    sources,
    items: await candidates(db, profile, now),
    providers: PROVIDER_TYPES.map((type) => ({ type, label: PROVIDERS[type].label, env: PROVIDERS[type].env, signup: PROVIDERS[type].signup, configured: providerConfigured(type) })),
    profileTerms: profileTerms(profile),
  };
}

export async function createSource(input: unknown, database?: Client, now = new Date()): Promise<ImportSource> {
  const source = sourceSchema.parse(input);
  const db = database || await getDatabase();
  const count = Number((await db.execute("SELECT COUNT(*) AS count FROM campus_sources")).rows[0].count);
  if (count >= MAX_SOURCES) throw new RouteError(400, `수집원은 ${MAX_SOURCES}개까지 등록할 수 있습니다.`);
  const id = randomUUID();
  await db.execute({
    sql: "INSERT INTO campus_sources(id, type, name, url, kind, keywords, auto_add, enabled, created_at) VALUES(?, 'rss', ?, ?, ?, ?, ?, 1, ?)",
    args: [id, source.name, normalizeFeedUrl(source.url), source.kind || "scholarship", source.keywords, source.autoAdd ? 1 : 0, now.toISOString()],
  });
  return sourceFromRow((await db.execute({ sql: "SELECT * FROM campus_sources WHERE id = ?", args: [id] })).rows[0]);
}

export async function updateSource(id: string, input: unknown, database?: Client): Promise<void> {
  const patch = z.object({ autoAdd: z.boolean().optional(), enabled: z.boolean().optional(), keywords: z.string().trim().max(300).optional() }).strict().parse(input);
  const db = database || await getDatabase();
  const result = await db.execute({
    sql: "UPDATE campus_sources SET auto_add = COALESCE(?, auto_add), enabled = COALESCE(?, enabled), keywords = COALESCE(?, keywords) WHERE id = ?",
    args: [patch.autoAdd === undefined ? null : patch.autoAdd ? 1 : 0, patch.enabled === undefined ? null : patch.enabled ? 1 : 0, patch.keywords ?? null, id],
  });
  if (!result.rowsAffected) throw new RouteError(404, "수집원을 찾을 수 없습니다.");
}

/** 수집원을 지워도 이미 등록한 일정은 그대로 둔다. */
export async function deleteSource(id: string, database?: Client): Promise<void> {
  if (id.startsWith("builtin-")) throw new RouteError(400, "기본 수집원은 지울 수 없습니다. 끄기를 사용해 주세요.");
  const db = database || await getDatabase();
  const result = await db.execute({ sql: "DELETE FROM campus_sources WHERE id = ?", args: [id] });
  if (!result.rowsAffected) throw new RouteError(404, "수집원을 찾을 수 없습니다.");
  await db.execute({ sql: "DELETE FROM campus_imports WHERE source_id = ?", args: [id] });
}

async function collectBoard(source: ImportSource, fetcher: TextFetcher, today: string): Promise<ImportedItem[]> {
  const text = await fetcher(source.url);
  if (isFeed(text)) return parseFeed(text, source.kind, today);
  const feed = discoverFeed(text, source.url);
  // 사이트 전체 피드는 오래된 글만 담고 있을 수 있어, 비어 있으면 게시판 목록을 직접 읽는다.
  const fromFeed = feed ? await fetcher(feed).then((xml) => parseFeed(xml, source.kind, today)).catch(() => []) : [];
  if (fromFeed.length) return fromFeed;
  const items = parseBoard(text, source.url, source.kind, today);
  if (!items.length) throw new FetchError("이 주소에서 공지 목록을 찾지 못했습니다. 게시판 목록 페이지나 RSS 주소를 넣어 주세요.");
  return items;
}

/** 마감 하루 전 오전 9시, 이미 지났으면 당일 오전 9시에 알린다. */
export function defaultReminders(date: string, time: string | null, now: Date, telegram: boolean): ReminderInput[] {
  const deadline = new Date(`${date}T${time ? `${time}:00` : "23:59:59"}+09:00`).getTime();
  const at = [addCalendarDays(date, -1), date]
    .map((day) => new Date(`${day}T09:00:00+09:00`))
    .find((candidate) => candidate.getTime() > now.getTime() && candidate.getTime() < deadline);
  if (!at) return [];
  const iso = at.toISOString();
  return [{ at: iso, channel: "app" }, ...(telegram ? [{ at: iso, channel: "telegram" as const }] : [])];
}

function eventFromCandidate(candidate: ImportCandidate, now: Date, telegram: boolean): EventInput {
  if (!candidate.date) throw new RouteError(422, "마감 날짜를 찾지 못한 항목입니다. 일정 편집에서 날짜를 입력해 주세요.");
  const notes = [candidate.organization, candidate.summary, candidate.dateNote].filter(Boolean).join("\n\n");
  return {
    title: candidate.title,
    kind: candidate.kind,
    date: candidate.date,
    time: candidate.time,
    notes: notes.slice(0, 10000),
    source: [`자동 수집 · ${candidate.sourceName}`, candidate.url].filter(Boolean).join("\n").slice(0, 2000),
    isSample: false,
    reminders: defaultReminders(candidate.date, candidate.time, now, telegram),
    checklist: checklistFromDocuments(candidate.documents.map((text) => text.slice(0, MAX_CHECKLIST_TEXT_LENGTH))).slice(0, MAX_CHECKLIST_ITEMS),
    idempotencyKey: importEventKey(candidate.id),
  };
}

async function telegramReady(db: Client): Promise<boolean> {
  const settings = await getPrivateSettings(db);
  return settings.enabled && Boolean(settings.token && settings.chatId);
}

async function markAdded(db: Client, id: string, now: Date) {
  await db.execute({ sql: "UPDATE campus_imports SET added_at = COALESCE(added_at, ?) WHERE id = ?", args: [now.toISOString(), id] });
}

export async function addImportToCalendar(id: string, database?: Client, now = new Date()): Promise<AppState> {
  const db = database || await getDatabase();
  const candidate = (await candidates(db, await getProfile(db), now)).find((item) => item.id === id);
  if (!candidate) throw new RouteError(404, "수집 항목을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.");
  const state = await createEvent(eventFromCandidate(candidate, now, await telegramReady(db)), db, now);
  await markAdded(db, id, now);
  return state;
}

export async function setImportDismissed(id: string, dismissed: boolean, database?: Client): Promise<void> {
  const db = database || await getDatabase();
  const result = await db.execute({ sql: "UPDATE campus_imports SET dismissed = ? WHERE id = ?", args: [dismissed ? 1 : 0, id] });
  if (!result.rowsAffected) throw new RouteError(404, "수집 항목을 찾을 수 없습니다.");
}

const MAX_DETAIL_FETCHES = 20;

/** 처음 본 공지 중 마감이 없는 글만 본문을 열어 본다. 이미 본 글은 저장된 결과를 그대로 쓴다. */
async function enrich(items: ImportedItem[], source: ImportSource, db: Client, fetcher: TextFetcher, today: string): Promise<ImportedItem[]> {
  const stored = new Map((await db.execute({ sql: "SELECT external_id, value FROM campus_imports WHERE source_id = ?", args: [source.id] })).rows
    .map((row) => [String(row.external_id), JSON.parse(String(row.value)) as ImportedItem]));
  let fetched = 0;
  const result: ImportedItem[] = [];
  for (const item of items) {
    const previous = stored.get(item.externalId);
    if (previous) {
      result.push(item.date || !previous.date ? item : { ...item, date: previous.date, time: previous.time, dateNote: previous.dateNote, summary: previous.summary });
    } else if (!item.date && item.url && item.url !== source.url && fetched < MAX_DETAIL_FETCHES) {
      fetched++;
      result.push(await fetcher(item.url).then((html) => deadlineFromDetail(html, item, today)).catch(() => item));
    } else {
      result.push(item);
    }
  }
  return result;
}

export interface SyncResult { sourceId: string; name: string; found: number; added: number; error: string | null }

export async function syncSource(id: string, options: { database?: Client; fetcher?: TextFetcher; now?: Date } = {}): Promise<SyncResult> {
  const db = options.database || await getDatabase();
  const now = options.now || new Date();
  const row = (await db.execute({ sql: "SELECT * FROM campus_sources WHERE id = ?", args: [id] })).rows[0];
  if (!row) throw new RouteError(404, "수집원을 찾을 수 없습니다.");
  const source = sourceFromRow(row);
  const today = seoulToday(now);
  const fetcher = options.fetcher || fetchPublicText;
  const profile = await getProfile(db);
  let items: ImportedItem[];
  try {
    const collected = isProvider(source.type)
      ? await FETCHERS[source.type]({ fetcher, today, profile })
      : (await enrich(await collectBoard(source, fetcher, today), source, db, fetcher, today))
        .filter((item) => matchesKeywords(item, source.keywords, true))
        .map((item) => ({ ...item, kind: source.kind }));
    items = collected
      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
      .slice(0, MAX_ITEMS_PER_SYNC);
  } catch (error) {
    const message = error instanceof FetchError ? error.message : "수집 중 알 수 없는 오류가 발생했습니다.";
    await db.execute({ sql: "UPDATE campus_sources SET last_synced_at = ?, last_error = ? WHERE id = ?", args: [now.toISOString(), message, id] });
    return { sourceId: id, name: source.name, found: 0, added: 0, error: message };
  }

  const tx = await db.transaction("write");
  try {
    for (const item of items) {
      await tx.execute({
        sql: "INSERT INTO campus_imports(id, source_id, external_id, value, date, first_seen_at) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(source_id, external_id) DO UPDATE SET value = excluded.value, date = excluded.date",
        args: [randomUUID(), id, item.externalId, JSON.stringify(item), item.date, now.toISOString()],
      });
    }
    await tx.execute({ sql: "UPDATE campus_sources SET last_synced_at = ?, last_error = NULL, last_count = ? WHERE id = ?", args: [now.toISOString(), items.length, id] });
    await tx.commit();
  } finally {
    tx.close();
  }

  let added = 0;
  if (source.autoAdd && source.enabled) {
    const telegram = await telegramReady(db);
    const autoAdded = new Set((await db.execute({ sql: "SELECT id FROM campus_imports WHERE source_id = ? AND added_at IS NOT NULL", args: [id] })).rows.map((entry) => String(entry.id)));
    const external = new Set(items.map((item) => item.externalId));
    const externalIds = new Map((await db.execute({ sql: "SELECT id, external_id FROM campus_imports WHERE source_id = ?", args: [id] })).rows.map((entry) => [String(entry.id), String(entry.external_id)]));
    // 기본 수집원은 프로필과 맞는 항목만, 직접 넣은 게시판은 마감이 확인된 모든 항목을 등록한다.
    // 한 번 등록한 항목은 사용자가 일정을 지워도 다시 넣지 않는다.
    const eligible = (await candidates(db, profile, now, id)).filter((candidate) =>
      candidate.date && !candidate.dismissed && !autoAdded.has(candidate.id)
      && external.has(externalIds.get(candidate.id) || "")
      && (!source.builtin || candidate.matched.length > 0));
    for (const candidate of eligible.slice(0, AUTO_ADD_PER_SYNC)) {
      try {
        await createEvent(eventFromCandidate(candidate, now, telegram), db, now);
        await markAdded(db, candidate.id, now);
        added++;
      } catch {
        // 한 항목의 검증 실패가 나머지 자동 등록을 막지 않게 한다. 항목은 목록에 남아 직접 등록할 수 있다.
      }
    }
  }
  return { sourceId: id, name: source.name, found: items.length, added, error: null };
}

export async function syncAllSources(options: { database?: Client; fetcher?: TextFetcher; now?: Date; onlyDue?: boolean } = {}): Promise<SyncResult[]> {
  const db = options.database || await getDatabase();
  const now = options.now || new Date();
  await ensureBuiltinSources(db, now);
  const minutes = Math.max(15, Number(process.env.IMPORT_INTERVAL_MINUTES) || 360);
  const sources = (await db.execute("SELECT * FROM campus_sources WHERE enabled = 1 ORDER BY created_at")).rows.map(sourceFromRow)
    .filter((source) => !source.builtin || providerConfigured(source.type as ProviderType))
    .filter((source) => !options.onlyDue || !source.lastSyncedAt || now.getTime() - new Date(source.lastSyncedAt).getTime() >= minutes * 60_000);
  const results: SyncResult[] = [];
  for (const source of sources) results.push(await syncSource(source.id, { ...options, database: db, now }));
  return results;
}
