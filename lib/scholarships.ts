import { createHash, randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { getDatabase, getSharedDatabase } from "./db";
import { createEvent, getState, updateEvent } from "./store";
import type { AnalysisResult, EventInput, Profile } from "./contracts";
import { AIInputError, analyzeText } from "./ai";
import { z } from "zod";
import { RouteError } from "./http";

export const KOOKMIN_ORIGIN = "https://www.kookmin.ac.kr";
export const SCHOLARSHIP_LIST = `${KOOKMIN_ORIGIN}/user/kmuNews/notice/7/index.do`;
const SOURCE = "kookmin-scholarships";
const USER_AGENT = "CampusAssistant/1.0";
const INTERVAL = 30 * 60 * 1000;
export interface ScholarshipNotice {
  id: string; title: string; url: string; publishedAt: string | null; body: string;
  deadline: string | null; time: string | null; evidence: string | null;
  needsReview: boolean; documents: string[]; attachments: { name: string; url: string }[];
  contentHash: string; collectedAt: string;
}
export interface ScholarshipPreferences { enabled: boolean; keywords: string }
export interface CollectionStatus { lastSuccess: string | null; lastAttempt: string | null; nextRun: string | null; error: string | null; count: number }
export interface ScholarshipFeed { notices: ScholarshipNotice[]; preferences: ScholarshipPreferences; status: CollectionStatus }
export const preferencesSchema = z.object({ enabled: z.boolean(), keywords: z.string().trim().max(200) }).strict();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const clean = (text: string) => text.replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[\t\r\u00a0 ]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
function safeLink(href: string, base: string) {
  try { const url = new URL(href, base); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function parseNoticeLinks(html: string): string[] {
  const $ = load(html);
  const found = new Set<string>();
  $(".board_list a[href]").each((_, element) => {
    const href = safeLink($(element).attr("href") || "", SCHOLARSHIP_LIST);
    if (!href) return;
    const url = new URL(href);
    if (url.origin === KOOKMIN_ORIGIN && /^\/user\/kmuNews\/notice\/7\/\d+\/view\.do$/.test(url.pathname)) found.add(`${url.origin}${url.pathname}`);
  });
  if (!found.size) throw new Error("장학공지 목록 구조를 확인해야 합니다.");
  return [...found];
}

export function extractDeadline(body: string, publishedAt: string | null) {
  const empty = { deadline: null, time: null, evidence: null };
  const lines = body.split("\n").map(clean).filter(Boolean);
  const candidates: { deadline: string; time: string | null; evidence: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Only explicit application deadlines qualify for unattended registration.
    if (!/(?:신청|접수)\s*(?:기간|기한|마감)/.test(lines[i])) continue;
    const line = lines[i].slice(0, 260);
    const label = line.match(/(?:신청|접수)\s*(?:기간|기한|마감)/)!;
    let fragment = line.slice(label.index! + label[0].length);
    if (!/\d/.test(fragment)) fragment += ` ${lines[i + 1] || ""}`;
    if (/(상시|추후|별도\s*공지|미정|소진\s*시|(?:모집|선발|채용)\s*(?:완료|시))/.test(fragment)) continue;
    const matches = [...fragment.matchAll(/(?:(20\d{2})\s*[.년/-]\s*)?(\d{1,2})\s*[.월/-]\s*(\d{1,2})\s*(?:일|\.)?/g)];
    if (!matches.length) continue;
    const last = matches.at(-1)!;
    const year = last[1] || matches.find((m) => m[1])?.[1] || publishedAt?.slice(0, 4);
    if (!year) continue;
    const deadline = `${year}-${last[2].padStart(2, "0")}-${last[3].padStart(2, "0")}`;
    const parsed = new Date(`${deadline}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== deadline) continue;
    // A short date crossing New Year needs an explicit year in the source.
    if (!last[1] && publishedAt && deadline < publishedAt) continue;
    if (!last[1] && matches.length > 1 && Number(last[2]) * 100 + Number(last[3]) < Number(matches[0][2]) * 100 + Number(matches[0][3])) continue;
    const suffix = fragment.slice(last.index! + last[0].length, last.index! + last[0].length + 35);
    if (/[~∼～]|부터/.test(suffix)) continue; // Only a range start was provided.
    const timeText = suffix.replace(/^\s*\([월화수목금토일]\)\s*/, "").replace(/^\s*\(/, "");
    const clock = timeText.match(/^\s*(\d{1,2})\s*(?::(\d{2})(?!\d)|시(?:\s*(\d{1,2})\s*분)?)/);
    if (!clock && /^\s*\d+\s*:/.test(timeText)) continue;
    let time: string | null = null;
    if (clock) {
      const h = Number(clock[1]), m = Number(clock[2] || clock[3] || 0);
      if (h > 23 || m > 59) continue;
      time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    candidates.push({ deadline, time, evidence: clean(`${label[0]} ${fragment}`) });
  }
  const unique = new Map(candidates.map((candidate) => [`${candidate.deadline}/${candidate.time}`, candidate]));
  return unique.size === 1 ? [...unique.values()][0] : empty;
}
export function parseScholarship(html: string, url: string, now = new Date()): ScholarshipNotice {
  const $ = load(html);
  const title = clean($(".board_view .view_tit").first().text());
  const content = $(".board_view .view_inner").first();
  if (!title || !content.length) throw new Error("장학공지 본문 구조를 확인해야 합니다.");
  const published = $(".board_view .board_etc").text().match(/작성일\s*(20\d{2})[.-](\d{2})[.-](\d{2})/);
  const publishedAt = published ? `${published[1]}-${published[2]}-${published[3]}` : null;
  const images = content.find("img").length;
  content.find("script, style, iframe").remove();
  content.find("br").replaceWith("\n");
  content.find("p, div, li, tr, h1, h2, h3").append("\n");
  content.find("td, th").append(" ");
  const body = clean(content.text()).slice(0, 50000);
  const deadline = extractDeadline(body, publishedAt);
  const attachments: ScholarshipNotice["attachments"] = [];
  $(".board_atc a[href]").each((_, element) => {
    const link = safeLink($(element).attr("href") || "", url);
    const name = clean($(element).text());
    if (link && name) attachments.push({ name, url: link });
  });
  const documents = body.split("\n").filter((line) => /(?:제출|구비|신청)\s*서류/.test(line)).map((line) => line.slice(0, 200)).slice(0, 10);
  const id = `kookmin:${new URL(url).pathname.match(/\/(\d+)\/view\.do$/)?.[1]}`;
  const contentHash = hash(JSON.stringify({ title, body, publishedAt, deadline, attachments }));
  return { id, title, url, publishedAt, body: body || (images ? "이미지 공고입니다. 원문에서 신청 조건과 마감일을 확인해주세요." : "첨부파일과 원문을 확인해주세요."), ...deadline, needsReview: !deadline.deadline, documents, attachments, contentHash, collectedAt: now.toISOString() };
}
export async function saveScholarship(db: Client, notice: ScholarshipNotice) {
  await db.execute({ sql: `INSERT INTO scholarship_notices(id, url, value, content_hash, collected_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET value = excluded.value, content_hash = excluded.content_hash, collected_at = excluded.collected_at,
    updated_at = CASE WHEN content_hash != excluded.content_hash THEN excluded.updated_at ELSE updated_at END`,
    args: [notice.id, notice.url, JSON.stringify(notice), notice.contentHash, notice.collectedAt, notice.collectedAt] });
}
export async function getNotices(db?: Client): Promise<ScholarshipNotice[]> {
  const database = db || await getSharedDatabase();
  const result = await database.execute("SELECT value FROM scholarship_notices ORDER BY json_extract(value, '$.publishedAt') DESC, id DESC LIMIT 200");
  return result.rows.map((row) => JSON.parse(String(row.value)));
}
export async function getCollectionStatus(db?: Client): Promise<CollectionStatus> {
  const database = db || await getSharedDatabase();
  const { rows } = await database.execute({ sql: "SELECT * FROM collection_state WHERE source = ?", args: [SOURCE] });
  const row = rows[0];
  return { lastSuccess: row?.last_success ? String(row.last_success) : null, lastAttempt: row?.last_attempt ? String(row.last_attempt) : null, nextRun: row?.next_run ? String(row.next_run) : null, error: row?.error ? String(row.error) : null, count: Number(row?.count || 0) };
}
async function fetchText(url: string, fetcher: typeof fetch): Promise<string> {
  // Fixed official host and no redirects: no user-controlled URL fetching.
  if (new URL(url).origin !== KOOKMIN_ORIGIN) throw new Error("허용되지 않은 수집 주소입니다.");
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain" } });
  if (!response.ok) throw new Error(`학교 사이트 응답을 확인해야 합니다. (${response.status})`);
  if (!response.body) throw new Error("빈 응답입니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2_000_000) throw new Error("공지 응답이 너무 큽니다."); chunks.push(value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
export async function collectScholarships(options: { database?: Client; fetcher?: typeof fetch; now?: Date; delayMs?: number } = {}) {
  const db = options.database || await getSharedDatabase();
  const fetcher = options.fetcher || fetch;
  const now = options.now || new Date();
  const lease = randomUUID();
  await db.execute({ sql: "INSERT OR IGNORE INTO collection_state(source) VALUES(?)", args: [SOURCE] });
  const claim = await db.execute({ sql: `UPDATE collection_state SET lease_token = ?, lease_until = ?, last_attempt = ?
    WHERE source = ? AND (next_run IS NULL OR next_run <= ?) AND (lease_until IS NULL OR lease_until <= ?) RETURNING source`,
    args: [lease, new Date(now.getTime() + 15 * 60 * 1000).toISOString(), now.toISOString(), SOURCE, now.toISOString(), now.toISOString()] });
  if (!claim.rows.length) return { skipped: true, collected: 0 };
  let count = 0;
  try {
    const robotsUrl = `${KOOKMIN_ORIGIN}/robots.txt`;
    const robots = robotsParser(robotsUrl, await fetchText(robotsUrl, fetcher));
    const read = async (url: string) => {
      if (robots.isAllowed(url, USER_AGENT) === false) throw new Error("학교 사이트의 수집 허용 범위를 확인해야 합니다.");
      const delay = options.delayMs ?? Math.max(500, (robots.getCrawlDelay(USER_AGENT) || 0) * 1000);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchText(url, fetcher);
    };
    const links = new Set<string>();
    for (let page = 1; page <= 2; page++) {
      for (const link of parseNoticeLinks(await read(`${SCHOLARSHIP_LIST}?currentPageNo=${page}`))) links.add(link);
    }
    let skipped = 0;
    for (const url of [...links].slice(0, 40)) {
      // 공지 하나의 일시적 오류가 나머지 공지 수집을 막지 않도록 건너뛰고 다음 주기에 다시 시도한다.
      try {
        await saveScholarship(db, parseScholarship(await read(url), url, options.now || new Date()));
        count++;
      } catch {
        skipped++;
      }
    }
    if (!count && skipped) throw new Error("공지 본문을 하나도 읽지 못했습니다.");
    const partial = skipped ? `공지 ${skipped}개를 읽지 못해 다음 수집 때 다시 시도합니다.` : null;
    await db.execute({ sql: "UPDATE collection_state SET last_success = ?, next_run = ?, lease_until = NULL, lease_token = NULL, error = ?, count = ? WHERE source = ? AND lease_token = ?", args: [(options.now || new Date()).toISOString(), new Date(now.getTime() + INTERVAL).toISOString(), partial, count, SOURCE, lease] });
    return { skipped: false, collected: count, missed: skipped };
  } catch {
    await db.execute({ sql: "UPDATE collection_state SET next_run = ?, lease_until = NULL, lease_token = NULL, error = ? WHERE source = ? AND lease_token = ?", args: [new Date(now.getTime() + 5 * 60 * 1000).toISOString(), "학교 공지를 갱신하지 못했습니다. 기존 공지는 유지하며 5분 후 재시도합니다.", SOURCE, lease] });
    return { skipped: false, collected: count, failed: true };
  }
}
export async function getScholarshipPreferences(database?: Client): Promise<ScholarshipPreferences> {
  const db = database || await getDatabase();
  const { rows } = await db.execute("SELECT enabled, keywords FROM scholarship_preferences WHERE id = 1");
  return { enabled: Boolean(rows[0].enabled), keywords: String(rows[0].keywords) };
}
export async function saveScholarshipPreferences(input: unknown, database?: Client) {
  const preferences = preferencesSchema.parse(input);
  const db = database || await getDatabase();
  await db.execute({ sql: "UPDATE scholarship_preferences SET enabled = ?, keywords = ? WHERE id = 1", args: [preferences.enabled ? 1 : 0, preferences.keywords] });
  return preferences;
}
// 자동 등록한 장학 일정은 텔레그램으로 알린다: 등록 직후 한 번, 마감 3일 전·1일 전 오전 9시(한국 시간).
// 텔레그램이 꺼져 있으면 알림 워커가 대기시켰다가 연결되면 보낸다.
export function automaticReminders(deadline: string, boundary: Date, now: Date): EventInput["reminders"] {
  const candidates = [new Date(now.getTime() + 60_000)];
  for (const days of [3, 1]) {
    const day = new Date(`${deadline}T09:00:00+09:00`);
    day.setUTCDate(day.getUTCDate() - days);
    candidates.push(day);
  }
  const seen = new Set<string>();
  return candidates
    .filter((at) => at > now && at <= boundary)
    .map((at) => at.toISOString())
    .filter((at) => !seen.has(at) && seen.add(at))
    .map((at) => ({ at, channel: "telegram" as const }));
}

// 새로 등록하는 공지는 Claude가 학생 프로필과 비교해 요약·지원 조건·제출 서류를 분석한다.
// 마감 날짜는 본문 규칙으로 정한 값을 그대로 쓰고, AI 결과로 바꾸지 않는다.
export type NoticeAnalyzer = (notice: ScholarshipNotice, profile: Profile, db: Client, now: Date) => Promise<AnalysisResult>;
// 한 번의 동기화에서 분석하는 새 공지 수. 나머지는 다음 동기화(1분 뒤)로 미뤄 알림 처리가 오래 멈추지 않게 한다.
export const MAX_ANALYSES_PER_SYNC = 3;

const analyzeNotice: NoticeAnalyzer = (notice, profile, db, now) => analyzeText({
  text: `${notice.title}\n\n${notice.body}`.slice(0, 50000),
  kind: "scholarship",
  referenceDate: notice.publishedAt,
  classTime: null,
  sample: false,
}, profile, now, db);

const STATUS_MARKS = { met: "충족", unmet: "불충족", unknown: "확인 필요" } as const;

export function analysisNotes(analysis: AnalysisResult): string {
  const lines = [`[AI 분석] ${analysis.summary}`];
  if (analysis.conditions.length) {
    lines.push(`지원 조건: ${analysis.conditions.slice(0, 6).map((entry) => `${entry.label.replace(/^(필수|우대):\s*/, "")} ${STATUS_MARKS[entry.status]}`).join(" · ")}`);
  }
  if (analysis.documents.length) lines.push(`제출 서류: ${analysis.documents.slice(0, 8).join(", ")}`);
  if (analysis.missing.length) lines.push(`확인 필요: ${analysis.missing.slice(0, 3).join(" / ")}`);
  return lines.join("\n");
}

export async function syncScholarshipEvents(notices: ScholarshipNotice[], database?: Client, now = new Date(), analyze: NoticeAnalyzer = analyzeNotice) {
  const db = database || await getDatabase();
  const preferences = await getScholarshipPreferences(db);
  if (!preferences.enabled) return { created: 0, updated: 0 };
  const keywords = preferences.keywords.split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
  const state = await getState(db);
  const result = { created: 0, updated: 0 };
  let analyses = 0;
  let profile: Profile | undefined;
  const reviewNote = "[원문 변경 확인 필요] 신청 마감을 다시 확인해주세요. 예약 알림을 중지했습니다.\n";
  for (const notice of notices) {
    const { rows } = await db.execute({ sql: "SELECT * FROM scholarship_imports WHERE notice_id = ?", args: [notice.id] });
    const previous = rows[0];
    if (previous?.ignored || previous?.content_hash === notice.contentHash) continue;
    const existing = previous ? state.events.find((event) => event.id === previous.event_id) : state.events.find((event) => event.idempotencyKey === notice.id);
    if (previous && !existing) continue; // A user deleted this event; do not recreate it.
    // Only events still owned by automation may receive source changes.
    if (existing && (existing.completed || existing.idempotencyKey !== notice.id)) continue;
    const needsReview = !notice.deadline || notice.needsReview;
    if (needsReview && !existing) continue;
    const boundary = new Date(`${notice.deadline || existing!.date}T${notice.time || "23:59"}:00+09:00`);
    if (!existing && (boundary <= now || (keywords.length && !keywords.some((word) => `${notice.title} ${notice.body}`.toLowerCase().includes(word))))) continue;
    let analysis: AnalysisResult | null = null;
    let analysisNote = "";
    if (!existing) {
      if (analyses >= MAX_ANALYSES_PER_SYNC) continue;
      analyses++;
      profile ??= state.profile;
      try {
        analysis = await analyze(notice, profile, db, now);
      } catch (error) {
        // AI가 실패해도 마감 일정과 알림은 등록한다.
        analysisNote = error instanceof AIInputError && error.status === 503
          ? "[AI 분석] Anthropic API 키가 없어 분석하지 못했습니다."
          : "[AI 분석] 분석에 실패했습니다. 원문을 직접 확인해주세요.";
        console.error(`장학공지 AI 분석 실패 (${notice.id}): ${error instanceof AIInputError ? error.message : "알 수 없는 오류"}`);
      }
    }
    const autoNote = "국민대 공지에서 자동 등록했습니다. 지원 자격과 제출 서류는 원문을 확인해주세요.";
    const notes = existing?.notes.replace(reviewNote, "") ?? (analysis ? `${analysisNotes(analysis)}\n${autoNote}` : analysisNote ? `${analysisNote}\n${autoNote}` : autoNote);
    const input: EventInput = {
      title: notice.title, kind: "scholarship", date: needsReview ? existing!.date : notice.deadline!, time: needsReview ? existing!.time : notice.time,
      notes: needsReview ? reviewNote + notes : notes,
      source: notice.url, isSample: false,
      checklist: existing?.checklist ?? (notice.documents.length ? notice.documents : analysis?.documents ?? []).slice(0, 30).map((text) => ({ id: randomUUID(), text: text.slice(0, 200), completed: false })),
      reminders: needsReview ? [] : existing?.reminders.filter((reminder) => new Date(reminder.at) > now && new Date(reminder.at) <= boundary)
        ?? automaticReminders(notice.deadline!, boundary, now),
      idempotencyKey: notice.id,
    };
    let eventId: string;
    if (existing) {
      try { await updateEvent(existing.id, input, db, now, existing); }
      catch (error) { if (error instanceof RouteError && [404, 409].includes(error.status)) continue; throw error; }
      eventId = existing.id; result.updated++;
    } else {
      const created = await createEvent(input, db, now);
      eventId = created.events.find((event) => event.idempotencyKey === notice.id)!.id; result.created++;
    }
    await db.execute({ sql: "INSERT INTO scholarship_imports(notice_id, event_id, content_hash) VALUES(?, ?, ?) ON CONFLICT(notice_id) DO UPDATE SET content_hash = excluded.content_hash", args: [notice.id, eventId, notice.contentHash] });
  }
  return result;
}
