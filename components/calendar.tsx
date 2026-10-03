"use client";

import { Fragment, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  differenceInCalendarDays,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Check,
  Clock3,
  ArrowUpRight,
  Plus,
  ListFilter,
} from "lucide-react";
import {
  KIND_LABELS,
  type CalendarEvent,
  type EventKind,
} from "@/lib/contracts";
import { seoulDate } from "./ui";
import { ChecklistProgress } from "./checklist-editor";

export function KindBadge({ kind }: { kind: EventKind }) {
  return (
    <span className={`kind-badge kind-${kind}`}>
      <span className="kind-dot" />
      {KIND_LABELS[kind]}
    </span>
  );
}
export function Deadline({ event }: { event: CalendarEvent }) {
  const gap = differenceInCalendarDays(
    parseISO(event.date),
    parseISO(seoulDate()),
  );
  // KMU80 D-day 단계: 지남(검정 채움) · 오늘(파랑 채움) · D-1~2(주황) · D-3~7(ink) · 이후(ink-4)
  const tone = event.completed
    ? "due-done"
    : gap < 0
      ? "due-overdue"
      : gap === 0
        ? "due-today"
        : gap <= 2
          ? "due-near"
          : gap <= 7
            ? "due-week"
            : "due-later";
  return (
    <span
      className={`deadline ${tone} ${gap < 0 && !event.completed ? "overdue" : gap <= 3 ? "near" : ""}`}
    >
      {event.completed ? (
        "완료"
      ) : gap < 0 ? (
        `${Math.abs(gap)}일 지남`
      ) : gap === 0 ? (
        <>
          <span className="deadline-num" aria-hidden="true">
            D-DAY
          </span>
          <span className="deadline-sr">오늘 마감</span>
        </>
      ) : (
        <span className="deadline-num">{`D-${gap}`}</span>
      )}
    </span>
  );
}

