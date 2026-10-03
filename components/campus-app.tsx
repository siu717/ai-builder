"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  LayoutDashboard,
  GraduationCap,
  BriefcaseBusiness,
  MessagesSquare,
  CalendarDays,
  Bell,
  Settings2,
  ChevronRight,
  Plus,
  FileText,
  ArrowRight,
  UserRound,
  CheckCheck,
  Send,
  CircleAlert,
  X,
  Sparkles,
  ArrowUpRight,
  RefreshCw,
  Layers,
  Clock3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AppState,
  CalendarEvent,
  Opportunity,
  ReminderRecord,
} from "@/lib/contracts";
import { KIND_LABELS } from "@/lib/contracts";
import EventEditor, { type EventDraft } from "./event-editor";
import CalendarView, { EventList, KindBadge, MonthCalendar } from "./calendar";
import Opportunities from "./opportunities";
import { AnalyzeModal, Coaching } from "./ai-tools";
import Settings from "./settings";
import { Busy, Message, request, seoulDate } from "./ui";

type View =
  | "today"
  | "scholarship"
  | "job"
  | "coaching"
  | "calendar"
  | "notifications"
  | "settings";
const NAV: {
  id: View;
  label: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}[] = [
  {
    id: "today",
    label: "오늘",
    icon: LayoutDashboard,
    title: "오늘의 캠퍼스",
    subtitle: "오늘 할 일과 다가오는 마감을 확인하세요.",
  },
  {
    id: "scholarship",
    label: "장학금",
    icon: GraduationCap,
    title: "장학금",
    subtitle: "지원 조건과 준비할 서류를 함께 확인하세요.",
  },
  {
    id: "job",
    label: "취업 정보",
    icon: BriefcaseBusiness,
    title: "취업 정보",
    subtitle: "관심 직무의 공고와 지원 조건을 확인하세요.",
  },
  {
    id: "coaching",
    label: "취업 컨설팅",
    icon: MessagesSquare,
    title: "취업 컨설팅",
    subtitle: "지원 서류를 다듬고 면접 준비를 이어가세요.",
  },
  {
    id: "calendar",
    label: "캘린더",
    icon: CalendarDays,
    title: "통합 캘린더",
    subtitle: "장학금부터 과제까지 일정을 관리하세요.",
  },
  {
    id: "notifications",
    label: "알림",
    icon: Bell,
    title: "알림함",
    subtitle: "다가오는 일정과 발송된 알림을 확인하세요.",
  },
  {
    id: "settings",
    label: "설정",
    icon: Settings2,
    title: "프로필 및 알림 설정",
    subtitle: "나의 정보와 알림 수신 방법을 관리하세요.",
  },
];

