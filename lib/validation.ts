import { z } from "zod";
import { EVENT_KINDS } from "./contracts";
import { MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT_LENGTH } from "./checklist";

function deadlineBoundary(date: string, time: string | null): Date {
  // End-of-day is a validation boundary; an unknown deadline stays null.
  return new Date(`${date}T${time ? `${time}:00` : "23:59:59.999"}+09:00`);
}

export const profileSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해주세요.").max(80),
  year: z.string().trim().max(30),
  major: z.string().trim().max(120),
  gpa: z.string().trim().max(10),
  gpaScale: z.string().trim().max(10),
  interests: z.string().trim().max(1000),
  experience: z.string().trim().max(10000),
}).strict().superRefine((profile, ctx) => {
  if (profile.gpa && (!Number.isFinite(Number(profile.gpa)) || Number(profile.gpa) < 0 || Number(profile.gpa) > Number(profile.gpaScale))) {
    ctx.addIssue({ code: "custom", path: ["gpa"], message: "학점과 학점 기준을 확인해주세요." });
  }
  if (profile.gpaScale && (!Number.isFinite(Number(profile.gpaScale)) || Number(profile.gpaScale) <= 0 || Number(profile.gpaScale) > 10)) {
    ctx.addIssue({ code: "custom", path: ["gpaScale"], message: "학점 기준을 확인해주세요." });
  }
});

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "마감 날짜를 확인해주세요.").refine((date) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}, "존재하는 날짜를 입력해주세요.");

export const checklistSchema = z.array(z.object({
  id: z.string().uuid("준비물 식별자가 올바르지 않습니다."),
  text: z.string().trim().min(1, "준비물 내용을 입력해주세요.").max(MAX_CHECKLIST_TEXT_LENGTH),
  completed: z.boolean(),
}).strict()).max(MAX_CHECKLIST_ITEMS, `준비물은 ${MAX_CHECKLIST_ITEMS}개까지 추가할 수 있습니다.`)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "준비물 항목이 중복되었습니다.");

export const eventSchema = z.object({
  title: z.string().trim().min(1, "일정 제목을 입력해주세요.").max(200),
  kind: z.enum(EVENT_KINDS),
  date: calendarDate,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "마감 시각을 확인해주세요.").nullable(),
  notes: z.string().max(10000),
  source: z.string().max(2000),
  isSample: z.boolean(),
  checklist: checklistSchema.optional(),
  reminders: z.array(z.object({
    at: z.iso.datetime({ offset: true, message: "알림 시각에는 시간대가 포함되어야 합니다." }),
    channel: z.enum(["app", "telegram"]),
  }).strict()).max(12, "알림은 일정당 12개까지 설정할 수 있습니다."),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();

export function validateEvent(input: unknown, now = new Date()) {
  return eventSchema.superRefine((event, ctx) => {
    const boundary = deadlineBoundary(event.date, event.time);
    const seen = new Set<string>();
    for (let index = 0; index < event.reminders.length; index++) {
      const reminder = event.reminders[index];
      const at = new Date(reminder.at);
      if (!Number.isFinite(at.getTime())) continue;
      if (at.getTime() <= now.getTime()) {
        ctx.addIssue({ code: "custom", path: ["reminders", index, "at"], message: "알림은 미래 시각으로 예약해주세요." });
      }
      if (at.getTime() > boundary.getTime()) {
        ctx.addIssue({ code: "custom", path: ["reminders", index, "at"], message: "알림은 마감 이후로 예약할 수 없습니다." });
      }
      const key = `${at.toISOString()}:${reminder.channel}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["reminders", index], message: "같은 시각과 채널의 알림이 중복되었습니다." });
      }
      seen.add(key);
    }
  }).parse(input);
}

export const settingsSchema = z.object({
  telegramToken: z.string().trim().max(256).optional(),
  telegramChatId: z.string().trim().max(120).refine((value) => !value || /^-?\d+$/.test(value) || /^@[a-zA-Z][a-zA-Z0-9_]{4,}$/.test(value), "텔레그램 Chat ID를 확인해주세요."),
  telegramEnabled: z.boolean(),
}).strict().superRefine((settings, ctx) => {
  if (settings.telegramToken && !/^\d{5,}:[a-zA-Z0-9_-]{20,}$/.test(settings.telegramToken)) {
    ctx.addIssue({ code: "custom", path: ["telegramToken"], message: "BotFather에서 받은 봇 토큰을 확인해주세요." });
  }
  if (settings.telegramEnabled && !settings.telegramChatId && !process.env.TELEGRAM_CHAT_ID) {
    ctx.addIssue({ code: "custom", path: ["telegramChatId"], message: "텔레그램 알림을 켜려면 Chat ID가 필요합니다." });
  }
});
