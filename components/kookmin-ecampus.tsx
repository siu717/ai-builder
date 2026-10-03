"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarPlus,
  Copy,
  ExternalLink,
  Eye,
  Bookmark,
  ShieldCheck,
} from "lucide-react";
import type {
  AppState,
  BookmarkletPayload,
  CalendarEvent,
  EcampusAssignment,
  KookminImportResult,
} from "@/lib/contracts";
import { Busy, Message, request } from "./ui";
import {
  assignmentToImport,
  ImportFailures,
  importMessage,
  isAssignmentImported,
  ReminderPresets,
  shortDate,
  type PresetKey,
} from "./kookmin-shared";

type Preview = { items: EcampusAssignment[]; calendarName: string | null };

function safeLink(url: string | null) {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export default function EcampusTab({
  events,
  onImported,
  onToast,
  initialPayload,
}: {
  events: CalendarEvent[];
  onImported: (state: AppState, summary: KookminImportResult) => void;
  onToast: (text: string) => void;
  initialPayload: BookmarkletPayload | null;
}) {
  const [url, setUrl] = useState("");
  const [ics, setIcs] = useState("");
  const [preview, setPreview] = useState<Preview | null>(
    initialPayload ? { items: initialPayload.items, calendarName: null } : null,
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialPayload?.items.map((item) => item.uid) ?? []),
  );
  const [fromBookmarklet, setFromBookmarklet] = useState(
    Boolean(initialPayload),
  );
  const [presets, setPresets] = useState<PresetKey[]>(["d1"]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [failed, setFailed] = useState<KookminImportResult["failed"]>([]);
  const [bookmarklet, setBookmarklet] = useState<{ href: string } | null>(
    null,
  );
  const [bookmarkletError, setBookmarkletError] = useState("");
  const [bookmarkletKey, setBookmarkletKey] = useState(0);
  const [copied, setCopied] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  const [previewShown, setPreviewShown] = useState(0);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const busy = previewBusy || importBusy;

  useEffect(() => {
    if (!initialPayload) return;
    setPreview({ items: initialPayload.items, calendarName: null });
    setSelected(new Set(initialPayload.items.map((item) => item.uid)));
    setFromBookmarklet(true);
    setFailed([]);
    setError("");
    setImportError("");
  }, [initialPayload]);

  useEffect(() => {
    let alive = true;
    setBookmarkletError("");
    request<{ href?: unknown }>("/api/kookmin/bookmarklet")
      .then((data) => {
        if (!alive) return;
        // The href is written to the DOM by hand below, so check its scheme.
        if (typeof data?.href !== "string" || !data.href.startsWith("javascript:"))
          throw new Error("북마클릿을 만들지 못했습니다. 다시 시도해 주세요.");
        setBookmarklet({ href: data.href });
      })
      .catch((err: unknown) => {
        if (alive)
          setBookmarkletError(
            err instanceof Error
              ? err.message
              : "북마클릿을 불러오지 못했습니다.",
          );
      });
    return () => {
      alive = false;
    };
  }, [bookmarkletKey]);

  // React refuses to render `javascript:` URLs, so the href is set on the node.
  useEffect(() => {
    if (bookmarklet && linkRef.current)
      linkRef.current.setAttribute("href", bookmarklet.href);
  }, [bookmarklet]);

  // The preview renders below the two source cards; bring it into view.
  useEffect(() => {
    if (previewShown) previewRef.current?.scrollIntoView({ block: "start" });
  }, [previewShown]);

  async function loadPreview() {
    if (busy) return;
    const body = url.trim() ? { url: url.trim() } : { ics };
    setError("");
    setImportError("");
    setFailed([]);
    setPreviewBusy(true);
    try {
      const data = await request<{
        items: EcampusAssignment[];
        calendarName: string | null;
        fetchedAt: string;
      }>("/api/kookmin/ecampus/preview", "POST", body);
      setPreview({ items: data.items, calendarName: data.calendarName });
      setSelected(new Set(data.items.map((item) => item.uid)));
      setFromBookmarklet(false);
      setPreviewShown((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "과제를 불러오지 못했습니다.",
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  async function importSelected() {
    if (busy || !preview) return;
    const items = preview.items
      .filter((item) => selected.has(item.uid))
      .map((item) => assignmentToImport(item, presets));
    if (!items.length) return;
    setImportError("");
    setFailed([]);
    setImportBusy(true);
    try {
      const result = await request<KookminImportResult>(
        "/api/kookmin/import",
        "POST",
        { items },
      );
      onImported(result.state, result);
      onToast(importMessage("eCampus 과제", result));
      setFailed(result.failed);
      setSelected(
        new Set(
          result.failed.map((item) =>
            item.idempotencyKey.replace(/^ecampus-/, ""),
          ),
        ),
      );
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "과제를 가져오지 못했습니다.",
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function copyCode() {
    if (!bookmarklet) return;
    // Copy the full `javascript:` address: the API's `code` is the bare script,
    // which does not work when pasted into a bookmark's URL field.
    try {
      await navigator.clipboard.writeText(bookmarklet.href);
      setManualCopy(false);
      setCopied(
        "코드를 복사했습니다. 새 북마크를 만들고 URL 칸에 붙여넣어 주세요.",
      );
    } catch {
      setManualCopy(true);
      setCopied(
        "자동으로 복사하지 못했습니다. 아래 코드를 직접 복사해 새 북마크의 URL 칸에 붙여넣어 주세요.",
      );
    }
  }

  const items = preview?.items ?? [];
  const allSelected = items.length > 0 && selected.size === items.length;
  const titles = new Map(
    items.map((item) => [`ecampus-${item.uid}`, item.title]),
  );

  const previewSection = preview && (
    <section
      ref={previewRef}
      className={`kmu-preview ${fromBookmarklet ? "kmu-preview-first" : ""}`}
      aria-label="eCampus 과제 미리보기"
    >
      <div className="section-heading">
        <h2>
          {preview.calendarName || "eCampus 과제"}{" "}
          <span className="count-label">{items.length}</span>
        </h2>
      </div>
      {!items.length ? (
        <div className="empty-state">
          <CalendarPlus size={28} strokeWidth={1.5} />
          <h3>가져올 과제가 없어요</h3>
          <p>달력 내보내기 범위를 넓혀 다시 시도해 보세요.</p>
        </div>
      ) : (
        <>
          <div className="kmu-controls">
            <label className="kmu-check">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={busy}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(items.map((item) => item.uid))
                      : new Set(),
                  )
                }
              />
              전체 선택
            </label>
          </div>
          <ImportFailures failed={failed} titles={titles} />
          <div className="kmu-table-wrap">
            <table className="kmu-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="kmu-sr">선택</span>
                  </th>
                  <th scope="col">과제명</th>
                  <th scope="col">과목</th>
                  <th scope="col">마감</th>
                  <th scope="col">링크</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const link = safeLink(item.url);
                  return (
                    <tr key={item.uid}>
                      <td>
                        <input
                          type="checkbox"
                          className="kmu-checkbox"
                          aria-label={`${item.title} 선택`}
                          checked={selected.has(item.uid)}
                          disabled={busy}
                          onChange={(event) => {
                            const next = new Set(selected);
                            if (event.target.checked) next.add(item.uid);
                            else next.delete(item.uid);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="kmu-cell-title">
                        {item.title}
                        {isAssignmentImported(events, item) && (
                          <span className="kmu-chip">가져옴</span>
                        )}
                      </td>
                      <td data-label="과목">{item.course || "—"}</td>
                      <td data-label="마감">
                        {shortDate(item.date)}{" "}
                        {item.time || (
                          <span className="kmu-warn">시간 확인 필요</span>
                        )}
                      </td>
                      <td>
                        {link ? (
                          <a
                            className="icon-button"
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            title="eCampus에서 열기"
                            aria-label={`${item.title} eCampus에서 열기`}
                          >
                            <ExternalLink size={15} />
                          </a>
                        ) : (
                          <span className="kmu-meta">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="kmu-import-bar">
            <ReminderPresets
              idPrefix="kmu-ecampus-preset"
              value={presets}
              onChange={setPresets}
              disabled={busy}
            />
            <button
              type="button"
              className="button primary kmu-import-button"
              disabled={busy || !selected.size}
              onClick={importSelected}
            >
              {importBusy ? (
                <Busy label="가져오는 중" />
              ) : (
                <>
                  <CalendarPlus size={16} />
                  선택 항목 가져오기 ({selected.size})
                </>
              )}
            </button>
            {importError && <Message text={importError} error />}
          </div>
        </>
      )}
    </section>
  );

  return (
    <div className="kmu-ecampus">
      {fromBookmarklet && preview && (
        <div className="kmu-banner" role="status">
          <Bookmark size={16} />
          eCampus에서 과제 {preview.items.length}개를 가져왔습니다. 가져올
          항목을 선택하세요
        </div>
      )}
      {/* Assignments sent by the bookmarklet are what the user came for: show them first. */}
      {fromBookmarklet && previewSection}
      <div className="kmu-ecampus-sources">
        <section className="kmu-card" aria-labelledby="kmu-url-heading">
          <div className="section-heading">
            <h3 id="kmu-url-heading">달력 주소로 가져오기</h3>
          </div>
          <label className="field">
            eCampus 달력 URL
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://ecampus.kookmin.ac.kr/calendar/export_execute.php?..."
            />
          </label>
          <p className="kmu-privacy">
            <ShieldCheck size={14} />
            주소는 서버에 저장하지 않습니다
          </p>
          <details className="kmu-steps">
            <summary>달력 주소는 어디서 얻나요?</summary>
            <ol>
              <li>eCampus(ecampus.kookmin.ac.kr)에 로그인합니다.</li>
              <li>달력 메뉴를 엽니다.</li>
              <li>“달력 내보내기”를 누릅니다.</li>
              <li>“모든 이벤트”와 “최근 및 다음 60일”을 선택합니다.</li>
              <li>“달력 URL 얻기”를 누릅니다.</li>
              <li>표시된 주소를 복사해 위 칸에 붙여넣습니다.</li>
            </ol>
          </details>
          <details className="kmu-steps">
            <summary>ICS 내용 직접 붙여넣기</summary>
            <label className="field">
              ICS 파일 내용
              <textarea
                rows={5}
                value={ics}
                disabled={busy}
                onChange={(event) => setIcs(event.target.value)}
                placeholder="BEGIN:VCALENDAR ..."
              />
            </label>
          </details>
          {error && <Message text={error} error />}
          <button
            type="button"
            className="button primary"
            disabled={busy || (!url.trim() && !ics.trim())}
            onClick={loadPreview}
          >
            {previewBusy ? (
              <Busy label="불러오는 중" />
            ) : (
              <>
                <Eye size={16} />
                미리보기
              </>
            )}
          </button>
        </section>
        <section className="kmu-card" aria-labelledby="kmu-bm-heading">
          <div className="section-heading">
            <h3 id="kmu-bm-heading">북마클릿으로 가져오기</h3>
          </div>
          <ol className="kmu-step-list">
            <li>아래 버튼을 브라우저 북마크바로 드래그합니다.</li>
            <li>eCampus에 로그인한 상태에서 그 북마크를 클릭합니다.</li>
            <li>이 앱이 열리며 과제 목록이 표시됩니다.</li>
          </ol>
          {bookmarklet ? (
            <div className="inline-actions">
              <a
                ref={linkRef}
                className="button secondary kmu-bookmarklet"
                draggable
                title="북마크바로 드래그하세요"
                onClick={(event) => {
                  event.preventDefault();
                  onToast(
                    "이 버튼은 클릭하지 말고 북마크바로 끌어다 놓아 주세요.",
                  );
                }}
              >
                {/* Plain text only: it becomes the bookmark's name when dragged. */}
                📌 국민대 과제 가져오기
              </a>
              <button
                type="button"
                className="button secondary"
                onClick={copyCode}
              >
                <Copy size={15} />
                코드 복사
              </button>
            </div>
          ) : bookmarkletError ? (
            <div className="kmu-quiet-error">
              <span>{bookmarkletError}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => setBookmarkletKey((value) => value + 1)}
              >
                다시 시도
              </button>
            </div>
          ) : (
            <Busy label="북마클릿 준비 중" />
          )}
          {copied && (
            <p className="kmu-meta" role="status">
              {copied}
            </p>
          )}
          {manualCopy && bookmarklet && (
            <textarea
              className="kmu-code"
              aria-label="북마클릿 코드"
              readOnly
              rows={4}
              value={bookmarklet.href}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
          <p className="kmu-meta">
            모바일 브라우저에서는 북마클릿이 동작하지 않을 수 있어요. 그때는
            달력 주소로 가져와 주세요.
          </p>
        </section>
      </div>
      {!fromBookmarklet && previewSection}
    </div>
  );
}
