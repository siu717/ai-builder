"use client";

import { useState } from "react";
import {
  Sparkles,
  CalendarPlus,
  FileText,
  ArrowRight,
  MessageSquareText,
  ListChecks,
  CircleHelp,
  CheckCircle2,
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
import { Modal, Busy, Message, request, seoulDate } from "./ui";

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
  const [classTime, setClassTime] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function analyze(sample: boolean) {
    const nextText = sample ? TASK_SAMPLE : text;
    const nextDate = sample ? seoulDate() : referenceDate;
    const nextTime = sample ? "09:00" : classTime;
    if (!nextText.trim()) {
      setError("공지 또는 공고 원문을 입력해 주세요.");
      return;
    }
    if (sample) {
      setText(nextText);
      setReferenceDate(nextDate);
      setClassTime(nextTime);
      setKind("assignment");
    }
    setError("");
    setBusy(true);
    setResult(null);
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
            <label className="field">
              공지 작성일 <span className="optional">선택</span>
              <input
                type="date"
                value={referenceDate}
                onChange={(event) => {
                  setReferenceDate(event.target.value);
                  setResult(null);
                }}
              />
            </label>
            <label className="field">
              수업 시작 시각 <span className="optional">선택</span>
              <input
                type="time"
                value={classTime}
                onChange={(event) => {
                  setClassTime(event.target.value);
                  setResult(null);
                }}
              />
            </label>
          </div>
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
                  <dd>{result.date || "확인 필요"}</dd>
                </div>
                <div>
                  <dt>마감 시각</dt>
                  <dd>{result.time || "확인 필요"}</dd>
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
                      <CircleHelp
                        size={16}
                        className={`status-${item.status}`}
                      />
                      <div>
                        <strong>{item.label}</strong>
                        <p>{item.reason}</p>
                        <span className={`status-text status-${item.status}`}>
                          {item.status === "met"
                            ? "충족"
                            : item.status === "unmet"
                              ? "불충족"
                              : "확인 필요"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="button primary"
                onClick={() => {
                  onAdd({
                    title: result.title,
                    kind: result.kind,
                    date: result.date || "",
                    time: result.time,
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
            <h3 className="detail-section-title">
              <FileText size={17} />
              서류 피드백
            </h3>
            {result.feedback.map((item, index) => (
              <article className="feedback-item" key={index}>
                <blockquote>{item.quote}</blockquote>
                <h4>{item.suggestion}</h4>
                <p>{item.reason}</p>
              </article>
            ))}
            <h3 className="detail-section-title">
              <MessageSquareText size={17} />
              예상 면접 질문
            </h3>
            <ol className="question-list">
              {result.questions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
            <h3 className="detail-section-title">
              <ListChecks size={17} />
              준비할 일
            </h3>
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
                    notes: result.tasks
                      .map((task) => `${task.title}: ${task.notes}`)
                      .join("\n"),
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
            <div className="coaching-tasks">
              {result.tasks.map((task, index) => (
                <div className="coaching-task" key={index}>
                  <div>
                    <strong>{task.title}</strong>
                    <p>{task.notes}</p>
                  </div>
                  <button
                    className="icon-button"
                    title="준비 일정 등록"
                    aria-label={`${task.title} 일정 등록`}
                    onClick={() =>
                      onAdd({
                        title: task.title,
                        kind: "career",
                        date: seoulDate(),
                        time: null,
                        notes: task.notes,
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
