import { randomUUID } from "node:crypto";
import type { Client, InStatement, Row, Transaction } from "@libsql/client";
import { ZodError } from "zod";
import { DATA_PROVIDERS, DEFAULT_PROFILE, type AppState, type DataProvider, type KeySource, type CalendarEvent, type EventInput, type KookminImportResult, type Profile, type PublicSettings, type ReminderRecord } from "./contracts";
import { getDatabase } from "./db";
import { RouteError } from "./http";
import { aiSettingsSchema, dataKeyDeleteSchema, dataKeySchema, profileSchema, settingsSchema, validateEvent } from "./validation";
import { sendTelegramMessage, verifyTelegramBot } from "./telegram";

type Executor = Client | Transaction;

function eventFromRow(row: Row): CalendarEvent {
  const value = JSON.parse(String(row.value)) as EventInput;
  return {
    ...value,
    checklist: value.checklist ?? [],
    id: String(row.id),
    completed: Boolean(row.completed),
    createdAt: String(row.created_at),
  };
}

function reminderFromRow(row: Row): ReminderRecord {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    title: String(row.title),
    kind: String(row.kind) as ReminderRecord["kind"],
    scheduledAt: String(row.scheduled_at),
    channel: String(row.channel) as ReminderRecord["channel"],
    status: String(row.status) as ReminderRecord["status"],
    attempts: Number(row.attempts),
    error: row.error == null ? null : String(row.error),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
    read: Boolean(row.is_read),
  };
}

export async function getProfile(database?: Client): Promise<Profile> {
  const db = database || await getDatabase();
  const result = await db.execute("SELECT value FROM campus_profile WHERE id = 1");
  return result.rows[0] ? JSON.parse(String(result.rows[0].value)) as Profile : { ...DEFAULT_PROFILE };
}

export async function getPrivateSettings(database?: Client) {
  const db = database || await getDatabase();
  const result = await db.execute("SELECT * FROM campus_settings WHERE id = 1");
  const row = result.rows[0];
  return {
    token: String(row.token || process.env.TELEGRAM_BOT_TOKEN || ""),
    chatId: String(row.chat_id || process.env.TELEGRAM_CHAT_ID || ""),
    enabled: Boolean(row.enabled),
    botUsername: row.bot_username ? String(row.bot_username) : process.env.TELEGRAM_BOT_USERNAME || null,
    workerLastSeen: row.worker_last_seen ? String(row.worker_last_seen) : null,
  };
}

async function getAnthropicConfiguration(database?: Client) {
  const db = database || await getDatabase();
  const result = await db.execute("SELECT anthropic_api_key FROM campus_settings WHERE id = 1");
  const saved = String(result.rows[0]?.anthropic_api_key || "").trim();
  const environment = (process.env.ANTHROPIC_API_KEY || "").trim();
  return {
    key: saved || environment,
    source: saved ? "saved" as const : environment ? "environment" as const : null,
  };
}

export async function getAnthropicApiKey(database?: Client): Promise<string> {
  return (await getAnthropicConfiguration(database)).key;
}

const DATA_KEYS: Record<DataProvider, { column: string; environment: string }> = {
  dataGoKr: { column: "data_go_kr_api_key", environment: "DATA_GO_KR_API_KEY" },
  saramin: { column: "saramin_api_key", environment: "SARAMIN_API_KEY" },
};

async function getDataKeyConfiguration(provider: DataProvider, database?: Client): Promise<{ key: string; source: KeySource }> {
  const db = database || await getDatabase();
  const { column, environment: variable } = DATA_KEYS[provider];
  const result = await db.execute(`SELECT ${column} AS api_key FROM campus_settings WHERE id = 1`);
  const saved = String(result.rows[0]?.api_key || "").trim();
  const environment = (process.env[variable] || "").trim();
  return { key: saved || environment, source: saved ? "saved" : environment ? "environment" : null };
}

export async function getDataApiKey(provider: DataProvider, database?: Client): Promise<string> {
  return (await getDataKeyConfiguration(provider, database)).key;
}

// 공공데이터포털은 Encoding 키(%2B 등)와 Decoding 키를 함께 보여준다. 요청 시 한 번만 인코딩하도록 Decoding 형태로 저장한다.
function normalizeDataKey(provider: DataProvider, key: string): string {
  if (provider !== "dataGoKr" || !/%[0-9a-f]{2}/i.test(key)) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    throw new RouteError(400, "공공데이터포털 인증키 형식을 확인해주세요.");
  }
}

