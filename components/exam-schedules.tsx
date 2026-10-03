"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Database, RefreshCw, Search } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  QUALIFICATION_TYPES,
  type ExamSchedule,
  type ExamStep,
  type PublicDataResult,
  type QualificationType,
} from "@/lib/contracts";
import type { EventDraft } from "./event-editor";
import { Busy, Message, request, seoulDate } from "./ui";

const SOURCE = "한국산업인력공단 국가자격 시험일정 (공공데이터포털)";

function stepDate(step: ExamStep): string {
  // 원서접수는 마감일, 시험·발표는 시작일을 일정 날짜로 쓴다.
  return (step.id.endsWith("reg") ? step.end || step.start : step.start || step.end)!;
}

function range(step: ExamStep): string {
  const start = step.start && format(parseISO(step.start), "M.d");
  const end = step.end && format(parseISO(step.end), "M.d");
  return start && end && start !== end ? `${start} ~ ${end}` : start || end || "";
}

export default function ExamSchedules({
  dataKeyReady,
  onSettings,
  onAdd,
}: {
  dataKeyReady: boolean;
  onSettings: () => void;
  onAdd: (draft: EventDraft) => void;
}) {
  const today = seoulDate();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const [qualification, setQualification] = useState<QualificationType>("T");
  const [query, setQuery] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [data, setData] = useState<PublicDataResult<ExamSchedule> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!dataKeyReady) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    request<PublicDataResult<ExamSchedule>>(
      `/api/public-data?source=exams&year=${year}&qualification=${qualification}${reload ? "&refresh=1" : ""}`,
    )
      .then((result) => !cancelled && setData(result))
      .catch(
        (err) =>
          !cancelled &&
          setError(
            err instanceof Error ? err.message : "시험일정을 불러오지 못했습니다.",
          ),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dataKeyReady, year, qualification, reload]);

  if (!dataKeyReady) {
    return (
      <div className="empty-state">
        <Database size={27} />
        <h3>공공데이터포털 인증키가 필요해요</h3>
        <p>
          큐넷 국가자격 시험일정을 활용신청한 뒤 설정 → 외부 데이터 API에 인증키를
          입력하세요.
        </p>
        <button type="button" className="button primary" onClick={onSettings}>
          설정에서 키 입력
        </button>
      </div>
    );
  }

  const schedules = (data?.items || []).filter(
    (item) =>
      item.title.toLowerCase().includes(query.trim().toLowerCase()) &&
      (showPast || item.steps.some((step) => stepDate(step) >= today)),
  );

  function draft(schedule: ExamSchedule, step: ExamStep): EventDraft {
    const registration = step.id.endsWith("reg");
    return {
      title: `${schedule.title} ${step.label}${registration ? " 마감" : ""}`.slice(0, 200),
      kind: "career",
      date: stepDate(step),
      time: null,
      notes: `${step.label}: ${step.start || "?"} ~ ${step.end || step.start || "?"}\n시각은 큐넷 공고에서 확인하세요.`,
      source: `${SOURCE}\n${schedule.title}\n${schedule.steps.map((item) => `${item.label}: ${range(item)}`).join("\n")}`,
      isSample: false,
      reminders: [],
      idempotencyKey: `${schedule.id}-${step.id}`,
    };
  }

  return (
    <>
      <div className="view-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="시험 검색"
            placeholder="기사 · 기능사 · 회차 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="시행년도"
          value={year}
          onChange={(event) => setYear(event.target.value)}
        >
          {[thisYear, thisYear + 1].map((value) => (
            <option key={value} value={value}>
              {value}년
            </option>
          ))}
        </select>
        <select
          aria-label="자격 구분"
          value={qualification}
          onChange={(event) =>
            setQualification(event.target.value as QualificationType)
          }
        >
          {(Object.entries(QUALIFICATION_TYPES) as [QualificationType, string][]).map(
            ([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ),
          )}
        </select>
        <label className="check-inline">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(event) => setShowPast(event.target.checked)}
          />
          지난 회차
        </label>
      </div>
      <div className="catalog-caption">
        <span>시험 회차 {schedules.length}개</span>
        <span className="public-tag">공공데이터포털</span>
        {data && <span>{format(new Date(data.fetchedAt), "HH:mm")} 기준</span>}
        <button
          type="button"
          className="text-button caption-refresh"
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={13} />
          {loading ? "불러오는 중" : "새로고침"}
        </button>
      </div>
      {error && <Message text={error} error />}
      {loading && !data ? (
        <div className="empty-state">
          <Busy label="시험일정을 불러오는 중" />
        </div>
      ) : schedules.length === 0 ? (
        !error && (
          <div className="empty-state">
            <Search size={27} />
            <h3>표시할 시험 회차가 없어요</h3>
            <p>시행년도나 자격 구분을 바꾸거나 지난 회차를 표시해 보세요.</p>
          </div>
        )
      ) : (
        <div className="exam-list">
          {schedules.map((schedule) => (
            <section className="exam-card" key={schedule.id}>
              <div className="exam-card-heading">
                <h3>{schedule.title}</h3>
                <span className="plain-tag">{schedule.qualification}</span>
              </div>
              <ul className="exam-steps">
                {schedule.steps.map((step) => {
                  const past = stepDate(step) < today;
                  // 다가오는 첫 단계만 진하게 — 무엇부터 챙길지 한눈에
                  const next =
                    !past &&
                    schedule.steps.find((item) => stepDate(item) >= today)?.id === step.id;
                  return (
                    <li key={step.id} className={past ? "past" : next ? "next" : ""}>
                      <span className="exam-step-label">{step.label}</span>
                      <span className="exam-step-date">{range(step)}</span>
                      <button
                        type="button"
                        className="text-button"
                        disabled={past}
                        aria-label={`${schedule.title} ${step.label} 일정 등록`}
                        onClick={() => onAdd(draft(schedule, step))}
                      >
                        {past ? (
                          "지남"
                        ) : (
                          <>
                            <CalendarPlus size={14} />
                            등록
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
