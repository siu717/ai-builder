"use client";

import { useEffect, useId, useState } from "react";
import {
  Sparkles,
  CalendarPlus,
  FileText,
  MessageSquareText,
  CircleHelp,
  Check,
  X,
  Clock3,
  Plus,
  Trash2,
} from "lucide-react";
import {
  TASK_SAMPLE,
  COACH_JOB_SAMPLE,
  COACH_RESUME_SAMPLE,
  type AnalysisResult,
  type CoachingResult,
} from "@/lib/contracts";
import type { EventDraft } from "./event-editor";
import { checklistFromDocuments } from "@/lib/checklist";
import {
  CLASS_TIME_MISSING_HINT,
  MAX_COURSE_LENGTH,
  MAX_TIMETABLE_SLOTS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  loadTimetable,
  mentionsBeforeClass,
  newSlotId,
  saveTimetable,
  slotForWeekday,
  slotHint,
  weekdayFromText,
  type TimetableSlot,
} from "@/lib/timetable";
import { Modal, Busy, Message, request, seoulDate } from "./ui";

const AI_SUGGESTION_NOTE = "AI 제안 · 날짜는 직접 확정하세요";

function matchingSlot(timetable: TimetableSlot[], text: string) {
  const weekday = weekdayFromText(text);
  return weekday === null ? null : slotForWeekday(timetable, weekday, text);
}

