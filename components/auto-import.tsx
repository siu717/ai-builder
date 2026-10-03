"use client";

import { useCallback, useEffect, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarPlus,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  importEventKey,
  type AppState,
  type ImportCandidate,
  type ImportKind,
  type ImportSource,
  type ImportState,
} from "@/lib/contracts";
import { checklistFromDocuments } from "@/lib/checklist";
import { KindBadge } from "./calendar";
import type { EventDraft } from "./event-editor";
import { Busy, Message, request, seoulDate } from "./ui";
import styles from "./auto-import.module.css";

const KIND_OPTIONS: { value: ImportKind; label: string }[] = [
  { value: "scholarship", label: "장학금" },
  { value: "job", label: "채용" },
  { value: "career", label: "취업 준비" },
];

function relative(value: string | null) {
  if (!value) return "곧 가져옵니다";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "방금 가져옴";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}시간 전`;
  return format(new Date(value), "M월 d일 HH:mm");
}

function dday(date: string, today: string) {
  const days = differenceInCalendarDays(parseISO(date), parseISO(today));
  return days === 0 ? "D-day" : `D-${days}`;
}

export function draftFromCandidate(item: ImportCandidate): EventDraft {
  return {
    title: item.title,
    kind: item.kind,
    date: item.date ?? undefined,
    time: item.time,
    notes: [item.organization, item.summary, item.dateNote].filter(Boolean).join("\n\n").slice(0, 10000),
    source: [`자동 수집 · ${item.sourceName}`, item.url].filter(Boolean).join("\n"),
    checklist: checklistFromDocuments(item.documents.map((text) => text.slice(0, 200))).slice(0, 50),
    isSample: false,
    reminders: [],
    idempotencyKey: importEventKey(item.id),
  };
}

type SyncResult = { name: string; found: number; added: number; error: string | null };
type Mutation = { imports: ImportState; app?: AppState };

export default function AutoImport({
  app,
  onState,
  onEdit,
  onToast,
  onSettings,
}: {
  app: AppState;
  onState: (state: AppState) => void;
  onEdit: (draft: EventDraft) => void;
  onToast: (text: string) => void;
  onSettings: () => void;
}) {
  const [data, setData] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [kindFilter, setKindFilter] = useState<ImportKind | "all">("all");
  const [matchedOnly, setMatchedOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const today = seoulDate();

  const load = useCallback(async () => {
    try {
      setData(await request<ImportState>("/api/imports"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "수집 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    // 서버 워커가 백그라운드로 가져온 결과를 반영한다.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const added = new Set(app.events.map((event) => event.idempotencyKey).filter(Boolean));

  async function run<T extends Mutation>(key: string, action: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    setBusy(key);
    setError("");
    try {
      const result = await action();
      setData(result.imports);
      if (result.app) onState(result.app);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청을 처리하지 못했습니다.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function report(results: SyncResult[]) {
    const failed = results.filter((entry) => entry.error);
    if (failed.length) setError(failed.map((entry) => `${entry.name}: ${entry.error}`).join("\n"));
    const found = results.reduce((sum, entry) => sum + entry.found, 0);
    const addedCount = results.reduce((sum, entry) => sum + entry.added, 0);
    if (results.length) onToast(`일정 후보 ${found}건을 확인했습니다.${addedCount ? ` ${addedCount}건을 캘린더에 자동 등록했습니다.` : ""}`);
  }

  async function sync(sourceId?: string) {
    const result = await run(sourceId || "sync-all", () => request<Mutation & { results: SyncResult[] }>("/api/imports/sync", "POST", sourceId ? { sourceId } : {}));
    if (result) report(result.results);
  }

  if (!data) {
    return error ? <Message text={error} error /> : <Busy label="수집 목록을 불러오는 중" />;
  }

  const personalized = data.profileTerms.length > 0;
  const builtin = data.sources.filter((source) => source.builtin);
  const boards = data.sources.filter((source) => !source.builtin);
  const waiting = data.providers.filter((provider) => !provider.configured);
  const visible = data.items.filter((item) =>
    (showHidden || !item.dismissed)
    && (kindFilter === "all" || item.kind === kindFilter)
    && (!matchedOnly || !personalized || item.matched.length > 0 || !data.sources.find((source) => source.id === item.sourceId)?.builtin)
    && `${item.title} ${item.organization} ${item.sourceName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pending = data.items.filter((item) => !item.dismissed && !added.has(importEventKey(item.id))).length;

  return (
    <div className={styles.layout}>
      <section className={styles.sources}>
        <div className={styles.profileCard}>
          <div className={styles.profileHeading}>
            <Sparkles size={16} />
            <strong>맞춤 기준</strong>
            <button type="button" className="text-button" onClick={onSettings}>
              <UserRound size={13} />
              프로필 수정
            </button>
          </div>
          {personalized ? (
            <>
              <div className={styles.terms}>
                {data.profileTerms.map((term) => <span key={term}>{term}</span>)}
              </div>
              <p>이 단어가 들어간 공고는 마감이 가까운 순으로 캘린더에 자동 등록되고, 하루 전 오전 9시에 알려 드려요.</p>
            </>
          ) : (
            <p>프로필에 <b>전공</b>과 <b>관심 직무</b>를 입력하면 맞는 장학금 · 채용 공고를 골라 캘린더에 자동으로 넣어 드려요.</p>
          )}
        </div>

        <div className="section-heading">
          <h2>
            <Rss size={18} />
            수집원
          </h2>
          <button type="button" className="button secondary" disabled={busy !== null || !data.sources.some((source) => source.enabled)} onClick={() => sync()}>
            {busy === "sync-all" ? <Busy label="가져오는 중" /> : <><RefreshCw size={15} />지금 가져오기</>}
          </button>
        </div>
        <p className={styles.lead}>서버가 6시간마다 자동으로 확인합니다. 따로 등록할 필요가 없어요.</p>
        <ul className={styles.sourceList}>
          {builtin.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              busy={busy}
              onSync={() => sync(source.id)}
              onPatch={(patch) => run(`patch-${source.id}`, () => request<Mutation>(`/api/imports/sources/${source.id}`, "PATCH", patch))}
            />
          ))}
        </ul>
        {waiting.length > 0 && (
          <details className={styles.waiting} open={builtin.length === 0}>
            <summary>
              <KeyRound size={13} />
              서버 키를 기다리는 수집원 {waiting.length}개
            </summary>
            <p>운영자가 서버의 <code>.env.local</code>에 키를 한 번 넣으면 모든 사용자에게 자동으로 켜집니다.</p>
            <ul>
              {waiting.map((provider) => (
                <li key={provider.type}>
                  <span>{provider.label}</span>
                  <a href={provider.signup} target="_blank" rel="noreferrer">
                    <code>{provider.env}</code>
                    <ArrowUpRight size={12} />
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className={styles.boardHeading}>
          <h3>학교 · 학과 공지 게시판 <span className="optional">선택</span></h3>
        </div>
        <ul className={styles.sourceList}>
          {boards.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              busy={busy}
              onSync={() => sync(source.id)}
              onPatch={(patch) => run(`patch-${source.id}`, () => request<Mutation>(`/api/imports/sources/${source.id}`, "PATCH", patch))}
              onDelete={() => run(`delete-${source.id}`, () => request<Mutation>(`/api/imports/sources/${source.id}`, "DELETE"))}
            />
          ))}
        </ul>
        {adding ? (
          <BoardForm
            busy={busy === "create"}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              const result = await run("create", () => request<Mutation & { result: SyncResult }>("/api/imports", "POST", input));
              if (!result) return;
              setAdding(false);
              if (result.result.error) setError(`${result.result.name}: ${result.result.error}`);
              else report([result.result]);
            }}
          />
        ) : (
          <button type="button" className={`button secondary ${styles.addSource}`} onClick={() => setAdding(true)}>
            <Plus size={16} />
            게시판 주소 추가
          </button>
        )}
      </section>

      <section className={styles.inbox}>
        <div className="section-heading">
          <h2>
            <CalendarPlus size={18} />
            가져온 일정 후보
          </h2>
          <span className={styles.count}>확인 대기 {pending}건</span>
        </div>
        {error && <Message text={error} error />}
        <div className={styles.toolbar}>
          <div className="search-field">
            <Search size={16} />
            <input aria-label="후보 검색" placeholder="제목 · 기관 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className={styles.filters} role="group" aria-label="종류">
            {[{ value: "all" as const, label: "전체" }, ...KIND_OPTIONS].map((option) => (
              <button
                key={option.value}
                type="button"
                className={kindFilter === option.value ? styles.filterActive : ""}
                aria-pressed={kindFilter === option.value}
                onClick={() => setKindFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {personalized && (
            <label className={styles.hiddenToggle}>
              <input type="checkbox" checked={matchedOnly} onChange={(event) => setMatchedOnly(event.target.checked)} />
              맞춤만
            </label>
          )}
          <label className={styles.hiddenToggle}>
            <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
            숨긴 항목
          </label>
        </div>
        {visible.length === 0 ? (
          <div className="empty-state">
            <Rss size={26} />
            <h3>{data.sources.length ? "표시할 일정 후보가 없어요" : "서버 키를 설정하면 자동으로 모아요"}</h3>
            <p>
              {!data.sources.length
                ? "왼쪽의 수집원 중 하나라도 키가 설정되면 사용자가 할 일 없이 공고가 모입니다."
                : matchedOnly && personalized
                  ? "프로필과 맞는 공고가 아직 없어요. '맞춤만'을 끄면 전체 공고를 볼 수 있어요."
                  : "새 공고가 올라오면 이곳에 모입니다."}
            </p>
          </div>
        ) : (
          <ul className={styles.items}>
            {visible.map((item) => (
              <CandidateRow
                key={item.id}
                item={item}
                today={today}
                added={added.has(importEventKey(item.id))}
                busy={busy}
                onAdd={() => run(`add-${item.id}`, () => request<Mutation>(`/api/imports/items/${item.id}`, "POST", { action: "add" }))
                  .then((result) => result && onToast("캘린더에 등록했습니다."))}
                onEdit={() => onEdit(draftFromCandidate(item))}
                onToggleHidden={() => run(`hide-${item.id}`, () => request<Mutation>(`/api/imports/items/${item.id}`, "POST", { action: item.dismissed ? "restore" : "dismiss" }))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SourceCard({
  source,
  busy,
  onSync,
  onPatch,
  onDelete,
}: {
  source: ImportSource;
  busy: string | null;
  onSync: () => void;
  onPatch: (patch: Partial<Pick<ImportSource, "autoAdd" | "enabled">>) => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={`${styles.sourceCard} ${source.enabled ? "" : styles.disabled}`}>
      <div className={styles.sourceTop}>
        <div>
          <strong>{source.name}</strong>
          <span className={source.lastError ? styles.sourceError : styles.sourceStatus}>
            {!source.enabled
              ? "꺼짐"
              : source.lastError
                ? <><CircleAlert size={12} />{source.lastError}</>
                : `${relative(source.lastSyncedAt)}${source.lastSyncedAt ? ` · ${source.lastCount}건` : ""}`}
          </span>
        </div>
        <label className="switch" title={source.enabled ? "수집 끄기" : "수집 켜기"}>
          <input
            type="checkbox"
            aria-label={`${source.name} 수집`}
            checked={source.enabled}
            disabled={busy !== null}
            onChange={(event) => onPatch({ enabled: event.target.checked })}
          />
          <span />
        </label>
      </div>
      {!source.builtin && source.url && <span className={styles.url} title={source.url}>{source.url}</span>}
      {source.enabled && (
        <div className={styles.sourceControls}>
          <label>
            <input type="checkbox" checked={source.autoAdd} disabled={busy !== null} onChange={(event) => onPatch({ autoAdd: event.target.checked })} />
            {source.builtin ? "맞춤 공고 자동 등록" : "자동 등록"}
          </label>
          <button type="button" className="text-button" disabled={busy !== null} onClick={onSync} title="지금 가져오기">
            <RefreshCw size={13} className={busy === source.id ? "spin" : ""} />
          </button>
          {onDelete && (confirming ? (
            <span className={styles.confirm}>
              <button type="button" className="text-button" onClick={onDelete} disabled={busy !== null}>삭제</button>
              <button type="button" className="text-button" onClick={() => setConfirming(false)}>취소</button>
            </span>
          ) : (
            <button type="button" className="text-button" onClick={() => setConfirming(true)} title="게시판 삭제 (등록한 일정은 남습니다)">
              <Trash2 size={13} />
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function BoardForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { type: "rss"; name: string; url: string; kind: ImportKind; keywords: string; autoAdd: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<ImportKind>("scholarship");
  const [keywords, setKeywords] = useState("");
  const [autoAdd, setAutoAdd] = useState(false);
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ type: "rss", name: name.trim() || "학교 공지", url, kind, keywords, autoAdd });
      }}
    >
      <p className="field-note">장학 · 취업 공지 게시판의 목록 페이지 주소를 넣으면, 새 글 본문에서 신청 마감을 찾아 모아 드려요.</p>
      <label className="field">
        주소
        <input type="url" inputMode="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://학교/장학공지 목록" />
      </label>
      <div className="form-grid">
        <label className="field">
          이름
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="예: 학교 장학 공지" />
        </label>
        <label className="field">
          일정 종류
          <select value={kind} onChange={(event) => setKind(event.target.value as ImportKind)}>
            {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        제목 키워드 <span className="optional">선택 · 쉼표로 구분</span>
        <input value={keywords} maxLength={300} onChange={(event) => setKeywords(event.target.value)} placeholder="예: 장학, 모집" />
      </label>
      <label className={styles.checkboxField}>
        <input type="checkbox" checked={autoAdd} onChange={(event) => setAutoAdd(event.target.checked)} />
        마감을 찾은 공지는 캘린더에 자동 등록
      </label>
      <div className="inline-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? <Busy label="가져오는 중" /> : <><Plus size={16} />추가하고 가져오기</>}
        </button>
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>취소</button>
      </div>
    </form>
  );
}

function CandidateRow({
  item,
  today,
  added,
  busy,
  onAdd,
  onEdit,
  onToggleHidden,
}: {
  item: ImportCandidate;
  today: string;
  added: boolean;
  busy: string | null;
  onAdd: () => void;
  onEdit: () => void;
  onToggleHidden: () => void;
}) {
  const days = item.date ? differenceInCalendarDays(parseISO(item.date), parseISO(today)) : null;
  return (
    <li className={`${styles.item} ${item.dismissed ? styles.dismissed : ""}`}>
      <div className={styles.when}>
        {item.date ? (
          <>
            <strong className={days !== null && days <= 3 ? styles.urgent : ""}>{dday(item.date, today)}</strong>
            <span>{format(parseISO(item.date), "M.d")}{item.time ? ` ${item.time}` : ""}</span>
          </>
        ) : (
          <span className={styles.noDate}>날짜<br />확인</span>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.itemMeta}>
          <KindBadge kind={item.kind} />
          <span>{item.organization || item.sourceName}</span>
          {item.matched.map((term) => <span key={term} className={styles.match}>맞춤 · {term}</span>)}
        </div>
        <h3>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
              <ArrowUpRight size={13} />
            </a>
          ) : item.title}
        </h3>
        <p className={styles.note}>{item.sourceName}{item.dateNote && <span className={item.date ? "" : styles.warning}> · {item.dateNote}</span>}</p>
        {item.summary && (
          <details className={styles.summary}>
            <summary>내용 보기</summary>
            <p>{item.summary}</p>
            {item.documents.length > 0 && <p>제출 서류: {item.documents.join(", ")}</p>}
          </details>
        )}
      </div>
      <div className={styles.actions}>
        {added ? (
          <span className={styles.added}>
            <CalendarCheck2 size={15} />
            등록됨
          </span>
        ) : (
          <>
            {item.date && (
              <button type="button" className="button primary" disabled={busy !== null || item.dismissed} onClick={onAdd}>
                {busy === `add-${item.id}` ? <Busy label="등록 중" /> : <><CalendarPlus size={15} />캘린더에 추가</>}
              </button>
            )}
            <button type="button" className="button secondary" disabled={busy !== null || item.dismissed} onClick={onEdit}>
              <Pencil size={14} />
              {item.date ? "수정 후 추가" : "날짜 입력 후 추가"}
            </button>
            <button type="button" className="text-button" disabled={busy !== null} onClick={onToggleHidden}>
              {item.dismissed ? <><Eye size={13} />다시 보기</> : <><EyeOff size={13} />숨기기</>}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
