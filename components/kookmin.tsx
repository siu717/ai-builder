"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarPlus,
  CalendarRange,
  ExternalLink,
  Megaphone,
  RefreshCw,
  Sparkles,
  BookOpenCheck,
} from "lucide-react";
import type {
  AppState,
  BookmarkletPayload,
  CalendarEvent,
  KookminBoard,
  KookminImportResult,
  KookminNotice,
  KookminNoticeDetail,
} from "@/lib/contracts";
import { KOOKMIN_BOARD_LABELS } from "@/lib/contracts";
import type { EventDraft } from "./event-editor";
import { Busy, Message, request, seoulDate } from "./ui";
import KookminAnalyze from "./kookmin-analyze";
import EcampusTab from "./kookmin-ecampus";
import {
  dateRange,
  ImportFailures,
  importMessage,
  isScheduleImported,
  ReminderPresets,
  scheduleToImport,
  type PresetKey,
  type ScheduleState,
} from "./kookmin-shared";

type Tab = "schedule" | "notices" | "ecampus";
const TABS: { id: Tab; label: string }[] = [
  { id: "schedule", label: "학사일정" },
  { id: "notices", label: "학교 공지" },
  { id: "ecampus", label: "eCampus 과제" },
];
const BOARDS: KookminBoard[] = ["academic", "scholarship", "general"];

/** "2026-10" → "2026년 10월" */
function monthLabel(key: string) {
  return `${Number(key.slice(0, 4))}년 ${Number(key.slice(5, 7))}월`;
}

