import { randomUUID } from "node:crypto";
import type { Client, Row } from "@libsql/client";
import { KIND_LABELS, type EventInput } from "./contracts";
import { getDatabase } from "./db";
import { getPrivateSettings } from "./store";
import { sendTelegramMessage } from "./telegram";

export interface ReminderWorkerOptions {
  database?: Client;
  now?: Date;
  fetcher?: typeof fetch;
  workerId?: string;
  limit?: number;
}

function notificationText(event: EventInput): string {
  return `[캠퍼스 비서 · ${KIND_LABELS[event.kind]}]\n${event.title}\n마감: ${event.date}${event.time ? ` ${event.time} (한국 시간)` : " (시각 확인 필요)"}${event.notes ? `\n${event.notes.slice(0, 1000)}` : ""}`;
}

async function cancelClaim(database: Client, reminder: Row, workerId: string, error: string) {
  await database.execute({ sql: "UPDATE campus_reminders SET status = 'cancelled', error = ?, lease_until = NULL, claimed_by = NULL WHERE id = ? AND status = 'sending' AND claimed_by = ?", args: [error, String(reminder.id), workerId] });
}

export async function processDueReminders(options: ReminderWorkerOptions = {}) {
  const database = options.database || await getDatabase();
  const workerId = options.workerId || randomUUID();
  const timestamp = () => options.now || new Date();
  const heartbeat = timestamp().toISOString();
  await database.execute({ sql: "UPDATE campus_settings SET worker_last_seen = ? WHERE id = 1", args: [heartbeat] });

  // A process may have stopped after sending. Its expired lease is ambiguous.
  await database.execute({ sql: "UPDATE campus_reminders SET status = 'failed', error = '전송 작업이 중단되어 수신 결과를 확인할 수 없습니다. 중복 방지를 위해 자동 재전송하지 않습니다.', next_attempt_at = NULL, lease_until = NULL, claimed_by = NULL WHERE status = 'sending' AND lease_until <= ?", args: [heartbeat] });
  await database.execute("UPDATE campus_reminders SET status = 'cancelled', error = '현재 일정과 일치하지 않는 알림을 취소했습니다.', next_attempt_at = NULL WHERE status IN ('pending', 'failed') AND NOT EXISTS (SELECT 1 FROM campus_events e WHERE e.id = campus_reminders.event_id AND e.completed = 0 AND e.revision = campus_reminders.revision)");

  const totals = { processed: 0, sent: 0, failed: 0 };
  for (let count = 0; count < (options.limit || 100); count++) {
    const now = timestamp();
    const settings = await getPrivateSettings(database);
    const telegramAvailable = settings.enabled && Boolean(settings.token && settings.chatId);
    if (!telegramAvailable) {
      await database.execute({ sql: "UPDATE campus_reminders SET error = ? WHERE channel = 'telegram' AND status = 'pending' AND scheduled_at <= ?", args: [settings.enabled ? "텔레그램 연결 설정을 기다리고 있습니다." : "텔레그램 알림이 꺼져 있어 발송 대기 중입니다.", now.toISOString()] });
    }
    const claimed = await database.execute({
      sql: `UPDATE campus_reminders SET status = 'sending', attempts = attempts + 1, claimed_by = ?, lease_until = ?, error = NULL
        WHERE id = (SELECT r.id FROM campus_reminders r JOIN campus_events e ON e.id = r.event_id
          WHERE e.completed = 0 AND e.revision = r.revision
          AND (r.status = 'pending' OR (r.status = 'failed' AND r.next_attempt_at IS NOT NULL AND r.attempts < 3))
          AND r.scheduled_at <= ? AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ?)
          AND (r.channel = 'app' OR ? = 1)
          ORDER BY r.scheduled_at, r.id LIMIT 1)
        AND (status = 'pending' OR (status = 'failed' AND next_attempt_at IS NOT NULL AND attempts < 3))
        RETURNING *`,
      args: [workerId, new Date(now.getTime() + 60_000).toISOString(), now.toISOString(), now.toISOString(), telegramAvailable ? 1 : 0],
    });
    const reminder = claimed.rows[0];
    if (!reminder) break;
    totals.processed++;

    const eventResult = await database.execute({ sql: "SELECT value, completed, revision FROM campus_events WHERE id = ?", args: [String(reminder.event_id)] });
    const row = eventResult.rows[0];
    if (!row || Boolean(row.completed) || Number(row.revision) !== Number(reminder.revision)) {
      await cancelClaim(database, reminder, workerId, "변경된 일정의 알림을 취소했습니다.");
      continue;
    }
    const event = JSON.parse(String(row.value)) as EventInput;
    if (event.isSample && reminder.channel === "telegram") {
      await cancelClaim(database, reminder, workerId, "샘플 일정의 텔레그램 알림은 발송하지 않습니다.");
      continue;
    }

    if (reminder.channel === "app") {
      const delivered = await database.execute({ sql: "UPDATE campus_reminders SET status = 'sent', sent_at = ?, error = NULL, next_attempt_at = NULL, lease_until = NULL, claimed_by = NULL WHERE id = ? AND status = 'sending' AND claimed_by = ? AND EXISTS (SELECT 1 FROM campus_events e WHERE e.id = campus_reminders.event_id AND e.completed = 0 AND e.revision = campus_reminders.revision)", args: [timestamp().toISOString(), String(reminder.id), workerId] });
      totals.sent += delivered.rowsAffected;
      continue;
    }

    // Recheck the reservation and settings immediately before external delivery.
    const active = await database.execute({ sql: "SELECT r.id FROM campus_reminders r JOIN campus_events e ON e.id = r.event_id WHERE r.id = ? AND r.status = 'sending' AND r.claimed_by = ? AND e.completed = 0 AND e.revision = r.revision", args: [String(reminder.id), workerId] });
    const latestSettings = await getPrivateSettings(database);
    if (!active.rows.length) continue;
    if (!latestSettings.enabled || !latestSettings.token || !latestSettings.chatId) {
      await database.execute({ sql: "UPDATE campus_reminders SET status = 'pending', attempts = attempts - 1, error = '텔레그램 연결 설정을 기다리고 있습니다.', lease_until = NULL, claimed_by = NULL WHERE id = ? AND status = 'sending' AND claimed_by = ?", args: [String(reminder.id), workerId] });
      break;
    }
    const result = await sendTelegramMessage(latestSettings.token, latestSettings.chatId, notificationText(event), options.fetcher || fetch);
    const after = timestamp();
    const retryAt = !result.ok && result.retryAfter && Number(reminder.attempts) < 3 ? new Date(after.getTime() + result.retryAfter * 1000).toISOString() : null;
    const finalError = !result.ok && result.retryAfter && !retryAt ? "텔레그램 전송 재시도 3회가 실패했습니다." : result.error || null;
    const finished = await database.execute({
      sql: `UPDATE campus_reminders SET status = ?, sent_at = ?, error = CASE WHEN status = 'cancelled' AND ? = 1 THEN '일정 변경 직전에 시작된 텔레그램 알림이 전송되었습니다.' ELSE ? END, next_attempt_at = ?, lease_until = NULL, claimed_by = NULL
        WHERE id = ? AND ((status = 'sending' AND claimed_by = ?) OR (? = 1 AND status = 'cancelled' AND attempts = ?))`,
      args: [result.ok ? "sent" : "failed", result.ok ? after.toISOString() : null, result.ok ? 1 : 0, finalError, retryAt, String(reminder.id), workerId, result.ok ? 1 : 0, Number(reminder.attempts)],
    });
    if (finished.rowsAffected) {
      if (result.ok) totals.sent++;
      else totals.failed++;
    }
  }
  return totals;
}
