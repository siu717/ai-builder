"use client";

import { useState } from "react";
import {
  Search,
  ArrowUpRight,
  ArrowRight,
  Check,
  X,
  FileText,
  ChevronRight,
  Database,
  RefreshCw,
} from "lucide-react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import type {
  AppState,
  EligibilityCondition,
  Opportunity,
  PublicDataResult,
} from "@/lib/contracts";
import type { EventDraft } from "./event-editor";
import ExamSchedules from "./exam-schedules";
import ScholarshipFeed from "./scholarship-feed";
import { Busy, Message, request, seoulDate } from "./ui";
import { checklistFromDocuments } from "@/lib/checklist";

type Source = "kookmin" | "sample" | "public" | "exams";
const SOURCE_LABELS = {
  scholarship: { kookmin: "국민대 장학공지", public: "한국장학재단", sample: "샘플" },
  job: { sample: "샘플", public: "공공 채용", exams: "자격증 시험" },
} as const;
const MAX_VISIBLE = 120;

const conditionLabels = { met: "충족", unmet: "불충족", unknown: "확인 필요" };
type ConditionStatus = EligibilityCondition["status"];
type DueTier = "overdue" | "today" | "near" | "week" | "later";

function daysLeft(date: string) {
  return differenceInCalendarDays(parseISO(date), parseISO(seoulDate()));
}
function dueLabel(days: number) {
  return days < 0 ? "마감 지남" : `D-${days}`;
}
// KMU80 D-day 단계: 지남 · 오늘 · D-1~2 · D-3~7 · 그 이후
function dueTier(days: number): DueTier {
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 2) return "near";
  if (days <= 7) return "week";
  return "later";
}

function StatusMark({ status }: { status: ConditionStatus }) {
  return (
    <span className={`opp-status status-text status-${status}`}>
      {status === "met" ? (
        <Check size={16} strokeWidth={2.4} />
      ) : status === "unmet" ? (
        <X size={16} strokeWidth={2.4} />
      ) : null}
      <span className="opp-status-word">{conditionLabels[status]}</span>
    </span>
  );
}

