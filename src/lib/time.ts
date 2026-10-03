/**
 * 날짜·시각 규칙. PRD 6.5 / 6.6 의 제약을 코드로 고정한 곳.
 *
 * - 마감 시각을 임의로 23:59 등으로 채우지 않는다 → 시각은 null 을 허용한다.
 * - 알림은 확정된 마감 이후로 예약할 수 없다.
 * - 이미 지난 시각으로는 예약을 만들지 않는다.
 *
 * Asia/Seoul 은 DST 가 없어 오프셋이 고정이므로 Intl 기반 1패스 변환으로 정확하다.
 * DST 가 있는 시간대를 쓰게 되면 전환 시각 ±1시간에서 오차가 생길 수 있다.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - at.getTime();
}

/** "2026-10-08" + "09:00" (Asia/Seoul) → 실제 시점(Date). */
export function zonedToInstant(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  const offset = zoneOffsetMs(naive, timeZone);
  return new Date(naive.getTime() - offset);
}

/**
 * 일정의 마감 경계. 시각이 확정되지 않은 날짜 단위 일정은 그 날의 끝을 경계로 쓴다.
 * 경계는 알림 검증에만 쓰고, 일정의 마감 시각으로 저장하지 않는다.
 */
export function deadlineBoundary(
  dueDate: string,
  dueTime: string | null,
  timeZone: string,
): Date {
  if (dueTime) return zonedToInstant(dueDate, dueTime, timeZone);
  const next = new Date(`${dueDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  return new Date(zonedToInstant(nextDate, "00:00", timeZone).getTime() - 1);
}

export type NotifyRejection =
  | { ok: true }
  | { ok: false; code: "notify_in_past"; message: string }
  | { ok: false; code: "notify_after_deadline"; message: string };

/** 알림 예약 하나가 PRD 6.6 규칙을 지키는지 검사한다. */
export function validateNotifyAt(params: {
  notifyAt: Date;
  dueDate: string;
  dueTime: string | null;
  timeZone: string;
  now?: Date;
}): NotifyRejection {
  const now = params.now ?? new Date();
  if (params.notifyAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: "notify_in_past",
      message: "이미 지난 시각으로는 알림을 예약할 수 없습니다.",
    };
  }
  const boundary = deadlineBoundary(params.dueDate, params.dueTime, params.timeZone);
  if (params.notifyAt.getTime() > boundary.getTime()) {
    return {
      ok: false,
      code: "notify_after_deadline",
      message: params.dueTime
        ? "확정된 마감 시각 이후로는 알림을 예약할 수 없습니다."
        : "알림 날짜가 확인한 마감 날짜를 넘을 수 없습니다.",
    };
  }
  return { ok: true };
}

/**
 * D-3 / D-1 / 당일 기본 제안. PRD NOTI-01 은 "제안"이며, 사용자가 확인·저장해야
 * 활성화된다. 그래서 여기서는 enabled: false 로 돌려준다.
 *
 * 시각이 확정되지 않은 날짜 단위 일정은 알림 시각을 사용자가 따로 확정해야 하므로
 * 제안을 만들지 않는다(PRD 6.6).
 */
export function suggestNotifications(params: {
  dueDate: string;
  dueTime: string | null;
  timeZone: string;
  now?: Date;
}): Array<{ label: string; notifyAt: string; enabled: false }> {
  if (!params.dueTime) return [];
  const now = params.now ?? new Date();
  const due = zonedToInstant(params.dueDate, params.dueTime, params.timeZone);
  const day = 24 * 60 * 60 * 1000;

  return (
    [
      { label: "D-3", at: new Date(due.getTime() - 3 * day) },
      { label: "D-1", at: new Date(due.getTime() - day) },
      { label: "당일", at: new Date(due.getTime() - 60 * 60 * 1000) },
    ] as const
  )
    .filter((s) => s.at.getTime() > now.getTime())
    .map((s) => ({ label: s.label, notifyAt: s.at.toISOString(), enabled: false as const }));
}

/** 오늘 날짜(해당 시간대 기준) — 지난 마감 판정에 쓴다. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