export default function CampusApp() {
  const [app, setApp] = useState<AppState | null>(null);
  const [catalog, setCatalog] = useState<Opportunity[]>([]);
  const [view, setView] = useState<View>("today");
  const [editor, setEditor] = useState<EventDraft | null>(null);
  const [analysis, setAnalysis] = useState<
    "assignment" | "scholarship" | "job" | null
  >(null);
  const [coachJob, setCoachJob] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [syncError, setSyncError] = useState(false);
  const [initialError, setInitialError] = useState("");
  const [sampleBusy, setSampleBusy] = useState(false);
  const stateRef = useRef<AppState | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const toggling = useRef(new Set<string>());
  const mutationRef = useRef(false);
  const revisionRef = useRef(0);
  const [loadKey, setLoadKey] = useState(0);
  const today = seoulDate();

  const loadCatalog = useCallback(async () => {
    try {
      const data = await request<{ opportunities: Opportunity[] }>(
        "/api/catalog",
      );
      setCatalog(data.opportunities);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "공고를 불러오지 못했습니다.",
      );
    }
  }, []);

  const applyState = useCallback(
    (next: AppState) => {
      const previous = stateRef.current;
      revisionRef.current += 1;
      stateRef.current = next;
      setApp(next);
      if (
        previous &&
        JSON.stringify(previous.profile) !== JSON.stringify(next.profile)
      )
        void loadCatalog();
    },
    [loadCatalog],
  );

  useEffect(() => {
    let alive = true;
    setInitialError("");
    async function load() {
      try {
        const state = await request<AppState>("/api/state");
        if (!alive) return;
        let stored: unknown = [];
        try {
          stored = JSON.parse(
            localStorage.getItem("campus-notifications-seen") || "[]",
          );
        } catch {
          /* A corrupt local cache does not affect stored schedules. */
        }
        seenRef.current = new Set(
          Array.isArray(stored)
            ? stored.filter((id): id is string => typeof id === "string")
            : [],
        );
        state.notifications
          .filter((item) => item.status === "sent")
          .forEach((item) => seenRef.current.add(item.id));
        try {
          localStorage.setItem(
            "campus-notifications-seen",
            JSON.stringify([...seenRef.current]),
          );
        } catch {
          /* Browser storage is optional for server-owned reminders. */
        }
        applyState(state);
        await loadCatalog();
      } catch (err) {
        if (alive)
          setInitialError(
            err instanceof Error ? err.message : "일정을 불러오지 못했습니다.",
          );
      }
    }
    void load();
    const timer = window.setInterval(async () => {
      if (!stateRef.current || mutationRef.current) return;
      const revision = revisionRef.current;
      try {
        const state = await request<AppState>("/api/state");
        if (!alive || mutationRef.current || revision !== revisionRef.current)
          return;
        const fresh = state.notifications.filter(
          (item) =>
            item.channel === "app" &&
            item.status === "sent" &&
            !seenRef.current.has(item.id),
        );
        state.notifications
          .filter((item) => item.status === "sent")
          .forEach((item) => seenRef.current.add(item.id));
        try {
          localStorage.setItem(
            "campus-notifications-seen",
            JSON.stringify([...seenRef.current]),
          );
        } catch {
          /* Keep the in-memory duplicate guard when storage is unavailable. */
        }
        fresh.forEach((item) => {
          setToast(`일정 알림: ${item.title}`);
          if (
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              const notification = new Notification(
                `참십 Campus · ${KIND_LABELS[item.kind]}`,
                { body: item.title, tag: item.id },
              );
              notification.onclick = () => {
                window.focus();
                setView("notifications");
                notification.close();
              };
            } catch {
              /* Native notifications may be unavailable even when permission is granted. */
            }
          }
        });
        applyState(state);
        setSyncError(false);
      } catch {
        if (alive) setSyncError(true);
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [applyState, loadCatalog, loadKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeAnalysis = useCallback(() => setAnalysis(null), []);

  async function toggleEvent(event: CalendarEvent) {
    if (toggling.current.has(event.id)) return;
    toggling.current.add(event.id);
    mutationRef.current = true;
    try {
      applyState(
        await request<AppState>(`/api/events/${event.id}`, "PATCH", {
          completed: !event.completed,
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "완료 상태를 바꾸지 못했습니다.",
      );
    } finally {
      toggling.current.delete(event.id);
      mutationRef.current = false;
    }
  }

  async function sampleSchedules() {
    if (sampleBusy) return;
    setSampleBusy(true);
    mutationRef.current = true;
    setError("");
    const samples = [
      {
        title: "미래인재 장학금 신청",
        kind: "scholarship" as const,
        offset: 3,
        notes: "성적증명서와 재학증명서 준비",
      },
      {
        title: "서비스 개발 인턴 지원",
        kind: "job" as const,
        offset: 5,
        notes: "이력서와 포트폴리오 최종 확인",
      },
      {
        title: "자기소개서 경험 정리",
        kind: "career" as const,
        offset: 2,
        notes: "프로젝트 역할과 성과를 사실에 맞게 정리",
      },
      {
        title: "데이터베이스 과제 제출",
        kind: "assignment" as const,
        offset: 1,
        notes: "eCampus 과제함에 PDF 제출",
      },
    ];
    try {
      for (const item of samples) {
        applyState(
          await request<AppState>("/api/events", "POST", {
            title: item.title,
            kind: item.kind,
            date: format(addDays(parseISO(today), item.offset), "yyyy-MM-dd"),
            time: null,
            notes: item.notes,
            source: "참십 Campus 샘플",
            isSample: true,
            reminders: [],
            idempotencyKey: `campus-sample-${today}-${item.kind}`,
          }),
        );
      }
      setToast("샘플 일정 4개를 추가했습니다.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "샘플 일정을 추가하지 못했습니다.",
      );
    } finally {
      setSampleBusy(false);
      mutationRef.current = false;
    }
  }

  async function readNotifications(ids?: string[]) {
    mutationRef.current = true;
    try {
      applyState(
        await request<AppState>(
          "/api/notifications/read",
          "POST",
          ids ? { ids } : {},
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "알림을 읽음 처리하지 못했습니다.",
      );
    } finally {
      mutationRef.current = false;
    }
  }

  if (!app)
    return (
      <div className="initial-screen">
        <div className="brand">
          <span className="brand-symbol">C</span>
          <strong>
            참십 <span>Campus</span>
          </strong>
        </div>
        {initialError ? (
          <>
            <Message text={initialError} error />
            <button
              className="button secondary"
              onClick={() => setLoadKey((value) => value + 1)}
            >
              <RefreshCw size={16} />
              다시 불러오기
            </button>
          </>
        ) : (
          <Busy label="캠퍼스를 불러오는 중" />
        )}
      </div>
    );

  const current = NAV.find((item) => item.id === view)!;
  const unread = app.notifications.filter(
    (item) =>
      (item.status === "sent" || item.status === "failed") && !item.read,
  ).length;
  const editEvent = (event: CalendarEvent) => setEditor(event);
  const addEvent = (date?: string) => setEditor({ date: date || today });
  const pageContext = view === "today"
    ? format(parseISO(today), "yyyy년 M월 d일")
    : view === "scholarship" || view === "job"
      ? `샘플 공고 ${catalog.filter((item) => item.kind === view).length}개 · ${app.profile.major || "전공 미입력"}`
      : view === "calendar"
        ? `진행 중 ${app.events.filter((event) => !event.completed).length}개 · 완료 ${app.events.filter((event) => event.completed).length}개`
        : view === "notifications"
          ? `읽지 않은 알림 ${unread}개`
          : view === "settings"
            ? `${app.profile.name} · Asia/Seoul`
            : app.profile.interests || "관심 직무 미입력";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          title="오늘의 캠퍼스"
          onClick={() => setView("today")}
        >
          <span className="brand-symbol">C</span>
          <strong>
            참십 <span>Campus</span>
          </strong>
        </button>
        <div className="workspace-label">MY CAMPUS</div>
        <nav className="main-nav" aria-label="주 메뉴">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`nav-item ${view === id ? "active" : ""} ${id === "settings" ? "nav-settings" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                setView(id);
                setError("");
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "notifications" && unread > 0 && (
                <span className="nav-count">{unread}</span>
              )}
              {view === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="campus-photo">
            <img src="/campus.jpg" alt="졸업을 기념하는 학생들" />
          </div>
          <button
            className="sidebar-profile"
            onClick={() => setView("settings")}
          >
            <span className="avatar">{app.profile.name.slice(0, 1)}</span>
            <span>
              <strong>{app.profile.name}</strong>
              <small>{app.profile.major || "학생 프로필"}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>내 캠퍼스</span>
            <ChevronRight size={14} />
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-actions">
            {app.settings.accessMode === "anonymous" && (
              <span className="guest-label">
                <UserRound size={13} />
                게스트
              </span>
            )}
            {syncError && (
              <span
                className="sync-warning"
                title="다음 갱신에서 다시 연결합니다"
              >
                <CircleAlert size={15} />
                연결 확인 중
              </span>
            )}
            <span className="topbar-date">
              {format(parseISO(today), "yyyy.MM.dd")}
            </span>
            <button
              type="button"
              className="icon-button notification-button"
              title="알림함"
              aria-label={`알림함, 읽지 않은 알림 ${unread}개`}
              onClick={() => setView("notifications")}
            >
              <Bell size={19} />
              {unread > 0 && <span className="notification-dot" />}
            </button>
            <button
              className="avatar topbar-avatar"
              title="내 프로필"
              aria-label="내 프로필"
              onClick={() => setView("settings")}
            >
              {app.profile.name.slice(0, 1)}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                {view === "today"
                  ? `${app.profile.name}님의 오늘`
                  : "MY CAMPUS"}
              </div>
              <h1>{current.title}</h1>
              <p>{pageContext}</p>
            </div>
            {view !== "settings" && (
              <div className="heading-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    setAnalysis(
                      view === "scholarship"
                        ? "scholarship"
                        : view === "job"
                          ? "job"
                          : "assignment",
                    )
                  }
                >
                  <FileText size={16} />
                  공지 입력
                </button>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => addEvent()}
                >
                  <Plus size={17} />
                  일정 추가
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="dismiss-message">
              <Message text={error} error />
              <button
                className="icon-button"
                aria-label="오류 메시지 닫기"
                title="닫기"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "today" && (
            <Dashboard
              app={app}
              onEdit={editEvent}
              onToggle={toggleEvent}
              onAdd={() => addEvent()}
              onNavigate={setView}
              onSamples={sampleSchedules}
              sampleBusy={sampleBusy}
              onAnalyze={() => setAnalysis("assignment")}
            />
          )}
          {(view === "scholarship" || view === "job") && (
            <Opportunities
              key={view}
              kind={view}
              opportunities={catalog}
              onAdd={setEditor}
              onAnalyze={() => setAnalysis(view)}
              onCoach={(text) => {
                setCoachJob(text);
                setView("coaching");
              }}
            />
          )}
          {view === "coaching" && (
            <Coaching
              configured={app.settings.aiConfigured}
              initialJob={coachJob}
              onAdd={setEditor}
            />
          )}
          {view === "calendar" && (
            <CalendarView
              events={app.events}
              onEdit={editEvent}
              onToggle={toggleEvent}
              onAdd={addEvent}
            />
          )}
          {view === "notifications" && (
            <Notifications
              notifications={app.notifications}
              events={app.events}
              onRead={readNotifications}
              onEdit={editEvent}
              onSettings={() => setView("settings")}
            />
          )}
          {view === "settings" && (
            <Settings
              profile={app.profile}
              settings={app.settings}
              onSave={applyState}
            />
          )}
          <footer className="workspace-footer">
            <span>참십 Campus</span>
            <span>
              <Clock3 size={12} />
              Asia/Seoul
            </span>
          </footer>
        </main>
      </div>
      {editor && (
        <EventEditor
          initial={editor}
          settings={app.settings}
          onClose={closeEditor}
          onSave={(next) => {
            applyState(next);
            setToast("일정을 저장했습니다.");
          }}
        />
      )}
      {analysis && (
        <AnalyzeModal
          kind={analysis}
          configured={app.settings.aiConfigured}
          onClose={closeAnalysis}
          onAdd={setEditor}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Bell size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            title="닫기"
            aria-label="알림 닫기"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  app,
  onEdit,
  onToggle,
  onAdd,
  onNavigate,
  onSamples,
  sampleBusy,
  onAnalyze,
}: {
  app: AppState;
  onEdit: (event: CalendarEvent) => void;
  onToggle: (event: CalendarEvent) => void;
  onAdd: () => void;
  onNavigate: (view: View) => void;
  onSamples: () => void;
  sampleBusy: boolean;
  onAnalyze: () => void;
}) {
  const today = seoulDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [filter, setFilter] = useState("all");
  const active = app.events.filter((event) => !event.completed);
  const dueToday = active.filter((event) => event.date === today).length;
  const week = active.filter((event) => {
    const gap = differenceInCalendarDays(parseISO(event.date), parseISO(today));
    return gap >= 0 && gap <= 7;
  }).length;
  const missed = active.filter((event) => event.date < today).length;
  const upcoming = active
    .filter((event) => filter === "all" || event.kind === filter)
    .sort((a, b) =>
      `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`),
    )
    .slice(0, 8);
  const pending = app.notifications
    .filter((item) => item.status === "pending" || item.status === "sending")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 3);
  const selected = active.filter((event) => event.date === selectedDate);
  return (
    <>
      <div className="summary-strip">
        <Summary
          icon={CalendarDays}
          label="오늘 마감"
          value={dueToday}
          tone="green"
        />
        <Summary icon={Layers} label="이번 주 일정" value={week} tone="cyan" />
        <Summary
          icon={CircleAlert}
          label="지난 마감"
          value={missed}
          tone="amber"
        />
        <Summary
          icon={CheckCheck}
          label="완료한 일정"
          value={app.events.filter((event) => event.completed).length}
          tone="violet"
        />
      </div>
      <div className="dashboard-layout">
        <div className="dashboard-main">
          <section className="deadlines-section">
            <div className="section-heading">
              <h2>
                다가오는 마감{" "}
                <span className="count-label">{active.length}</span>
              </h2>
              <button
                className="text-button"
                onClick={() => onNavigate("calendar")}
              >
                전체 보기 <ArrowRight size={15} />
              </button>
            </div>
            <div className="category-tabs">
              {[
                ["all", "전체"],
                ["assignment", "과제"],
                ["scholarship", "장학금"],
                ["job", "채용"],
                ["career", "취업 준비"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <EventList
              events={upcoming}
              onEdit={onEdit}
              onToggle={onToggle}
              onAdd={onAdd}
            />
            {!app.events.length && (
              <div className="sample-action">
                <button
                  className="text-button"
                  disabled={sampleBusy}
                  onClick={onSamples}
                >
                  {sampleBusy ? (
                    <Busy label="추가 중" />
                  ) : (
                    <>
                      <Layers size={15} />
                      샘플 일정 추가
                    </>
                  )}
                </button>
              </div>
            )}
          </section>
          <section className="next-section">
            <div className="section-heading">
              <h2>캠퍼스에서 다음으로</h2>
            </div>
            <div className="quick-actions">
              <button onClick={() => onNavigate("scholarship")}>
                <span className="quick-icon violet">
                  <GraduationCap size={24} />
                </span>
                <span>
                  <strong>장학금 찾아보기</strong>
                  <small>{app.events.filter((event) => event.kind === "scholarship").length}개 신청 일정</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button onClick={() => onNavigate("job")}>
                <span className="quick-icon cyan">
                  <BriefcaseBusiness size={23} />
                </span>
                <span>
                  <strong>취업 준비 이어가기</strong>
                  <small>{app.events.filter((event) => event.kind === "job").length}개 지원 일정</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button onClick={onAnalyze}>
                <span className="quick-icon amber">
                  <FileText size={23} />
                </span>
                <span>
                  <strong>과제 공지 정리하기</strong>
                  <small>{app.events.filter((event) => event.kind === "assignment").length}개 제출 일정</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            </div>
          </section>
        </div>
        <aside className="dashboard-aside">
          <section className="mini-calendar-section">
            <MonthCalendar
              small
              events={active}
              onDateSelect={setSelectedDate}
            />
            <div className="selected-day">
              <div>
                <strong>{format(parseISO(selectedDate), "M월 d일")}</strong>
                <span>
                  {selected.length
                    ? `일정 ${selected.length}개`
                    : "여유로운 하루"}
                </span>
              </div>
              {selected.slice(0, 3).map((event) => (
                <button
                  className="mini-event"
                  onClick={() => onEdit(event)}
                  key={event.id}
                >
                  <span className={`calendar-dot dot-${event.kind}`} />
                  <span>{event.title}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </section>
          <section className="upcoming-notifications">
            <div className="section-heading">
              <h2>다가오는 알림</h2>
              <button
                className="icon-button"
                title="알림함 보기"
                aria-label="알림함 보기"
                onClick={() => onNavigate("notifications")}
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
            {pending.length ? (
              pending.map((item) => (
                <div className="pending-notification" key={item.id}>
                  <span className="notification-kind-icon">
                    {item.channel === "telegram" ? (
                      <Send size={16} />
                    ) : (
                      <Bell size={16} />
                    )}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {notificationTime(item.scheduledAt)} ·{" "}
                      {item.channel === "telegram" ? "텔레그램" : "앱"}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <div className="small-empty">
                <Bell size={21} strokeWidth={1.5} />
                <span>예약된 알림이 없어요</span>
              </div>
            )}
            <button
              className="telegram-link"
              onClick={() => onNavigate("settings")}
            >
              <Send size={16} />
              <span>
                {app.settings.telegramConfigured && app.settings.telegramEnabled
                  ? "텔레그램 연결됨"
                  : "텔레그램 연결하기"}
              </span>
              <ChevronRight size={14} />
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="summary-item">
      <span className={`summary-icon ${tone}`}>
        <Icon size={20} />
      </span>
      <div>
        <span>{label}</span>
        <strong>
          {value}
          <small>개</small>
        </strong>
      </div>
    </div>
  );
}
function notificationTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
function Notifications({
  notifications,
  events,
  onRead,
  onEdit,
  onSettings,
}: {
  notifications: ReminderRecord[];
  events: CalendarEvent[];
  onRead: (ids?: string[]) => void;
  onEdit: (event: CalendarEvent) => void;
  onSettings: () => void;
}) {
  const [filter, setFilter] = useState("received");
  const records = notifications
    .filter((item) =>
      filter === "received"
        ? item.status === "sent" || item.status === "failed"
        : filter === "unread"
          ? !item.read && (item.status === "sent" || item.status === "failed")
          : item.status === "pending" || item.status === "sending",
    )
    .sort((a, b) =>
      filter === "scheduled"
        ? a.scheduledAt.localeCompare(b.scheduledAt)
        : b.scheduledAt.localeCompare(a.scheduledAt),
    );
  const labels = {
    pending: "예약됨",
    sending: "발송 중",
    sent: "발송됨",
    failed: "발송 실패",
    cancelled: "취소됨",
  };
  return (
    <>
      <div className="view-toolbar">
        <div className="segmented">
          <button
            className={filter === "received" ? "active" : ""}
            onClick={() => setFilter("received")}
          >
            받은 알림
          </button>
          <button
            className={filter === "unread" ? "active" : ""}
            onClick={() => setFilter("unread")}
          >
            읽지 않음
          </button>
          <button
            className={filter === "scheduled" ? "active" : ""}
            onClick={() => setFilter("scheduled")}
          >
            예약된 알림
          </button>
        </div>
        <button
          className="button secondary"
          onClick={() => onRead()}
          disabled={
            !notifications.some(
              (item) =>
                !item.read &&
                (item.status === "sent" || item.status === "failed"),
            )
          }
        >
          <CheckCheck size={16} />
          모두 읽음
        </button>
      </div>
      {!records.length ? (
        <div className="empty-state notification-empty">
          <Bell size={31} strokeWidth={1.5} />
          <h3>
            {filter === "scheduled"
              ? "예약된 알림이 없어요"
              : "새로운 알림이 없어요"}
          </h3>
          <button className="button secondary" onClick={onSettings}>
            <Send size={15} />
            텔레그램 설정
          </button>
        </div>
      ) : (
        <div className="notifications-list">
          {records.map((item) => {
            const event = events.find((entry) => entry.id === item.eventId);
            return (
              <article
                key={item.id}
                className={`notification-row ${!item.read ? "unread" : ""}`}
              >
                <span
                  className={`notification-kind-icon ${item.status === "failed" ? "failed" : ""}`}
                >
                  {item.status === "failed" ? (
                    <CircleAlert size={19} />
                  ) : item.channel === "telegram" ? (
                    <Send size={18} />
                  ) : (
                    <Bell size={18} />
                  )}
                </span>
                <div className="notification-content">
                  <button
                    className="notification-title"
                    disabled={!event}
                    onClick={() => {
                      if (event) onEdit(event);
                      if (!item.read) onRead([item.id]);
                    }}
                  >
                    {item.title}
                  </button>
                  <div className="event-meta">
                    <KindBadge kind={item.kind} />
                    <span>{notificationTime(item.scheduledAt)}</span>
                    <span>
                      {item.channel === "telegram" ? "텔레그램" : "앱 알림"}
                    </span>
                  </div>
                  {item.error && (
                    <p className="notification-error">{item.error}</p>
                  )}
                </div>
                <span
                  className={`notification-status ${item.status === "failed" ? "overdue" : ""}`}
                >
                  {labels[item.status]}
                </span>
                {!item.read &&
                  (item.status === "sent" || item.status === "failed") && (
                    <button
                      className="icon-button"
                      title="읽음 처리"
                      aria-label={`${item.title} 알림 읽음 처리`}
                      onClick={() => onRead([item.id])}
                    >
                      <CheckCheck size={18} />
                    </button>
                  )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