export async function getPublicSettings(database?: Client): Promise<PublicSettings> {
  const settings = await getPrivateSettings(database);
  const ai = await getAnthropicConfiguration(database);
  const dataKeys = Object.fromEntries(await Promise.all(
    DATA_PROVIDERS.map(async (provider) => [provider, (await getDataKeyConfiguration(provider, database)).source]),
  )) as Record<DataProvider, KeySource>;
  return {
    telegramConfigured: Boolean(settings.token && settings.chatId),
    telegramEnabled: settings.enabled,
    telegramChatId: settings.chatId,
    botUsername: settings.botUsername,
    workerLastSeen: settings.workerLastSeen,
    aiConfigured: Boolean(ai.key),
    aiKeySource: ai.source,
    dataKeys,
  };
}

export async function getState(database?: Client): Promise<AppState> {
  const db = database || await getDatabase();
  const events = await db.execute("SELECT * FROM campus_events ORDER BY created_at DESC, id");
  const reminders = await db.execute("SELECT * FROM campus_reminders ORDER BY scheduled_at DESC, id LIMIT 1000");
  return {
    profile: await getProfile(db),
    events: events.rows.map(eventFromRow),
    notifications: reminders.rows.map(reminderFromRow),
    settings: await getPublicSettings(db),
  };
}

export async function saveAnthropicApiKey(input: unknown, database?: Client): Promise<AppState> {
  const settings = aiSettingsSchema.parse(input);
  const db = database || await getDatabase();
  await db.execute({ sql: "UPDATE campus_settings SET anthropic_api_key = ? WHERE id = 1", args: [settings.apiKey] });
  return getState(db);
}

export async function deleteAnthropicApiKey(database?: Client): Promise<AppState> {
  const db = database || await getDatabase();
  await db.execute("UPDATE campus_settings SET anthropic_api_key = '' WHERE id = 1");
  return getState(db);
}

export async function saveDataApiKey(input: unknown, database?: Client): Promise<AppState> {
  const { provider, apiKey } = dataKeySchema.parse(input);
  const db = database || await getDatabase();
  await db.execute({ sql: `UPDATE campus_settings SET ${DATA_KEYS[provider].column} = ? WHERE id = 1`, args: [normalizeDataKey(provider, apiKey)] });
  return getState(db);
}

export async function deleteDataApiKey(input: unknown, database?: Client): Promise<AppState> {
  const { provider } = dataKeyDeleteSchema.parse(input);
  const db = database || await getDatabase();
  await db.execute(`UPDATE campus_settings SET ${DATA_KEYS[provider].column} = '' WHERE id = 1`);
  return getState(db);
}

export async function saveProfile(input: unknown, database?: Client): Promise<AppState> {
  const profile = profileSchema.parse(input);
  const db = database || await getDatabase();
  await db.execute({ sql: "INSERT INTO campus_profile(id, value) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", args: [JSON.stringify(profile)] });
  return getState(db);
}

async function insertReminders(tx: Executor, eventId: string, input: EventInput, revision: number, completed = false) {
  for (const reminder of input.reminders) {
    const sampleTelegram = input.isSample && reminder.channel === "telegram";
    await tx.execute({
      sql: "INSERT INTO campus_reminders(id, event_id, title, kind, scheduled_at, channel, revision, status, error) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [randomUUID(), eventId, input.title, input.kind, new Date(reminder.at).toISOString(), reminder.channel, revision, sampleTelegram || completed ? "cancelled" : "pending", sampleTelegram ? "샘플 일정의 텔레그램 알림은 발송하지 않습니다." : completed ? "완료한 일정의 알림을 취소했습니다." : null],
    });
  }
}

export async function createEvent(input: unknown, database?: Client, now = new Date()): Promise<AppState> {
  const event = validateEvent(input, now);
  const db = database || await getDatabase();
  const tx = await db.transaction("write");
  try {
    if (event.idempotencyKey) {
      const existing = await tx.execute({ sql: "SELECT id FROM campus_events WHERE idempotency_key = ?", args: [event.idempotencyKey] });
      if (existing.rows.length) {
        await tx.commit();
        return getState(db);
      }
    }
    const id = randomUUID();
    await tx.execute({ sql: "INSERT INTO campus_events(id, value, created_at, idempotency_key) VALUES(?, ?, ?, ?)", args: [id, JSON.stringify(event), now.toISOString(), event.idempotencyKey || null] });
    await insertReminders(tx, id, event, 1);
    await tx.commit();
  } finally {
    tx.close();
  }
  return getState(db);
}

/**
 * 국민대 연동에서 고른 항목을 한 번에 저장한다.
 * 이미 가져온 항목(idempotencyKey 일치)은 건너뛰고, 잘못된 항목은 failed에 담은 뒤 나머지를 계속 저장한다.
 * 지났거나 마감 뒤로 잡힌 알림, 중복 알림은 항목을 실패시키지 않고 뺀다.
 */
