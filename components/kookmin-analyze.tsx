"use client";

import { useState } from "react";
import { Sparkles, CalendarPlus, FileText, CircleHelp } from "lucide-react";
import type { AnalysisResult, KookminNoticeDetail } from "@/lib/contracts";
import { KOOKMIN_BOARD_LABELS } from "@/lib/contracts";
import { checklistFromDocuments } from "@/lib/checklist";
import type { EventDraft } from "./event-editor";
import { Modal, Busy, Message, request } from "./ui";

type AnalyzeKind = "assignment" | "scholarship" | "job";
const KIND_OPTIONS: { value: AnalyzeKind; label: string }[] = [
  { value: "assignment", label: "과제 공지" },
  { value: "scholarship", label: "장학금" },
  { value: "job", label: "채용 공고" },
];
/** EventInput.source is limited to 2000 characters on the server. */
const SOURCE_LIMIT = 2000;

export default function KookminAnalyze({
  notice,
  onClose,
  onAdd,
}: {
  notice: KookminNoticeDetail;
  onClose: () => void;
  onAdd: (draft: EventDraft) => void;
}) {
  const [kind, setKind] = useState<AnalyzeKind>(
    notice.board === "scholarship" ? "scholarship" : "assignment",
  );
  const [text, setText] = useState(notice.text);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyMissing = error.includes("ANTHROPIC_API_KEY");
  const source = `${notice.url}\n\n${text}`.slice(0, SOURCE_LIMIT);

  async function analyze() {
    if (busy) return;
    if (!text.trim()) {
      setError("공지 원문을 입력해 주세요.");
      return;
    }
    setError("");
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await request<AnalysisResult>("/api/analyze", "POST", {
          text,
          kind,
          referenceDate: notice.date || null,
          classTime: null,
          sample: false,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function addWithoutAnalysis() {
    onAdd({
      kind: notice.board === "scholarship" ? "scholarship" : "academic",
      title: notice.title,
      date: "",
      time: null,
      notes: text.slice(0, 2000),
      source: notice.url,
      isSample: false,
      reminders: [],
    });
    onClose();
  }

  return (
    <Modal title="국민대 공지 AI 분석" onClose={onClose} wide>
      <div className="modal-body analyze-layout">
        <section>
          <div className="section-heading">
            <h3>원문</h3>
            <span className="plain-tag">
              {KOOKMIN_BOARD_LABELS[notice.board]}
            </span>
          </div>
          <p className="kmu-analyze-title">
            <a href={notice.url} target="_blank" rel="noreferrer">
              {notice.title}
            </a>
          </p>
          <div
            className="segmented analysis-kinds"
            role="group"
            aria-label="공지 종류"
          >
            {KIND_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={kind === option.value ? "active" : ""}
                aria-pressed={kind === option.value}
                disabled={busy}
                onClick={() => {
                  setKind(option.value);
                  setResult(null);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="field">
            공지 내용
            <textarea
              rows={11}
              value={text}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
                setResult(null);
              }}
              placeholder="마감이 포함된 원문을 붙여넣어 주세요."
            />
          </label>
          <p className="field-note">
            작성일 {notice.date || "확인 필요"} · “다음 주 금요일” 같은 상대
            날짜는 작성일 기준으로 계산합니다.
          </p>
          <div className="inline-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy || !text.trim()}
              onClick={analyze}
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
            {keyMissing && (
              <button
                type="button"
                className="button secondary"
                onClick={addWithoutAnalysis}
              >
                <CalendarPlus size={16} />
                분석 없이 일정 등록
              </button>
            )}
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
                type="button"
                className="button primary kmu-confirm"
                onClick={() => {
                  onAdd({
                    title: result.title,
                    kind: result.kind,
                    date: result.date || "",
                    time: result.time,
                    notes: [result.subject, result.submission, result.summary]
                      .filter(Boolean)
                      .join("\n"),
                    source,
                    checklist: checklistFromDocuments(result.documents),
                    isSample: false,
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