export function EventList({
  events,
  onEdit,
  onToggle,
  compact = false,
  onAdd,
  grouped = false,
}: {
  events: CalendarEvent[];
  onEdit: (event: CalendarEvent) => void;
  onToggle: (event: CalendarEvent) => void;
  compact?: boolean;
  onAdd?: () => void;
  /** 마감순 보기 전용: 지난 마감/오늘/내일/이번 주/다음 주 이후 머리글로 묶는다. events 는 날짜순이어야 한다. */
  grouped?: boolean;
}) {
  if (!events.length)
    return (
      <div className="empty-state">
        <CalendarDays size={28} strokeWidth={1.5} />
        <h3>등록된 일정이 없어요</h3>
        <p>다음 마감을 여기에 모아 두세요.</p>
        {onAdd && (
          <button className="button secondary" onClick={onAdd}>
            <Plus size={15} />
            일정 추가
          </button>
        )}
      </div>
    );
  return (
    <div className={`event-list ${compact ? "compact" : ""}`}>
      <div className="event-table-head">
        <span>마감</span>
        <span>일정</span>
        <span>상태</span>
      </div>
      {events.map((event, index) => {
        const group = grouped ? deadlineGroup(event.date) : null;
        const startsGroup =
          group !== null &&
          (index === 0 || deadlineGroup(events[index - 1].date) !== group);
        return (
          <Fragment key={event.id}>
            {startsGroup && (
              <h3 className="event-group-head">
                {group}
                <span className="event-group-count">
                  {
                    events.filter((item) => deadlineGroup(item.date) === group)
                      .length
                  }
                </span>
              </h3>
            )}
            <div
              className={`event-row ${event.completed ? "event-completed" : ""}`}
            >
              <Deadline event={event} />
              <button className="event-date" onClick={() => onEdit(event)}>
                <span>{format(parseISO(event.date), "M월 d일")}</span>
                {event.time ? (
                  <small>{event.time}</small>
                ) : (
                  <small className="time-unknown">시간 확인 필요</small>
                )}
              </button>
              <button
                className="event-title-button"
                onClick={() => onEdit(event)}
              >
                <span className="event-title">{event.title}</span>
                <span className="event-meta">
                  {event.source && (
                    <span className="event-source">{event.source}</span>
                  )}
                  <ChecklistProgress items={event.checklist} />
                  {event.isSample && <span className="sample-tag">샘플</span>}
                  {!compact && event.notes && (
                    <span className="event-note">{event.notes}</span>
                  )}
                </span>
              </button>
              <span className="event-kind">
                <KindBadge kind={event.kind} />
              </span>
              <button
                className="icon-button event-open"
                title="일정 상세"
                aria-label={`${event.title} 상세`}
                onClick={() => onEdit(event)}
              >
                <ArrowUpRight size={18} />
              </button>
              <button
                type="button"
                className={`check-button ${event.completed ? "is-checked" : ""}`}
                title={event.completed ? "완료 취소" : "완료 처리"}
                aria-label={`${event.title} ${event.completed ? "완료 취소" : "완료 처리"}`}
                onClick={() => onToggle(event)}
              >
                <Check size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

type DeadlineGroup = "지난 마감" | "오늘" | "내일" | "이번 주" | "다음 주 이후";

/** 마감순 목록 머리글 — 오늘(Asia/Seoul) 기준, 주는 달력과 같이 일요일 시작. */
function deadlineGroup(date: string): DeadlineGroup {
  const today = parseISO(seoulDate());
  const gap = differenceInCalendarDays(parseISO(date), today);
  if (gap < 0) return "지난 마감";
  if (gap === 0) return "오늘";
  if (gap === 1) return "내일";
  if (gap <= differenceInCalendarDays(endOfWeek(today), today))
    return "이번 주";
  return "다음 주 이후";
}

export function MonthCalendar({
  events,
  onDateSelect,
  small = false,
  onAdd,
}: {
  events: CalendarEvent[];
  onDateSelect: (date: string) => void;
  small?: boolean;
  /** 전체 달력 전용: 날짜 더블클릭 또는 칸의 "+" 버튼으로 그 날 일정 추가 */
  onAdd?: (date: string) => void;
}) {
  const quickAdd = !small && onAdd ? onAdd : null;
  const today = seoulDate();
  const [month, setMonth] = useState(() => startOfMonth(parseISO(today)));
  const [selected, setSelected] = useState(today);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  });
  return (
    <div className={`calendar ${small ? "calendar-small" : ""}`}>
      <div className="calendar-heading">
        <h3 aria-live="polite" aria-atomic="true">
          <span className="calendar-num">{format(month, "yyyy")}</span>년{" "}
          <span className="calendar-num">{format(month, "M")}</span>월
        </h3>
        <div className="calendar-controls">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMonth(startOfMonth(parseISO(today)));
              setSelected(today);
              onDateSelect(today);
            }}
          >
            오늘
          </button>
          <button
            type="button"
            className="icon-button"
            title="이전 달"
            aria-label="이전 달"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="다음 달"
            aria-label="다음 달"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        <div className="week-label">일</div>
        <div className="week-label">월</div>
        <div className="week-label">화</div>
        <div className="week-label">수</div>
        <div className="week-label">목</div>
        <div className="week-label">금</div>
        <div className="week-label">토</div>
        {days.map((date) => {
          const key = format(date, "yyyy-MM-dd");
          const matching = events.filter((event) => event.date === key);
          const label = format(date, "M월 d일");
          const select = () => {
            setSelected(key);
            onDateSelect(key);
          };
          const day = (
            <button
              key={key}
              type="button"
              aria-label={`${label} 일정 ${matching.length}개`}
              aria-pressed={selected === key}
              className={`calendar-day ${!isSameMonth(date, month) ? "outside-month" : ""} ${today === key ? "today" : ""} ${selected === key ? "selected" : ""}`}
              onClick={select}
              onDoubleClick={quickAdd ? () => quickAdd(key) : undefined}
            >
              <span className="day-number">{date.getDate()}</span>
              <span className="day-events">
                {matching.slice(0, small ? 3 : 2).map((event) =>
                  small ? (
                    <span
                      className={`calendar-dot dot-${event.kind}`}
                      key={event.id}
                    />
                  ) : (
                    <span
                      className={`calendar-event chip-${event.kind} ${event.completed ? "completed" : ""}`}
                      key={event.id}
                    >
                      {event.title}
                    </span>
                  ),
                )}
                {matching.length > (small ? 3 : 2) && (
                  <span className="more-events">
                    +{matching.length - (small ? 3 : 2)}
                  </span>
                )}
              </span>
            </button>
          );
          if (!quickAdd) return day;
          return (
            <div className="calendar-cell" key={key}>
              {day}
              <button
                type="button"
                className="calendar-add"
                aria-label={`${label} 일정 추가`}
                title={`${label} 일정 추가`}
                tabIndex={selected === key ? 0 : -1}
                onClick={() => {
                  select();
                  quickAdd(key);
                }}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CalendarView({
  events,
  onEdit,
  onToggle,
  onAdd,
}: {
  events: CalendarEvent[];
  onEdit: (event: CalendarEvent) => void;
  onToggle: (event: CalendarEvent) => void;
  onAdd: (date?: string) => void;
}) {
  const [display, setDisplay] = useState<"month" | "list">("month");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("active");
  const [selectedDate, setSelectedDate] = useState(seoulDate());
  const filtered = events
    .filter(
      (event) =>
        (kind === "all" || kind === event.kind) &&
        (status === "all" || event.completed === (status === "completed")),
    )
    .sort((a, b) =>
      `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`),
    );
  const daily = filtered.filter((event) => event.date === selectedDate);
  return (
    <>
      <div className="view-toolbar">
        <div className="segmented">
          <button
            className={display === "month" ? "active" : ""}
            onClick={() => setDisplay("month")}
          >
            <CalendarDays size={16} />
            월간
          </button>
          <button
            className={display === "list" ? "active" : ""}
            onClick={() => setDisplay("list")}
          >
            <Clock3 size={16} />
            마감순
          </button>
        </div>
        <div className="filters">
          <ListFilter size={16} />
          <select
            aria-label="일정 종류 필터"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">모든 종류</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="완료 상태 필터"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="active">진행 중</option>
            <option value="completed">완료</option>
            <option value="all">전체</option>
          </select>
        </div>
      </div>
      {display === "month" ? (
        <>
          <MonthCalendar
            events={filtered}
            onDateSelect={setSelectedDate}
            onAdd={(date) => onAdd(date)}
          />
          <div className="section-heading date-events-heading">
            <h2>
              {format(parseISO(selectedDate), "M월 d일")} 일정{" "}
              <span className="count-label">{daily.length}</span>
            </h2>
            <button className="text-button" onClick={() => onAdd(selectedDate)}>
              <Plus size={16} />
              일정 추가
            </button>
          </div>
          <EventList
            events={daily}
            onEdit={onEdit}
            onToggle={onToggle}
            onAdd={() => onAdd(selectedDate)}
          />
        </>
      ) : (
        <EventList
          events={filtered}
          onEdit={onEdit}
          onToggle={onToggle}
          onAdd={() => onAdd()}
          grouped
        />
      )}
    </>
  );
}
