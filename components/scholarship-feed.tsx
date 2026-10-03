"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronRight, RefreshCw, Search } from "lucide-react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import type { AppState } from "@/lib/contracts";
import type { ScholarshipFeed as Feed, ScholarshipPreferences } from "@/lib/scholarships";
import type { EventDraft } from "./event-editor";
import { checklistFromDocuments } from "@/lib/checklist";
import { Busy, Message, request, seoulDate } from "./ui";

function dueText(deadline: string | null) {
  if (!deadline) return null;
  const days = differenceInCalendarDays(parseISO(deadline), parseISO(seoulDate()));
  return days < 0 ? "마감 지남" : `D-${days}`;
}

function dueTier(deadline: string) {
  const days = differenceInCalendarDays(parseISO(deadline), parseISO(seoulDate()));
  return days < 0 ? "overdue" : days === 0 ? "today" : days <= 2 ? "near" : days <= 7 ? "week" : "later";
}

export default function ScholarshipFeed({
  onAdd,
  onSave,
}: {
  onAdd: (draft: EventDraft) => void;
  onSave: (state: AppState) => void;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [preferences, setPreferences] = useState<ScholarshipPreferences>({ enabled: false, keywords: "" });
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const next = await request<Feed>("/api/scholarships");
      setFeed(next);
      setPreferences(next.preferences);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공지를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await request<{ state: AppState; sync: { created: number; updated: number }; preferences: ScholarshipPreferences }>(
        "/api/scholarships/preferences",
        "PUT",
        preferences,
      );
      onSave(next.state);
      setPreferences(next.preferences);
      setMessage(
        next.preferences.enabled
          ? `자동 등록을 켰습니다. 새 일정 ${next.sync.created}개, 갱신 ${next.sync.updated}개`
          : "자동 등록을 껐습니다. 이미 등록한 일정은 그대로 둡니다.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "설정을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const today = seoulDate();
  const notices = (feed?.notices || []).filter(
    (notice) =>
      `${notice.title} ${notice.body}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!openOnly || !notice.deadline || notice.deadline >= today),
  );
  const selected = notices.find((notice) => notice.id === selectedId) || notices[0];
  const status = feed?.status;

  return (
    <section aria-label="국민대 장학공지">
      <form className="automation-settings" onSubmit={save} aria-label="장학금 마감 자동 등록">
        <div className="automation-copy">
          <span className="opp-eyebrow">자동 등록</span>
          <h2>장학금 마감 자동 등록</h2>
          <p>키워드가 맞고 신청 마감이 본문에 명확한 국민대 공지를 내 캘린더에 등록합니다. 원문 마감이 바뀌면 일정도 따라 바뀌고, 직접 고치거나 지운 일정은 다시 건드리지 않습니다.</p>
        </div>
        <div className="automation-fields">
          <label className="check-inline">
            <input
              type="checkbox"
              disabled={busy || !feed}
              checked={preferences.enabled}
              onChange={(event) => setPreferences({ ...preferences, enabled: event.target.checked })}
            />
            자동 등록 켜기
          </label>
          <label className="field">
            등록 키워드
            <input
              disabled={busy || !feed}
              value={preferences.keywords}
              maxLength={200}
              placeholder="예: 소프트웨어, 생활비 · 비우면 모든 공지"
              onChange={(event) => setPreferences({ ...preferences, keywords: event.target.value })}
            />
          </label>
          <button className="button primary" disabled={busy || !feed}>
            자동 등록 설정 저장
          </button>
        </div>
      </form>
      {error && <Message text={error} error />}
      {message && <Message text={message} />}

      <div className="view-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="국민대 장학공지 검색"
            placeholder="장학금 · 키워드 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="check-inline">
          <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
          마감 지난 공지 숨기기
        </label>
      </div>
      <div className="catalog-caption">
        <span>국민대 공식 장학공지 {notices.length}개</span>
        <span className="public-tag">30분마다 수집</span>
        <span>
          {status?.lastSuccess
            ? `최근 수집 ${format(new Date(status.lastSuccess), "M.d HH:mm")}`
            : "첫 수집을 기다리고 있습니다"}
        </span>
        <button type="button" className="text-button caption-refresh" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} />
          {busy ? "불러오는 중" : "새로고침"}
        </button>
      </div>
      {status?.error && <Message text={status.error} error />}
      {busy && !feed ? (
        <div className="empty-state">
          <Busy label="공지를 불러오는 중" />
        </div>
      ) : (
        <div className="opportunity-layout opp-kind-scholarship">
          <div className="opportunity-list">
            {feed && notices.length === 0 && (
              <div className="empty-state">
                <Search size={27} />
                <h3>{query ? "검색 결과가 없어요" : "표시할 공지가 아직 없어요"}</h3>
                <p>{query ? "다른 검색어를 입력해 주세요." : "수집이 끝나면 새로고침으로 확인할 수 있습니다."}</p>
              </div>
            )}
            {notices.map((notice) => {
              const isSelected = selected?.id === notice.id;
              return (
                <button
                  className={`opportunity-card ${isSelected ? "selected" : ""}`}
                  key={notice.id}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(notice.id)}
                >
                  <div className="opportunity-card-top">
                    <span className="opp-kind-dot" aria-hidden="true" />
                    <span className="opportunity-org">
                      국민대학교 · {notice.publishedAt ? format(parseISO(notice.publishedAt), "yyyy.M.d") : "게시일 확인 필요"}
                    </span>
                    <ChevronRight size={16} className="opp-row-chevron" />
                  </div>
                  <h3>{notice.title}</h3>
                  <div className="opportunity-card-bottom">
                    {notice.deadline ? (
                      <span className="opp-due">
                        <strong className={`opp-dday opp-due-${dueTier(notice.deadline)}`}>{dueText(notice.deadline)}</strong>
                        <span className="opp-due-date">{format(parseISO(notice.deadline), "M.d")} 마감</span>
                      </span>
                    ) : (
                      <span className="opp-status status-unknown">
                        <span className="opp-status-word">마감 확인 필요</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {selected && (
            <article className="opportunity-detail">
              <div className="opp-detail-head">
                <div className="opp-detail-heading">
                  <div className="detail-eyebrow">
                    <span className="opp-crumb">국민대 장학공지</span>
                    <span className="opp-crumb-sep" aria-hidden="true">/</span>
                    <span>{selected.publishedAt ? `${selected.publishedAt} 게시` : "게시일 확인 필요"}</span>
                    <span className="public-tag">공식 공지</span>
                  </div>
                  <h2>{selected.title}</h2>
                </div>
                {selected.deadline && (
                  <div className="opp-detail-due">
                    <span className={`opp-dday opp-dday-lg opp-due-${dueTier(selected.deadline)}`}>{dueText(selected.deadline)}</span>
                  </div>
                )}
              </div>
              <div className="detail-facts">
                <div>
                  <span>신청 마감</span>
                  <strong>
                    {selected.deadline ? (
                      <>
                        {format(parseISO(selected.deadline), "yyyy.MM.dd")}{" "}
                        {selected.time || <span className="opp-needs-check">시각 확인 필요</span>}
                      </>
                    ) : (
                      <span className="opp-needs-check">원문 확인 필요</span>
                    )}
                  </strong>
                </div>
                <div>
                  <span>첨부파일</span>
                  <strong>{selected.attachments.length ? `${selected.attachments.length}개` : "없음"}</strong>
                </div>
              </div>
              <div className="recommendation">
                <span className="opp-eyebrow">마감 근거</span>
                <p>
                  {selected.evidence
                    ? selected.evidence
                    : "본문에서 신청 마감을 확정하지 못했습니다. 이미지·첨부파일을 확인한 뒤 날짜를 입력해 주세요."}
                </p>
              </div>
              {selected.documents.length > 0 && (
                <>
                  <h3 className="detail-section-title">제출 서류 언급</h3>
                  <ul className="documents">
                    {selected.documents.map((document) => (
                      <li key={document}>{document}</li>
                    ))}
                  </ul>
                </>
              )}
              {selected.attachments.length > 0 && (
                <>
                  <h3 className="detail-section-title">첨부파일</h3>
                  <ul className="documents attachment-list">
                    {selected.attachments.map((attachment) => (
                      <li key={attachment.url}>
                        <a href={attachment.url} target="_blank" rel="noreferrer">
                          {attachment.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <details className="original-source">
                <summary>수집한 공지 내용</summary>
                <pre>{selected.body}</pre>
                <a className="text-button" href={selected.url} target="_blank" rel="noreferrer">
                  국민대 원문 보기 <ArrowUpRight size={15} />
                </a>
              </details>
              <div className="detail-actions">
                <button
                  className="button primary"
                  onClick={() =>
                    onAdd({
                      title: selected.title,
                      kind: "scholarship",
                      date: selected.deadline || "",
                      time: selected.time,
                      notes: "지원 자격과 제출 서류를 원문에서 확인해 주세요.",
                      source: selected.url,
                      isSample: false,
                      checklist: checklistFromDocuments(selected.documents),
                      reminders: [],
                      idempotencyKey: selected.id,
                    })
                  }
                >
                  {selected.deadline ? "신청 일정 등록" : "날짜 확인 후 등록"}
                  <ArrowRight size={17} />
                </button>
                <a className="button secondary" href={selected.url} target="_blank" rel="noreferrer">
                  국민대 원문 <ArrowUpRight size={15} />
                </a>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