export function AnalyzeModal({
  kind: initialKind,
  configured,
  onClose,
  onAdd,
}: {
  kind: "assignment" | "scholarship" | "job";
  configured: boolean;
  onClose: () => void;
  onAdd: (draft: EventDraft) => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [text, setText] = useState("");
  const [referenceDate, setReferenceDate] = useState("");
  // null = 시간표에서 찾은 수업 시작 시각을 따릅니다. 문자열 = 사용자가 직접 입력한 값입니다.
  const [classTimeOverride, setClassTimeOverride] = useState<string | null>(
    null,
  );
  const [timetable, setTimetable] = useState<TimetableSlot[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const referenceDateId = useId();

  useEffect(() => {
    setTimetable(loadTimetable());
  }, []);

  const matchedSlot = matchingSlot(timetable, text);
  const classTime = classTimeOverride ?? matchedSlot?.time ?? "";
  const usingTimetable = matchedSlot !== null && classTime === matchedSlot.time;
  const needsClassTime =
    matchedSlot === null && !classTime && mentionsBeforeClass(text);

  function updateTimetable(next: TimetableSlot[]) {
    setTimetable(next);
    saveTimetable(next);
    setResult(null);
  }
  function updateSlot(id: string, patch: Partial<TimetableSlot>) {
    updateTimetable(
      timetable.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    );
  }

  async function analyze(sample: boolean) {
    const sampleSlot = matchingSlot(timetable, TASK_SAMPLE);
    const nextText = sample ? TASK_SAMPLE : text;
    const nextDate = sample ? seoulDate() : referenceDate;
    const nextTime = sample ? (sampleSlot?.time ?? "09:00") : classTime;
    if (!nextText.trim()) {
      setError("공지 또는 공고 원문을 입력해 주세요.");
      return;
    }
    if (sample) {
      setText(nextText);
      setReferenceDate(nextDate);
      setClassTimeOverride(sampleSlot ? null : nextTime);
      setKind("assignment");
    }
    setError("");
    setBusy(true);
    setResult(null);
    setManualDate("");
    setManualTime("");
    try {
      setResult(
        await request<AnalysisResult>("/api/analyze", "POST", {
          text: nextText,
          kind: sample ? "assignment" : kind,
          referenceDate: nextDate || null,
          classTime: nextTime || null,
          sample,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const draftDate = result ? (result.date ?? manualDate) : "";
  const draftTime = result ? (result.time ?? (manualTime || null)) : null;

  return (
    <Modal title="공지에서 일정 추가" onClose={onClose} wide>
      <div className="modal-body analyze-layout">
        <section>
          <div className="section-heading">
            <h3>원문</h3>
            <span
              className={`connection-label ${configured ? "connected" : ""}`}
            >
              <span />
              {configured ? "AI 키 설정됨" : "AI 키 미설정"}
            </span>
          </div>
          <div className="segmented analysis-kinds">
            {(["assignment", "scholarship", "job"] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={kind === value ? "active" : ""}
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setResult(null);
                }}
              >
                {value === "assignment"
                  ? "과제 공지"
                  : value === "scholarship"
                    ? "장학금"
                    : "채용 공고"}
              </button>
            ))}
          </div>
          <label className="field">
            공지 · 공고 내용
            <textarea
              className="analysis-source"
              rows={9}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult(null);
              }}
              placeholder="마감이 포함된 원문을 붙여넣어 주세요."
            />
          </label>
          <div className="form-grid">
            <div className="field">
              <span className="tt-label-row">
                <label htmlFor={referenceDateId}>
                  공지 작성일 <span className="optional">선택</span>
                </label>
                <button
                  type="button"
                  className="text-button tt-inline-button"
                  onClick={() => {
                    setReferenceDate(seoulDate());
                    setResult(null);
                  }}
                >
                  작성일 = 오늘로 설정
                </button>
              </span>
              <input
                id={referenceDateId}
                type="date"
                value={referenceDate}
                onChange={(event) => {
                  setReferenceDate(event.target.value);
                  setResult(null);
                }}
              />
            </div>
            <label className="field">
              수업 시작 시각 <span className="optional">선택</span>
              <input
                type="time"
                value={classTime}
                onChange={(event) => {
                  setClassTimeOverride(event.target.value);
                  setResult(null);
                }}
              />
            </label>
          </div>
          <div className="tt-hints" aria-live="polite">
            {usingTimetable && matchedSlot && (
              <p className="tt-hint tt-hint-ok">
                <Clock3 size={14} />
                {slotHint(matchedSlot)}
              </p>
            )}
            {matchedSlot && !usingTimetable && (
              <p className="tt-hint">
                <Clock3 size={14} />
                {classTime
                  ? "직접 입력한 수업 시작 시각을 사용합니다."
                  : "수업 시작 시각을 비워 두었습니다."}
                <button
                  type="button"
                  className="text-button tt-inline-button"
                  onClick={() => {
                    setClassTimeOverride(null);
                    setResult(null);
                  }}
                >
                  시간표 시각({matchedSlot.time})으로 되돌리기
                </button>
              </p>
            )}
            {needsClassTime && (
              <p className="tt-hint tt-hint-warn">
                <CircleHelp size={14} />
                {CLASS_TIME_MISSING_HINT}
              </p>
            )}
          </div>
          <details className="tt-editor">
            <summary>
              내 수업 시간표
              <span className="tt-count">{timetable.length}개</span>
            </summary>
            <p className="tt-note">
              공지에 요일이 있으면 해당 요일의 수업 시작 시각을 마감 후보로
              제안합니다. 이 브라우저에만 저장됩니다.
            </p>
            {timetable.length === 0 && (
              <p className="tt-note">등록한 수업이 없습니다.</p>
            )}
            {timetable.map((slot, index) => (
              <div className="tt-row" key={slot.id}>
                <select
                  aria-label={`수업 ${index + 1} 요일`}
                  value={slot.weekday}
                  onChange={(event) =>
                    updateSlot(slot.id, { weekday: Number(event.target.value) })
                  }
                >
                  {WEEKDAY_ORDER.map((day) => (
                    <option key={day} value={day}>
                      {WEEKDAY_LABELS[day]}요일
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  aria-label={`수업 ${index + 1} 시작 시각`}
                  value={slot.time}
                  onChange={(event) =>
                    updateSlot(slot.id, { time: event.target.value })
                  }
                />
                <input
                  aria-label={`수업 ${index + 1} 과목명`}
                  placeholder="과목명 (선택)"
                  maxLength={MAX_COURSE_LENGTH}
                  value={slot.course}
                  onChange={(event) =>
                    updateSlot(slot.id, { course: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="icon-button danger-text"
                  title="수업 삭제"
                  aria-label={`수업 ${index + 1} 삭제`}
                  onClick={() =>
                    updateTimetable(
                      timetable.filter((item) => item.id !== slot.id),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={timetable.length >= MAX_TIMETABLE_SLOTS}
              onClick={() =>
                updateTimetable([
                  ...timetable,
                  {
                    id: newSlotId(),
                    weekday: weekdayFromText(text) ?? 1,
                    time: "",
                    course: "",
                  },
                ])
              }
            >
              <Plus size={14} />
              수업 추가
            </button>
          </details>
          <div className="inline-actions">
            <button
              className="button primary"
              disabled={busy || !text.trim()}
              onClick={() => analyze(false)}
            >
              {busy ? (
                <Busy label="분석 중" />
              ) : (
                <>
                  <Sparkles size={16} />
                  분석
                </>
              )}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => analyze(true)}
            >
              샘플 분석
            </button>
          </div>
          {error && <Message text={error} error />}
        </section>
        <section className="analysis-result">
          <div className="section-heading">
            <h3>분석 결과</h3>
            {result && (
              <span
                className={result.mode === "sample" ? "sample-tag" : "ai-tag"}
              >
                {result.mode === "sample" ? "샘플" : "AI 분석"}
              </span>
            )}
          </div>
          {!result ? (
            <div className="empty-state">
              <FileText size={28} strokeWidth={1.5} />
              <h3>
                {busy ? "원문을 확인하고 있어요" : "분석 결과를 확인해 주세요"}
              </h3>
              {busy && <Busy label="분석 중" />}
            </div>
          ) : (
            <>
              <h2 className="analysis-title">{result.title}</h2>
              <dl className="result-fields">
                <div>
                  <dt>마감 날짜</dt>
                  <dd>
                    {result.date ? (
                      <span className="result-num">{result.date}</span>
                    ) : manualDate ? (
                      <>
                        <span className="result-num">{manualDate}</span>{" "}
                        <span className="optional">직접 입력</span>
                      </>
                    ) : (
                      <span className="result-check">확인 필요</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>마감 시각</dt>
                  <dd>
                    {result.time ? (
                      <span className="result-num">{result.time}</span>
                    ) : manualTime ? (
                      <>
                        <span className="result-num">{manualTime}</span>{" "}
                        <span className="optional">직접 입력</span>
                      </>
                    ) : (
                      <span className="result-check">마감 시간 확인 필요</span>
                    )}
                  </dd>
                </div>
                {result.subject && (
                  <div>
                    <dt>과목 · 분야</dt>
                    <dd>{result.subject}</dd>
                  </div>
                )}
                {result.submission && (
                  <div>
                    <dt>제출 방법</dt>
                    <dd>{result.submission}</dd>
                  </div>
                )}
              </dl>
              <p className="analysis-summary">{result.summary}</p>
              {(result.date === null || result.time === null) && (
                <div
                  className="tt-confirm"
                  role="group"
                  aria-label="마감 직접 확인"
                >
                  <h4>
                    <CircleHelp size={16} />
                    {result.date === null
                      ? "마감 날짜를 직접 확정해 주세요"
                      : "마감 시간 확인 필요"}
                  </h4>
                  <p>
                    {result.date === null
                      ? "원문만으로는 마감 날짜를 확정할 수 없습니다. 공지 작성일을 입력해 다시 분석하거나, 확인한 날짜를 직접 선택해 주세요. 날짜를 확정하기 전에는 일정으로 등록하지 않습니다."
                      : "날짜만 확인된 일정입니다. 시각을 모르면 비워 둔 채 날짜 단위로 등록할 수 있고, 임의의 시각은 채우지 않습니다."}
                  </p>
                  <div className="form-grid">
                    {result.date === null && (
                      <label className="field">
                        마감 날짜 직접 입력
                        <input
                          type="date"
                          value={manualDate}
                          onChange={(event) =>
                            setManualDate(event.target.value)
                          }
                        />
                      </label>
                    )}
                    {result.time === null && (
                      <label className="field">
                        마감 시각 직접 입력{" "}
                        <span className="optional">선택</span>
                        <input
                          type="time"
                          value={manualTime}
                          onChange={(event) =>
                            setManualTime(event.target.value)
                          }
                        />
                      </label>
                    )}
                  </div>
                  {result.time === null &&
                    classTime &&
                    manualTime !== classTime &&
                    mentionsBeforeClass(text) && (
                      <button
                        type="button"
                        className="text-button tt-inline-button"
                        onClick={() => setManualTime(classTime)}
                      >
                        <Clock3 size={14} />
                        수업 시작 시각 {classTime}을 마감 시각으로 사용
                      </button>
                    )}
                </div>
              )}
              {result.missing.length > 0 && (
                <div className="missing-fields">
                  <h4>
                    <CircleHelp size={16} />
                    확인할 정보
                  </h4>
                  <ul>
                    {result.missing.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.documents.length > 0 && (
                <>
                  <h4 className="detail-section-title">준비 서류</h4>
                  <ul className="documents">
                    {result.documents.map((item) => (
                      <li key={item}>
                        <FileText size={15} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {result.conditions.length > 0 && (
                <div className="conditions">
                  {result.conditions.map((item, index) => (
                    <div className="condition" key={index}>
                      <span className="condition-index" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{item.reason}</p>
                      </div>
                      <span className={`status-text status-${item.status}`}>
                        {item.status === "met" ? (
                          <Check size={16} aria-hidden="true" />
                        ) : item.status === "unmet" ? (
                          <X size={16} aria-hidden="true" />
                        ) : (
                          <CircleHelp size={16} aria-hidden="true" />
                        )}
                        {item.status === "met"
                          ? "충족"
                          : item.status === "unmet"
                            ? "불충족"
                            : "확인 필요"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="button primary analysis-register"
                disabled={!draftDate}
                onClick={() => {
                  if (!draftDate) return;
                  onAdd({
                    title: result.title,
                    kind: result.kind,
                    date: draftDate,
                    time: draftTime,
                    notes: [result.subject, result.submission, result.summary]
                      .filter(Boolean)
                      .join("\n"),
                    source: text,
                    checklist: checklistFromDocuments(result.documents),
                    isSample: result.mode === "sample",
                    reminders: [],
                  });
                  onClose();
                }}
              >
                <CalendarPlus size={16} />
                확인 · 일정 등록
              </button>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

export function Coaching({
  configured,
  initialJob,
  onAdd,
}: {
  configured: boolean;
  initialJob: string;
  onAdd: (draft: EventDraft) => void;
}) {
  const [jobText, setJobText] = useState(initialJob);
  const [resumeText, setResumeText] = useState("");
  const [result, setResult] = useState<CoachingResult | null>(null);
  // 준비할 일별로 사용자가 직접 고른 날짜입니다. 고르지 않으면 날짜 없이 등록 화면을 엽니다.
  const [taskDates, setTaskDates] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function coach(sample: boolean) {
    const nextJob = sample ? COACH_JOB_SAMPLE : jobText;
    const nextResume = sample ? COACH_RESUME_SAMPLE : resumeText;
    if (!nextJob.trim() || !nextResume.trim()) {
      setError("목표 공고와 이력서 또는 자기소개서를 모두 입력해 주세요.");
      return;
    }
    if (sample) {
      setJobText(nextJob);
      setResumeText(nextResume);
    }
    setBusy(true);
    setError("");
    setResult(null);
    setTaskDates({});
    try {
      setResult(
        await request<CoachingResult>("/api/coach", "POST", {
          jobText: nextJob,
          resumeText: nextResume,
          sample,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "컨설팅에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="coaching-layout">
      <section className="coaching-input">
        <div className="section-heading">
          <h2>지원 준비</h2>
          <span className={`connection-label ${configured ? "connected" : ""}`}>
            <span />
            {configured ? "AI 키 설정됨" : "AI 키 미설정"}
          </span>
        </div>
        <label className="field">
          목표 채용 공고
          <textarea
            className="coaching-source"
            rows={6}
            value={jobText}
            onChange={(event) => {
              setJobText(event.target.value);
              setResult(null);
            }}
            placeholder="지원하려는 공고의 직무와 요구 조건"
          />
        </label>
        <label className="field">
          이력서 · 자기소개서
          <textarea
            className="coaching-source"
            rows={10}
            value={resumeText}
            onChange={(event) => {
              setResumeText(event.target.value);
              setResult(null);
            }}
            placeholder="피드백을 받을 서류 원문"
          />
        </label>
        <div className="inline-actions">
          <button
            className="button primary"
            disabled={busy || !jobText.trim() || !resumeText.trim()}
            onClick={() => coach(false)}
          >
            {busy ? (
              <Busy label="컨설팅 중" />
            ) : (
              <>
                <Sparkles size={16} />
                컨설팅 받기
              </>
            )}
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => coach(true)}
          >
            샘플 컨설팅
          </button>
        </div>
        {error && <Message text={error} error />}
      </section>
      <section className="coaching-output">
        <div className="section-heading">
          <h2>컨설팅 결과</h2>
          {result && (
            <span
              className={result.mode === "sample" ? "sample-tag" : "ai-tag"}
            >
              {result.mode === "sample" ? "샘플" : "AI 분석"}
            </span>
          )}
        </div>
        {!result ? (
          <div className="empty-state">
            <MessageSquareText size={29} strokeWidth={1.5} />
            <h3>
              {busy ? "서류를 살펴보고 있어요" : "준비할 일을 확인해 보세요"}
            </h3>
            {busy && <Busy label="컨설팅 중" />}
          </div>
        ) : (
          <>
            <p className="coaching-summary">{result.summary}</p>
            <h3 className="coaching-eyebrow">서류 피드백</h3>
            {result.feedback.map((item, index) => (
              <article className="feedback-item" key={index}>
                <blockquote>{item.quote}</blockquote>
                <h4>{item.suggestion}</h4>
                <p>{item.reason}</p>
              </article>
            ))}
            <h3 className="coaching-eyebrow">예상 면접 질문</h3>
            <ol className="question-list">
              {result.questions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            <div className="coaching-eyebrow-row">
              <h3 className="coaching-eyebrow">준비할 일</h3>
              {result.tasks.length > 0 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    onAdd({
                      title: "취업 준비 계획",
                      kind: "career",
                      date: "",
                      time: null,
                      notes: `${AI_SUGGESTION_NOTE}\n${result.tasks
                        .map((task) => `${task.title}: ${task.notes}`)
                        .join("\n")}`,
                      checklist: checklistFromDocuments(
                        result.tasks.map((task) => task.title),
                      ),
                      source: "취업 컨설팅 준비 계획",
                      isSample: result.mode === "sample",
                      reminders: [],
                    })
                  }
                >
                  <CalendarPlus size={16} />
                  준비 계획 한 번에 등록
                </button>
              )}
            </div>
            <div className="coaching-tasks">
              {result.tasks.map((task, index) => (
                <div className="coaching-task tt-task" key={index}>
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.notes}</p>
                  </div>
                  <input
                    type="date"
                    className="tt-task-date"
                    aria-label={`${task.title} 날짜 (선택)`}
                    title="날짜 (선택)"
                    value={taskDates[index] ?? ""}
                    onChange={(event) =>
                      setTaskDates({
                        ...taskDates,
                        [index]: event.target.value,
                      })
                    }
                  />
                  <button
                    className="icon-button coaching-task-add"
                    title="준비 일정 등록"
                    aria-label={`${task.title} 일정 등록`}
                    onClick={() =>
                      onAdd({
                        title: task.title,
                        kind: "career",
                        date: taskDates[index] ?? "",
                        time: null,
                        notes: `${AI_SUGGESTION_NOTE}\n${task.notes}`,
                        source: "취업 컨설팅 준비 계획",
                        isSample: result.mode === "sample",
                        reminders: [],
                      })
                    }
                  >
                    <CalendarPlus size={19} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
