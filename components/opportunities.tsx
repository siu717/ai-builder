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
  RefreshCw,
  Sparkles,
  CircleAlert,
} from "lucide-react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import {
  LIVE_KEY_MISSING,
  type LiveOpportunity,
  type LiveOpportunityResponse,
  type Opportunity,
} from "@/lib/contracts";
import type { EventDraft } from "./event-editor";
import { Busy, seoulDate } from "./ui";
import { checklistFromDocuments } from "@/lib/checklist";

const conditionLabels = { met: "충족", unmet: "불충족", unknown: "확인 필요" };
// "내게 맞는 공고 먼저": 조건 충족 → 확인 필요 → 불충족 순서입니다.
const FIT_RANK = { met: 0, unknown: 1, unmet: 2 } as const;
// 프로필은 props로 받지 않으므로, 조건 판정 사유에 남은 "입력해 주세요" 안내로 빈 항목을 알아냅니다.
const PROFILE_GAPS = [
  { label: "학년", phrase: "학년을 입력" },
  { label: "전공", phrase: "전공을 입력" },
  { label: "학점", phrase: "학점과 만점 기준을 함께 입력" },
];

export interface LiveStatus {
  loading: boolean;
  error: string;
  sources: LiveOpportunityResponse["sources"];
}
// 본문을 서버에서 다시 읽어 AI 분석에 넘길 수 있는 출처(국민대 공지)입니다.
const ANALYZABLE_SOURCES = ["kmu-scholarship", "kmu-job"];