export default function Kookmin({
  events,
  schedule,
  onReloadSchedule,
  onAdd,
  onImported,
  onToast,
  initialPayload,
}: {
  events: CalendarEvent[];
  schedule: ScheduleState;
  onReloadSchedule: () => void;
  onAdd: (draft: EventDraft) => void;
  onImported: (state: AppState, summary: KookminImportResult) => void;
  onToast: (text: string) => void;
  initialPayload: BookmarkletPayload | null;
}) {
  const [tab, setTab] = useState<Tab>(initialPayload ? "ecampus" : "schedule");
  const [opened, setOpened] = useState<Tab[]>([tab]);
  const open = useCallback((next: Tab) => {
    setTab(next);
    setOpened((current) =>
      current.includes(next) ? current : [...current, next],
    );
  }, []);
  useEffect(() => {
    if (initialPayload) open("ecampus");
  }, [initialPayload, open]);
  // The modal lives outside the tab containers: a `hidden` tab would hide it
  // while it still locks page scroll.
  const [analyzing, setAnalyzing] = useState<KookminNoticeDetail | null>(null);
  const closeAnalyze = useCallback(() => setAnalyzing(null), []);

  return (
    <>
      <div className="view-toolbar">
        <div className="segmented" role="group" aria-label="국민대 소식 종류">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? "active" : ""}
              aria-pressed={tab === item.id}
              onClick={() => open(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {opened.includes("schedule") && (
        <div hidden={tab !== "schedule"}>
          <ScheduleTab
            events={events}
            schedule={schedule}
            onReload={onReloadSchedule}
            onImported={onImported}
            onToast={onToast}
          />
        </div>
      )}
      {opened.includes("notices") && (
        <div hidden={tab !== "notices"}>
          <NoticesTab onAdd={onAdd} onAnalyze={setAnalyzing} />
        </div>
      )}
      {opened.includes("ecampus") && (
        <div hidden={tab !== "ecampus"}>
          <EcampusTab
            events={events}
            onImported={onImported}
            onToast={onToast}
            initialPayload={initialPayload}
          />
        </div>
      )}
      {analyzing && (
        <KookminAnalyze
          key={analyzing.id}
          notice={analyzing}
          onClose={closeAnalyze}
          onAdd={onAdd}
        />
      )}
    </>
  );
}

function ScheduleTab({
  events,
  schedule,
  onReload,
  onImported,
  onToast,
}: {
  events: CalendarEvent[];
  schedule: ScheduleState;
  onReload: () => void;
  onImported: (state: AppState, summary: KookminImportResult) => void;
  onToast: (text: string) => void;
}) {
  const today = seoulDate();
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [month, setMonth] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<PresetKey[]>(["d1"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<KookminImportResult["failed"]>([]);

  if (schedule.status === "loading")
    return (
      <div className="empty-state">
        <Busy label="학사일정을 불러오는 중" />
      </div>
    );
  if (schedule.status === "error")
    return (
      <div className="empty-state">
        <CalendarRange size={28} strokeWidth={1.5} />
        <h3>학사일정을 불러오지 못했어요</h3>
        <p>{schedule.error}</p>
        <button type="button" className="button secondary" onClick={onReload}>
          <RefreshCw size={15} />
          다시 시도
        </button>
      </div>
    );

  const inRange = schedule.items
    .filter((item) => !upcomingOnly || item.endDate >= today)
    .sort((a, b) =>
      `${a.startDate}${a.endDate}`.localeCompare(`${b.startDate}${b.endDate}`),
    );
  const monthKeys = [
    ...new Set(inRange.map((item) => item.startDate.slice(0, 7))),
  ];
  // A month that the "upcoming only" toggle just hid falls back to all months.
  const activeMonth = monthKeys.includes(month) ? month : "all";
  const visible = inRange.filter(
    (item) => activeMonth === "all" || item.startDate.startsWith(activeMonth),
  );
  const imported = new Set(
    visible.filter((item) => isScheduleImported(events, item)).map((i) => i.id),
  );
  const selectable = visible.filter((item) => !imported.has(item.id));
  const chosen = visible.filter((item) => selected.has(item.id));
  const allSelected =
    selectable.length > 0 && selectable.every((item) => selected.has(item.id));
  const months = new Map<string, typeof visible>();
  for (const item of visible) {
    const key = item.startDate.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), item]);
  }
  const titles = new Map(schedule.items.map((item) => [item.id, item.title]));

  async function importSelected() {
    if (busy || !chosen.length) return;
    setBusy(true);
    setError("");
    setFailed([]);
    try {
      const result = await request<KookminImportResult>(
        "/api/kookmin/import",
        "POST",
        { items: chosen.map((item) => scheduleToImport(item, presets)) },
      );
      onImported(result.state, result);
      onToast(importMessage("학사일정", result));
      setFailed(result.failed);
      setSelected(new Set(result.failed.map((item) => item.idempotencyKey)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "학사일정을 가져오지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="학사일정">
      <div className="kmu-controls">
        <select
          aria-label="월 필터"
          value={activeMonth}
          disabled={busy}
          onChange={(event) => setMonth(event.target.value)}
        >
          <option value="all">모든 달</option>
          {monthKeys.map((key) => (
            <option key={key} value={key}>
              {monthLabel(key)}
            </option>
          ))}
        </select>
        <label className="kmu-check">
          <input
            type="checkbox"
            checked={upcomingOnly}
            disabled={busy}
            onChange={(event) => setUpcomingOnly(event.target.checked)}
          />
          다가오는 일정만
        </label>
        <label className="kmu-check">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={busy || !selectable.length}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? new Set(selectable.map((item) => item.id))
                  : new Set(),
              )
            }
          />
          전체 선택
        </label>
      </div>
      <ImportFailures failed={failed} titles={titles} />
      {!visible.length ? (
        <div className="empty-state">
          <CalendarRange size={28} strokeWidth={1.5} />
          <h3>
            {upcomingOnly ? "다가오는 학사일정이 없어요" : "학사일정이 없어요"}
          </h3>
        </div>
      ) : (
        [...months.entries()].map(([key, items]) => (
          <div className="kmu-month" key={key}>
            <h3>{monthLabel(key)}</h3>
            <ul className="kmu-list">
              {items.map((item) => (
                <li className="kmu-row" key={item.id}>
                  <input
                    type="checkbox"
                    className="kmu-checkbox"
                    aria-label={`${item.title} 선택`}
                    checked={selected.has(item.id)}
                    disabled={busy}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      setSelected(next);
                    }}
                  />
                  <span className="kmu-date">
                    {dateRange(item.startDate, item.endDate)}
                  </span>
                  <span className="kmu-title">
                    <span className="calendar-dot dot-academic" />
                    {item.title}
                  </span>
                  {imported.has(item.id) && (
                    <span className="kmu-chip">가져옴</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <div className="kmu-import-bar">
        <ReminderPresets
          idPrefix="kmu-schedule-preset"
          value={presets}
          onChange={setPresets}
          disabled={busy}
        />
        <button
          type="button"
          className="button primary kmu-import-button"
          disabled={busy || !chosen.length}
          onClick={importSelected}
        >
          {busy ? (
            <Busy label="가져오는 중" />
          ) : (
            <>
              <CalendarPlus size={16} />
              선택 항목 캘린더에 가져오기 ({chosen.length})
            </>
          )}
        </button>
        {error && <Message text={error} error />}
      </div>
    </section>
  );
}

type NoticePage = {
  items: KookminNotice[];
  board: KookminBoard;
  page: number;
  hasMore: boolean;
  fetchedAt: string;
};

function NoticesTab({
  onAdd,
  onAnalyze,
}: {
  onAdd: (draft: EventDraft) => void;
  onAnalyze: (detail: KookminNoticeDetail) => void;
}) {
  const [board, setBoard] = useState<KookminBoard>("academic");
  const [items, setItems] = useState<KookminNotice[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(
    null,
  );
  const token = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (nextBoard: KookminBoard, nextPage: number) => {
    const current = ++token.current;
    setLoading(true);
    setError("");
    if (nextPage === 1) setItems([]);
    try {
      const data = await request<NoticePage>(
        `/api/kookmin/notices?board=${nextBoard}&page=${nextPage}`,
      );
      if (current !== token.current) return;
      setItems((previous) => {
        if (nextPage === 1) return data.items;
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...data.items.filter((i) => !known.has(i.id))];
      });
      setPage(nextPage);
      setHasMore(data.hasMore);
    } catch (err) {
      if (current === token.current)
        setError(
          err instanceof Error ? err.message : "공지를 불러오지 못했습니다.",
        );
    } finally {
      if (current === token.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(board, 1);
  }, [board, load]);

  async function withDetail(
    notice: KookminNotice,
    action: (detail: KookminNoticeDetail) => void,
  ) {
    if (pending) return;
    setPending(notice.id);
    setRowError(null);
    try {
      const data = await request<{ item: KookminNoticeDetail }>(
        `/api/kookmin/notices/${notice.board}/${encodeURIComponent(notice.articleNo)}`,
      );
      // Leaving the view while the notice loads must not pop a dialog later.
      if (alive.current) action(data.item);
    } catch (err) {
      setRowError({
        id: notice.id,
        text:
          err instanceof Error
            ? err.message
            : "공지 내용을 불러오지 못했습니다.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="학교 공지">
      <div className="kmu-controls">
        <div className="segmented" role="group" aria-label="공지 게시판">
          {BOARDS.map((value) => (
            <button
              type="button"
              key={value}
              className={board === value ? "active" : ""}
              aria-pressed={board === value}
              onClick={() => setBoard(value)}
            >
              {KOOKMIN_BOARD_LABELS[value]}
            </button>
          ))}
        </div>
      </div>
      {items.length > 0 && (
        <ul className="kmu-list">
          {items.map((notice) => (
            <li className="kmu-notice" key={notice.id}>
              {/* Pinned notices carry no date in the board list. */}
              <span className="kmu-date">{notice.date || "상단 고정"}</span>
              <a
                className="kmu-notice-title"
                href={notice.url}
                target="_blank"
                rel="noreferrer"
              >
                {notice.title}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              <div className="kmu-notice-actions">
                {pending === notice.id && <Busy label="불러오는 중" />}
                <button
                  type="button"
                  className="button secondary"
                  disabled={pending !== null}
                  aria-label={`${notice.title} AI로 분석`}
                  onClick={() => withDetail(notice, onAnalyze)}
                >
                  <Sparkles size={14} />
                  AI로 분석
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={pending !== null}
                  aria-label={`${notice.title} 일정 등록`}
                  onClick={() =>
                    withDetail(notice, (detail) =>
                      onAdd({
                        kind:
                          detail.board === "scholarship"
                            ? "scholarship"
                            : "academic",
                        title: detail.title.slice(0, 200),
                        date: "",
                        time: null,
                        notes: detail.text.slice(0, 2000),
                        source: detail.url,
                        isSample: false,
                        reminders: [],
                      }),
                    )
                  }
                >
                  <CalendarPlus size={14} />
                  일정 등록
                </button>
              </div>
              {rowError?.id === notice.id && (
                <p className="kmu-row-error" role="alert">
                  {rowError.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="empty-state kmu-compact">
          <Megaphone size={28} strokeWidth={1.5} />
          <h3>공지를 불러오지 못했어요</h3>
          <p>{error}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => load(board, items.length ? page + 1 : 1)}
          >
            <RefreshCw size={15} />
            다시 시도
          </button>
        </div>
      ) : loading ? (
        <div className={`empty-state ${items.length ? "kmu-compact" : ""}`}>
          <Busy label="공지를 불러오는 중" />
        </div>
      ) : !items.length ? (
        <div className="empty-state">
          <BookOpenCheck size={28} strokeWidth={1.5} />
          <h3>등록된 공지가 없어요</h3>
        </div>
      ) : (
        hasMore && (
          <div className="kmu-more">
            <button
              type="button"
              className="button secondary"
              onClick={() => load(board, page + 1)}
            >
              더 보기
            </button>
          </div>
        )
      )}
    </section>
  );
}