export default function Opportunities({
  kind,
  opportunities,
  onAdd,
  onAnalyze,
  onCoach,
  dataKeyReady,
  onSettings,
  onState,
}: {
  kind: "scholarship" | "job";
  opportunities: Opportunity[];
  onAdd: (draft: EventDraft) => void;
  onAnalyze: () => void;
  onCoach: (text: string) => void;
  dataKeyReady: boolean;
  onSettings: () => void;
  onState: (state: AppState) => void;
}) {
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<Source>(kind === "scholarship" ? "kookmin" : "sample");
  const [live, setLive] = useState<PublicDataResult<Opportunity> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  async function loadPublic(refresh = false) {
    setLoading(true);
    setLoadError("");
    try {
      setLive(
        await request<PublicDataResult<Opportunity>>(
          `/api/public-data?source=${kind === "job" ? "jobs" : "scholarships"}${refresh ? "&refresh=1" : ""}`,
        ),
      );
      setSelectedId(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "공공데이터를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }
  function choose(next: Source) {
    setSource(next);
    setSelectedId(null);
    if (next === "public" && dataKeyReady && !live && !loading) void loadPublic();
  }
  const pool = source === "public" ? live?.items || [] : opportunities;
  const matches = pool.filter(
    (item) =>
      item.kind === kind &&
      `${item.title} ${item.organization} ${item.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (condition === "all" || overall(item) === condition),
  );
  const results = matches.slice(0, MAX_VISIBLE);
  const selected = results.find((item) => item.id === selectedId) || results[0];
  function overall(item: Opportunity) {
    return item.conditions.some((entry) => entry.status === "unmet")
      ? "unmet"
      : item.conditions.every((entry) => entry.status === "met")
        ? "met"
        : "unknown";
  }
  const kindLabel = kind === "scholarship" ? "장학금" : "채용 공고";
  const selectedDays = selected ? daysLeft(selected.date) : 0;
  const counts = {
    met: selected?.conditions.filter((entry) => entry.status === "met").length ?? 0,
    unmet:
      selected?.conditions.filter((entry) => entry.status === "unmet").length ?? 0,
    unknown:
      selected?.conditions.filter((entry) => entry.status === "unknown").length ?? 0,
  };
  const switcher = (
    <div className="segmented source-switch" role="group" aria-label="공고 출처">
      {(Object.entries(SOURCE_LABELS[kind]) as [Source, string][]).map(
        ([id, label]) => (
          <button
            type="button"
            key={id}
            className={source === id ? "active" : ""}
            aria-pressed={source === id}
            onClick={() => choose(id)}
          >
            {id === "public" || id === "exams" ? <Database size={14} /> : null}
            {label}
          </button>
        ),
      )}
    </div>
  );
  if (source === "kookmin") {
    return (
      <>
        {switcher}
        <ScholarshipFeed onAdd={onAdd} onSave={onState} />
      </>
    );
  }
  if (source === "exams") {
    return (
      <>
        {switcher}
        <ExamSchedules
          dataKeyReady={dataKeyReady}
          onSettings={onSettings}
          onAdd={onAdd}
        />
      </>
    );
  }
  if (source === "public" && (!dataKeyReady || (!live && (loading || loadError)))) {
    return (
      <>
        {switcher}
        <div className="empty-state public-data-state">
          <Database size={27} />
          {!dataKeyReady ? (
            <>
              <h3>공공데이터포털 인증키가 필요해요</h3>
              <p>
                설정 → 외부 데이터 API에 인증키를 입력하면{" "}
                {kind === "scholarship" ? "한국장학재단 장학금" : "공공기관·공무원 채용 공고"}을
                불러옵니다.
              </p>
              <button type="button" className="button primary" onClick={onSettings}>
                설정에서 키 입력
              </button>
            </>
          ) : loading ? (
            <Busy label="공공데이터를 불러오는 중" />
          ) : (
            <>
              <Message text={loadError} error />
              <button
                type="button"
                className="button secondary"
                onClick={() => void loadPublic()}
              >
                <RefreshCw size={15} />
                다시 시도
              </button>
            </>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      {switcher}
      <div className="view-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="공고 검색"
            placeholder={
              kind === "scholarship" ? "장학금 · 기관 검색" : "회사 · 직무 검색"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="지원 조건 필터"
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
        >
          <option value="all">모든 지원 조건</option>
          <option value="met">조건 충족</option>
          <option value="unknown">확인 필요</option>
          <option value="unmet">조건 불충족</option>
        </select>
        <button className="button secondary" onClick={onAnalyze}>
          <FileText size={16} />
          공고 입력
        </button>
      </div>
      <div className="catalog-caption">
        <span>
          {kindLabel} {matches.length}개
          {matches.length > results.length && ` 중 ${results.length}개 표시`}
        </span>
        {source === "sample" ? (
          <span className="sample-tag">샘플 공고</span>
        ) : (
          <>
            <span className="public-tag">공공데이터포털</span>
            {live && (
              <span>
                {format(new Date(live.fetchedAt), "HH:mm")} 기준 · 모집 중인 공고만
              </span>
            )}
            <button
              type="button"
              className="text-button caption-refresh"
              disabled={loading}
              onClick={() => void loadPublic(true)}
            >
              <RefreshCw size={14} />
              {loading ? "불러오는 중" : "새로고침"}
            </button>
          </>
        )}
      </div>
      {loadError && <Message text={loadError} error />}
      {source === "public" &&
        live?.notices?.map((notice) => <Message key={notice} text={notice} error />)}
      <div className={`opportunity-layout opp-kind-${kind}`}>
        <div className="opportunity-list">
          {results.length === 0 && (
            <div className="empty-state">
              <Search size={27} />
              <h3>검색 결과가 없어요</h3>
              <p>검색어나 지원 조건을 바꿔 보세요.</p>
            </div>
          )}
          {results.map((item) => {
            const days = daysLeft(item.date);
            const isSelected = selected?.id === item.id;
            return (
              <button
                className={`opportunity-card ${isSelected ? "selected" : ""}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                aria-pressed={isSelected}
              >
                <div className="opportunity-card-top">
                  <span className="opp-kind-dot" aria-hidden="true" />
                  <span className="opportunity-org">{item.organization}</span>
                  <ChevronRight size={16} className="opp-row-chevron" />
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                {item.tags.length > 0 && (
                  <div className="tag-row">
                    {item.tags.map((tag) => (
                      <span className="plain-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="opportunity-card-bottom">
                  <span className="opp-due">
                    <strong className={`opp-dday opp-due-${dueTier(days)}`}>
                      {dueLabel(days)}
                    </strong>
                    <span className="opp-due-date">
                      {format(parseISO(item.date), "M.d")} 마감
                    </span>
                  </span>
                  <span className="condition-summary">
                    <StatusMark status={overall(item)} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        {selected && (
          <section className="opportunity-detail">
            <div className="opp-detail-head">
              <div className="opp-detail-heading">
                <div className="detail-eyebrow">
                  <span className="opp-crumb">{kindLabel}</span>
                  <span className="opp-crumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span>{selected.organization}</span>
                  {selected.isSample ? (
                    <span className="sample-tag">샘플</span>
                  ) : (
                    <span className="public-tag">공공데이터</span>
                  )}
                </div>
                <h2>{selected.title}</h2>
              </div>
              <div className="opp-detail-due">
                <span
                  className={`opp-dday opp-dday-lg opp-due-${dueTier(selectedDays)}`}
                >
                  {dueLabel(selectedDays)}
                </span>
                {selected.conditions.length > 0 && (
                  <div className="opp-condition-meter">
                    <span className="opp-meter-caption">
                      지원 조건 {selected.conditions.length}개 중
                    </span>
                    <div
                      className="opp-meter-bar"
                      role="img"
                      aria-label={`충족 ${counts.met}, 불충족 ${counts.unmet}, 확인 필요 ${counts.unknown}`}
                    >
                      {selected.conditions.map((entry, index) => (
                        <span
                          key={index}
                          className={`opp-meter-seg opp-meter-${entry.status}`}
                        />
                      ))}
                    </div>
                    <span className="opp-meter-legend">
                      충족 {counts.met} · 불충족 {counts.unmet} · 확인 필요{" "}
                      {counts.unknown}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="detail-facts">
              <div>
                <span>신청 마감</span>
                <strong>
                  {format(parseISO(selected.date), "yyyy.MM.dd")}{" "}
                  {selected.time || (
                    <span className="opp-needs-check">시각 확인 필요</span>
                  )}
                </strong>
              </div>
              <div>
                <span>
                  {kind === "scholarship" ? "지원 규모" : "채용 구분"}
                </span>
                <strong>{selected.amount}</strong>
              </div>
            </div>
            <div className="recommendation">
              <span className="opp-eyebrow">추천 이유</span>
              <p>{selected.recommendation}</p>
            </div>
            <h3 className="detail-section-title">지원 조건</h3>
            <div className="conditions">
              {selected.conditions.map((entry, index) => (
                <div className="condition" key={index}>
                  <span className="opp-condition-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="opp-condition-body">
                    <strong>{entry.label}</strong>
                    <p>{entry.reason}</p>
                  </div>
                  <StatusMark status={entry.status} />
                </div>
              ))}
            </div>
            <h3 className="detail-section-title">준비할 서류</h3>
            {selected.documents.length ? (
              <ul className="documents">
                {selected.documents.map((document) => (
                  <li key={document}>{document}</li>
                ))}
              </ul>
            ) : (
              <p className="documents-missing">
                데이터에 제출 서류가 없습니다. 공고 원문에서 확인해 주세요.
              </p>
            )}
            <details className="original-source">
              <summary>공고 원문</summary>
              <pre>{selected.originalText}</pre>
              {/^https?:\/\//.test(selected.source) && (
                <a
                  className="text-button"
                  href={selected.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  출처 <ArrowUpRight size={15} />
                </a>
              )}
            </details>
            <div className="detail-actions">
              <button
                className="button primary"
                onClick={() =>
                  onAdd({
                    title: selected.title,
                    kind: selected.kind,
                    date: selected.date,
                    time: selected.time,
                    notes: selected.documents.length
                      ? `준비 서류: ${selected.documents.join(", ")}`
                      : "제출 서류는 공고 원문에서 확인하세요.",
                    source: selected.originalText.slice(0, 2000),
                    checklist: checklistFromDocuments(selected.documents),
                    isSample: selected.isSample,
                    reminders: [],
                    idempotencyKey: selected.id,
                  })
                }
              >
                신청 일정 등록
                <ArrowRight size={17} />
              </button>
              {kind === "job" && (
                <button
                  className="button secondary"
                  onClick={() => onCoach(selected.originalText)}
                >
                  취업 컨설팅 <ChevronRight size={15} />
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