export default function Opportunities({
  kind,
  opportunities,
  live,
  liveStatus,
  onReloadLive,
  onAnalyzeLive,
  onAdd,
  onAnalyze,
  onCoach,
}: {
  kind: "scholarship" | "job";
  opportunities: Opportunity[];
  live?: LiveOpportunity[];
  liveStatus?: LiveStatus;
  onReloadLive?: () => void;
  onAnalyzeLive?: (item: LiveOpportunity) => void | Promise<void>;
  onAdd: (draft: EventDraft) => void;
  onAnalyze: () => void;
  onCoach: (text: string) => void;
}) {
  // 자동화 브라우저(E2E)에서는 외부 사이트 응답에 따라 화면이 달라지지 않도록 샘플 공고부터 보여 줍니다.
  const [mode, setMode] = useState<"live" | "sample">(() =>
    live === undefined ||
    (typeof navigator !== "undefined" && navigator.webdriver)
      ? "sample"
      : "live",
  );
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitFirst, setFitFirst] = useState(true);
  const filtered = opportunities.filter(
    (item) =>
      item.kind === kind &&
      `${item.title} ${item.organization} ${item.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (condition === "all" || overall(item) === condition),
  );
  // Array.prototype.sort는 안정 정렬이므로 같은 상태 안에서는 기존(마감) 순서가 유지됩니다.
  const results = fitFirst
    ? [...filtered].sort(
        (a, b) => FIT_RANK[overall(a)] - FIT_RANK[overall(b)],
      )
    : filtered;
  const selected = results.find((item) => item.id === selectedId) || results[0];
  const profileGaps = PROFILE_GAPS.filter(({ phrase }) =>
    opportunities.some((item) =>
      item.conditions.some(
        (entry) => entry.status === "unknown" && entry.reason.includes(phrase),
      ),
    ),
  ).map(({ label }) => label);
  function overall(item: Opportunity) {
    return item.conditions.some((entry) => entry.status === "unmet")
      ? "unmet"
      : item.conditions.every((entry) => entry.status === "met")
        ? "met"
        : "unknown";
  }
  return (
    <>
      {live !== undefined && (
        <div className="live-switch" role="group" aria-label="공고 종류">
          <button
            type="button"
            className={mode === "live" ? "active" : ""}
            aria-pressed={mode === "live"}
            onClick={() => setMode("live")}
          >
            실시간 공고
            {!liveStatus?.loading && <b>{live.length}</b>}
          </button>
          <button
            type="button"
            className={mode === "sample" ? "active" : ""}
            aria-pressed={mode === "sample"}
            onClick={() => setMode("sample")}
          >
            샘플 공고
            <b>{opportunities.filter((item) => item.kind === kind).length}</b>
          </button>
        </div>
      )}
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
          hidden={mode === "live"}
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
      {mode === "live" ? (
        <LivePanel
          kind={kind}
          items={live ?? []}
          status={liveStatus}
          query={query}
          onReload={onReloadLive}
          onAnalyze={onAnalyzeLive}
          onAdd={onAdd}
          onCoach={onCoach}
        />
      ) : (
      <>
      <div className="catalog-caption tt-caption">
        <span>
          {kind === "scholarship" ? "장학금" : "채용 공고"} {results.length}개
        </span>
        <span className="sample-tag">샘플 공고</span>
        <label className="tt-sort-toggle">
          <input
            type="checkbox"
            checked={fitFirst}
            onChange={(event) => setFitFirst(event.target.checked)}
          />
          <span>내게 맞는 공고 먼저</span>
        </label>
      </div>
      {profileGaps.length > 0 && (
        <p className="tt-nudge">
          {profileGaps.join("·")} 미입력 · 설정의 학생 프로필을 채우면 지원
          조건을 더 정확히 비교합니다. 비어 있는 조건은 확인 필요로
          표시됩니다.
        </p>
      )}
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
              <span className="sample-tag">샘플</span>
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
            <ul className="documents">
              {selected.documents.map((document) => (
                <li key={document}>
                  <FileText size={15} />
                  {document}
                </li>
              ))}
            </ul>
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
                    notes: `준비 서류: ${selected.documents.join(", ")}`,
                    source: selected.originalText,
                    checklist: checklistFromDocuments(selected.documents),
                    isSample: true,
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
      )}
    </>
  );
}

function deadlineLabel(item: LiveOpportunity): string {
  if (!item.date) return "마감 확인 필요";
  const left = differenceInCalendarDays(
    parseISO(item.date),
    parseISO(seoulDate()),
  );
  return left < 0 ? "마감 지남" : left === 0 ? "D-DAY" : `D-${left}`;
}

function LivePanel({
  kind,
  items,
  status,
  query,
  onReload,
  onAnalyze,
  onAdd,
  onCoach,
}: {
  kind: "scholarship" | "job";
  items: LiveOpportunity[];
  status?: LiveStatus;
  query: string;
  onReload?: () => void;
  onAnalyze?: (item: LiveOpportunity) => void | Promise<void>;
  onAdd: (draft: EventDraft) => void;
  onCoach: (text: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = items.filter((item) => {
    const haystack =
      `${item.title} ${item.organization} ${item.tags.join(" ")} ${item.sourceName}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const selected = results.find((item) => item.id === selectedId) || results[0];
  const loading = status?.loading ?? false;
  const sources = status?.sources ?? [];
  return (
    <>
      <div className="catalog-caption tt-caption live-caption">
        <span>
          {kind === "scholarship" ? "장학금" : "채용 공고"} {results.length}개
        </span>
        <span className="live-tag">실시간</span>
        {sources.map((source) => {
          const needsKey = source.error === LIVE_KEY_MISSING;
          return (
            <span
              key={source.id}
              className={`live-chip ${source.ok ? "ok" : needsKey ? "key" : "fail"}`}
              title={source.error || `${source.count}개`}
            >
              {source.name}{" "}
              {source.ok ? source.count : needsKey ? "키 필요" : "실패"}
            </span>
          );
        })}
        {onReload && (
          <button
            type="button"
            className="text-button live-reload"
            onClick={onReload}
            disabled={loading}
          >
            <RefreshCw size={13} />
            새로고침
          </button>
        )}
      </div>
      <p className="tt-nudge live-note">
        각 사이트에 공개된 공고를 그대로 가져옵니다. 마감일은 원문에 적힌
        경우에만 표시하며, 지원 전 반드시 원문을 확인해 주세요.
      </p>
      {loading && items.length === 0 ? (
        <Busy label="실시간 공고를 불러오는 중" />
      ) : results.length === 0 ? (
        <div className="empty-state">
          {status?.error ? <CircleAlert size={27} /> : <Search size={27} />}
          <h3>
            {status?.error
              ? "실시간 공고를 불러오지 못했어요"
              : items.length === 0
                ? "가져온 공고가 없어요"
                : "검색 결과가 없어요"}
          </h3>
          <p>
            {status?.error ||
              (items.length === 0
                ? "잠시 후 다시 시도하거나 샘플 공고를 확인해 보세요."
                : "검색어를 바꿔 보세요.")}
          </p>
          {onReload && items.length === 0 && (
            <button
              type="button"
              className="button secondary"
              onClick={onReload}
            >
              <RefreshCw size={16} />
              다시 시도
            </button>
          )}
        </div>
      ) : (
        <div className="opportunity-layout">
          <div className="opportunity-list">
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
                {item.matchReason && (
                  <p className="live-reason">{item.matchReason}</p>
                )}
                <div className="tag-row">
                  <span className="plain-tag live-source">
                    {item.sourceName}
                  </span>
                  {item.tags.slice(0, 3).map((tag) => (
                    <span className="plain-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="opportunity-card-bottom">
                  <span>
                    {item.postedAt
                      ? `${format(parseISO(item.postedAt), "M.d")} 등록`
                      : ""}
                  </span>
                  <span>
                    {item.date && `${format(parseISO(item.date), "M.d")} 마감 `}
                    <strong>{deadlineLabel(item)}</strong>
                  </span>
                </div>
              </button>
            ))}
          </div>
          {selected && (
            <section className="opportunity-detail">
              <div className="detail-eyebrow">
                <span>{selected.organization}</span>
                <span className="live-tag">{selected.sourceName}</span>
              </div>
              <h2>{selected.title}</h2>
              <div className="detail-facts">
                <div>
                  <span>신청 마감</span>
                  <strong>
                    {selected.date
                      ? `${format(parseISO(selected.date), "yyyy.MM.dd")} ${selected.time || "시각 확인 필요"}`
                      : "원문에서 확인 필요"}
                  </strong>
                </div>
                <div>
                  <span>등록일</span>
                  <strong>
                    {selected.postedAt
                      ? format(parseISO(selected.postedAt), "yyyy.MM.dd")
                      : "표시 없음"}
                  </strong>
                </div>
              </div>
              {selected.matchReason && (
                <div className="recommendation">
                  <span
                    className={
                      kind === "scholarship" ? "violet-text" : "cyan-text"
                    }
                  >
                    {kind === "scholarship" ? (
                      <GraduationCap size={18} />
                    ) : (
                      <BriefcaseBusiness size={18} />
                    )}
                  </span>
                  <p>
                    {selected.matchReason} · 프로필과 공고 문구를 비교한 참고
                    정보이며 지원 자격 판정이 아닙니다.
                  </p>
                </div>
              )}
              {selected.description && (
                <p className="live-description">{selected.description}</p>
              )}
              {selected.tags.length > 0 && (
                <div className="tag-row">
                  {selected.tags.map((tag) => (
                    <span className="plain-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <a
                className="text-button live-origin"
                href={selected.url}
                target="_blank"
                rel="noreferrer"
              >
                원문 보기 <ArrowUpRight size={15} />
              </a>
              <div className="detail-actions">
                <button
                  className="button primary"
                  onClick={() =>
                    onAdd({
                      title: selected.title,
                      kind: selected.kind,
                      date: selected.date ?? "",
                      time: selected.time,
                      notes: `출처: ${selected.sourceName}\n${selected.url}`,
                      source: selected.url,
                      isSample: false,
                      reminders: [],
                      idempotencyKey: selected.id,
                    })
                  }
                >
                  <CalendarPlus size={16} />
                  신청 일정 등록
                </button>
                {onAnalyze &&
                  ANALYZABLE_SOURCES.includes(selected.sourceId) && (
                    <button
                      className="button secondary"
                      disabled={analyzing}
                      onClick={async () => {
                        setAnalyzing(true);
                        try {
                          await onAnalyze(selected);
                        } finally {
                          setAnalyzing(false);
                        }
                      }}
                    >
                      <Sparkles size={15} />
                      {analyzing ? "본문 불러오는 중" : "AI로 조건 분석"}
                    </button>
                  )}
                {kind === "job" && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      onCoach(
                        `${selected.title}\n${selected.organization}\n${selected.description}\n${selected.url}`,
                      )
                    }
                  >
                    취업 컨설팅 <ChevronRight size={15} />
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
