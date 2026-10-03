"use client";

import { useState } from "react";
import {
  Search,
  ArrowUpRight,
  CalendarPlus,
  CheckCircle2,
  XCircle,
  CircleHelp,
  FileText,
  Building2,
  GraduationCap,
  BriefcaseBusiness,
  ChevronRight,
  Database,
  RefreshCw,
} from "lucide-react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import type { Opportunity, PublicDataResult } from "@/lib/contracts";
import type { EventDraft } from "./event-editor";
import ExamSchedules from "./exam-schedules";
import { Busy, Message, request, seoulDate } from "./ui";
import { checklistFromDocuments } from "@/lib/checklist";

type Source = "sample" | "public" | "exams";
const SOURCE_LABELS = {
  scholarship: { sample: "샘플", public: "한국장학재단" },
  job: { sample: "샘플", public: "공공기관 채용", exams: "자격증 시험" },
} as const;
const MAX_VISIBLE = 120;

const conditionLabels = { met: "충족", unmet: "불충족", unknown: "확인 필요" };
export default function Opportunities({
  kind,
  opportunities,
  onAdd,
  onAnalyze,
  onCoach,
  dataKeyReady,
  onSettings,
}: {
  kind: "scholarship" | "job";
  opportunities: Opportunity[];
  onAdd: (draft: EventDraft) => void;
  onAnalyze: () => void;
  onCoach: (text: string) => void;
  dataKeyReady: boolean;
  onSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("sample");
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
            {id !== "sample" && <Database size={13} />}
            {label}
          </button>
        ),
      )}
    </div>
  );
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
        <div className="empty-state">
          <Database size={27} />
          {!dataKeyReady ? (
            <>
              <h3>공공데이터포털 인증키가 필요해요</h3>
              <p>
                설정 → 외부 데이터 API에 인증키를 입력하면{" "}
                {kind === "scholarship" ? "한국장학재단 장학금" : "공공기관 채용 공고"}을
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
          {kind === "scholarship" ? "장학금" : "채용 공고"} {matches.length}개
          {matches.length > results.length && ` 중 ${results.length}개 표시`}
        </span>
        {source === "sample" ? (
          <span className="sample-tag">샘플 공고</span>
        ) : (
          <>
            <span className="public-tag">공공데이터포털</span>
            {live && (
              <span>{format(new Date(live.fetchedAt), "HH:mm")} 기준 · 모집 중인 공고만</span>
            )}
            <button
              type="button"
              className="text-button caption-refresh"
              disabled={loading}
              onClick={() => void loadPublic(true)}
            >
              <RefreshCw size={13} />
              {loading ? "불러오는 중" : "새로고침"}
            </button>
          </>
        )}
      </div>
      {loadError && <Message text={loadError} error />}
      <div className="opportunity-layout">
        <div className="opportunity-list">
          {results.length === 0 && (
            <div className="empty-state">
              <Search size={27} />
              <h3>검색 결과가 없어요</h3>
              <p>검색어나 지원 조건을 바꿔 보세요.</p>
            </div>
          )}
          {results.map((item) => (
            <button
              className={`opportunity-card ${selected?.id === item.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="opportunity-card-top">
                <span
                  className={`organization-icon ${kind === "scholarship" ? "violet" : "cyan"}`}
                >
                  {kind === "scholarship" ? (
                    <GraduationCap size={23} />
                  ) : (
                    <Building2 size={22} />
                  )}
                </span>
                <span className="opportunity-org">{item.organization}</span>
                <ChevronRight size={16} className="muted" />
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="tag-row">
                {item.tags.map((tag) => (
                  <span className="plain-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="opportunity-card-bottom">
                <span className={`condition-summary status-${overall(item)}`}>
                  {conditionLabels[overall(item)]}
                </span>
                <span>
                  {format(parseISO(item.date), "M.d")} 마감{" "}
                  <strong>
                    {differenceInCalendarDays(
                      parseISO(item.date),
                      parseISO(seoulDate()),
                    ) < 0
                      ? "마감 지남"
                      : `D-${differenceInCalendarDays(parseISO(item.date), parseISO(seoulDate()))}`}
                  </strong>
                </span>
              </div>
            </button>
          ))}
        </div>
        {selected && (
          <section className="opportunity-detail">
            <div className="detail-eyebrow">
              <span>{selected.organization}</span>
              {selected.isSample ? (
                <span className="sample-tag">샘플</span>
              ) : (
                <span className="public-tag">공공데이터</span>
              )}
            </div>
            <h2>{selected.title}</h2>
            <div className="detail-facts">
              <div>
                <span>신청 마감</span>
                <strong>
                  {format(parseISO(selected.date), "yyyy.MM.dd")}{" "}
                  {selected.time || "시각 확인 필요"}
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
              <span
                className={kind === "scholarship" ? "violet-text" : "cyan-text"}
              >
                {kind === "scholarship" ? (
                  <GraduationCap size={18} />
                ) : (
                  <BriefcaseBusiness size={18} />
                )}
              </span>
              <p>{selected.recommendation}</p>
            </div>
            <h3 className="detail-section-title">지원 조건</h3>
            <div className="conditions">
              {selected.conditions.map((entry, index) => (
                <div className="condition" key={index}>
                  <span className={`condition-icon status-${entry.status}`}>
                    {entry.status === "met" ? (
                      <CheckCircle2 size={17} />
                    ) : entry.status === "unmet" ? (
                      <XCircle size={17} />
                    ) : (
                      <CircleHelp size={17} />
                    )}
                  </span>
                  <div>
                    <div className="condition-heading">
                      <strong>{entry.label}</strong>
                      <span className={`status-text status-${entry.status}`}>
                        {conditionLabels[entry.status]}
                      </span>
                    </div>
                    <p>{entry.reason}</p>
                  </div>
                </div>
              ))}
            </div>
            <h3 className="detail-section-title">준비할 서류</h3>
            {selected.documents.length ? (
              <ul className="documents">
                {selected.documents.map((document) => (
                  <li key={document}>
                    <FileText size={15} />
                    {document}
                  </li>
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
                <CalendarPlus size={16} />
                신청 일정 등록
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