export async function importEvents(items: readonly unknown[], database?: Client, now = new Date()): Promise<KookminImportResult> {
  const db = database || await getDatabase();
  let created = 0;
  let skipped = 0;
  const failed: KookminImportResult["failed"] = [];
  const tx = await db.transaction("write");
  try {
    for (const raw of items) {
      const item = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
      const idempotencyKey = typeof item.idempotencyKey === "string" ? item.idempotencyKey : "";
      if (!idempotencyKey) {
        failed.push({ idempotencyKey, error: "가져올 항목의 식별 키가 없습니다." });
        continue;
      }
      const existing = await tx.execute({ sql: "SELECT id FROM campus_events WHERE idempotency_key = ?", args: [idempotencyKey] });
      if (existing.rows.length) {
        skipped++;
        continue;
      }
      let reminders = item.reminders;
      if (Array.isArray(reminders) && typeof item.date === "string") {
        const boundary = new Date(`${item.date}T${typeof item.time === "string" ? `${item.time}:00` : "23:59:59.999"}+09:00`).getTime();
        const seen = new Set<string>();
        reminders = reminders.filter((reminder: unknown) => {
          const value = reminder as { at?: unknown; channel?: unknown } | null;
          const at = typeof value?.at === "string" ? new Date(value.at).getTime() : NaN;
          // 형식이 틀린 알림은 남겨 두어 검증에서 항목 오류로 드러나게 한다.
          if (!Number.isFinite(at)) return true;
          if (at <= now.getTime() || at > boundary) return false;
          const key = `${at}:${String(value?.channel)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      // 긴 본문·주소 때문에 항목 전체가 실패하지 않도록 스키마 한도에 맞춰 자른다.
      const notes = typeof item.notes === "string" ? item.notes.slice(0, 10_000) : item.notes;
      const source = typeof item.source === "string" ? item.source.slice(0, 2000) : item.source;
      let event: EventInput;
      try {
        event = validateEvent({ title: item.title, kind: item.kind, date: item.date, time: item.time, notes, source, isSample: false, reminders, idempotencyKey }, now);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        const message = error.issues[0]?.message || "";
        // 형식 오류는 zod 기본 문구(영문)라서 한국어 안내로 바꾼다.
        failed.push({ idempotencyKey, error: /[가-힣]/.test(message) ? message : "가져올 항목의 형식을 확인해주세요." });
        continue;
      }
      const id = randomUUID();
      await tx.execute({ sql: "INSERT INTO campus_events(id, value, created_at, idempotency_key) VALUES(?, ?, ?, ?)", args: [id, JSON.stringify(event), now.toISOString(), idempotencyKey] });
      await insertReminders(tx, id, event, 1);
      created++;
    }
    await tx.commit();
  } finally {
    tx.close();
  }
  return { created, skipped, failed, state: await getState(db) };
}

export async function updateEvent(id: string, input: unknown, database?: Client, now = new Date()): Promise<AppState> {
  const completedOnly = typeof input === "object" && input !== null && !Array.isArray(input) && Object.keys(input).length === 1 && "completed" in input && typeof input.completed === "boolean";
  const replacement = completedOnly ? null : validateEvent(input, now);
  const db = database || await getDatabase();
  const tx = await db.transaction("write");
  try {
    const result = await tx.execute({ sql: "SELECT * FROM campus_events WHERE id = ?", args: [id] });
    if (!result.rows.length) throw new RouteError(404, "일정을 찾을 수 없습니다.");
    const row = result.rows[0];
    const revision = Number(row.revision) + 1;
    const oldEvent = eventFromRow(row);
    if (completedOnly) {
      const completed = (input as { completed: boolean }).completed;
      if (oldEvent.completed !== completed) {
        await tx.execute({ sql: "UPDATE campus_events SET completed = ?, revision = ? WHERE id = ?", args: [completed ? 1 : 0, revision, id] });
        if (completed) {
          await tx.execute({ sql: "UPDATE campus_reminders SET status = 'cancelled', revision = ?, error = '완료한 일정의 알림을 취소했습니다.', next_attempt_at = NULL, lease_until = NULL, claimed_by = NULL WHERE event_id = ? AND status IN ('pending', 'sending', 'failed')", args: [revision, id] });
        } else {
          await tx.execute({ sql: "UPDATE campus_reminders SET status = 'pending', revision = ?, attempts = 0, error = NULL, next_attempt_at = NULL, lease_until = NULL, claimed_by = NULL WHERE event_id = ? AND revision = ? AND status = 'cancelled' AND scheduled_at > ? AND NOT (channel = 'telegram' AND ? = 1)", args: [revision, id, Number(row.revision), now.toISOString(), oldEvent.isSample ? 1 : 0] });
        }
      }
    } else if (replacement) {
      // 체크리스트가 없는 기존 요청으로 저장해도 준비 상태를 보존한다.
      const next = { ...replacement, checklist: replacement.checklist ?? oldEvent.checklist ?? [] };
      const reminderKey = (event: EventInput) => JSON.stringify({
        title: event.title,
        kind: event.kind,
        date: event.date,
        time: event.time,
        isSample: event.isSample,
        reminders: event.reminders
          .filter((reminder) => new Date(reminder.at).getTime() > now.getTime())
          .map((reminder) => `${new Date(reminder.at).toISOString()}:${reminder.channel}`)
          .sort(),
      });
      const remindersChanged = reminderKey(oldEvent) !== reminderKey(next);
      await tx.execute({ sql: "UPDATE campus_events SET value = ?, revision = ? WHERE id = ?", args: [JSON.stringify(next), remindersChanged ? revision : Number(row.revision), id] });
      // 준비물·메모만 수정한 경우 예약과 발송 기록은 그대로 둔다.
      if (remindersChanged) {
        await tx.execute({ sql: "UPDATE campus_reminders SET status = 'cancelled', error = '일정 수정으로 기존 알림을 취소했습니다.', next_attempt_at = NULL, lease_until = NULL, claimed_by = NULL WHERE event_id = ? AND status IN ('pending', 'sending', 'failed')", args: [id] });
        await insertReminders(tx, id, next, revision, oldEvent.completed);
      }
    }
    await tx.commit();
  } finally {
    tx.close();
  }
  return getState(db);
}

export async function deleteEvent(id: string, database?: Client): Promise<AppState> {
  const db = database || await getDatabase();
  const tx = await db.transaction("write");
  try {
    const result = await tx.execute({ sql: "DELETE FROM campus_events WHERE id = ?", args: [id] });
    if (!result.rowsAffected) throw new RouteError(404, "일정을 찾을 수 없습니다.");
    await tx.execute({ sql: "UPDATE campus_reminders SET status = 'cancelled', error = '삭제한 일정의 알림을 취소했습니다.', next_attempt_at = NULL, lease_until = NULL, claimed_by = NULL WHERE event_id = ? AND status IN ('pending', 'sending', 'failed')", args: [id] });
    await tx.commit();
  } finally {
    tx.close();
  }
  return getState(db);
}

export async function saveSettings(input: unknown, database?: Client, fetcher = fetch): Promise<AppState> {
  const settings = settingsSchema.parse(input);
  const db = database || await getDatabase();
  const previous = await getPrivateSettings(db);
  const token = settings.telegramToken || previous.token;
  const chatId = settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || "";
  if (settings.telegramEnabled && (!token || !chatId)) throw new RouteError(400, "봇 토큰과 Chat ID를 설정해주세요.");
  let botUsername = previous.botUsername;
  if (settings.telegramToken) {
    const verification = await verifyTelegramBot(token, fetcher);
    if (!verification.ok) throw new RouteError(502, verification.error || "봇 토큰을 확인하지 못했습니다.");
    botUsername = verification.username;
  }
  await db.execute({ sql: "UPDATE campus_settings SET token = ?, chat_id = ?, enabled = ?, bot_username = ? WHERE id = 1", args: [settings.telegramToken || String((await db.execute("SELECT token FROM campus_settings WHERE id = 1")).rows[0].token), settings.telegramChatId, settings.telegramEnabled ? 1 : 0, botUsername] });
  if (!settings.telegramEnabled) {
    // Pending reservations remain available when the channel is enabled again.
    await db.execute("UPDATE campus_reminders SET next_attempt_at = NULL WHERE channel = 'telegram' AND status = 'pending'");
  }
  return getState(db);
}

export async function markNotificationsRead(ids: string[] | undefined, database?: Client): Promise<AppState> {
  const db = database || await getDatabase();
  if (!ids) {
    await db.execute("UPDATE campus_reminders SET is_read = 1 WHERE status IN ('sent', 'failed')");
  } else if (ids.length) {
    const query: InStatement = { sql: `UPDATE campus_reminders SET is_read = 1 WHERE status IN ('sent', 'failed') AND id IN (${ids.map(() => "?").join(",")})`, args: ids };
    await db.execute(query);
  }
  return getState(db);
}

export async function testTelegram(database?: Client, fetcher = fetch) {
  const settings = await getPrivateSettings(database);
  if (!settings.token || !settings.chatId) throw new RouteError(400, "봇 토큰과 Chat ID를 먼저 저장해주세요.");
  const result = await sendTelegramMessage(settings.token, settings.chatId, "[캠퍼스 비서] 테스트 알림입니다. 일정 알림이 이 대화로 도착합니다.", fetcher);
  if (!result.ok) throw new RouteError(result.retryAfter ? 429 : 502, result.error || "테스트 알림을 보내지 못했습니다.");
  return { ok: true, message: "텔레그램 테스트 알림을 보냈습니다." };
}
