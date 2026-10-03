"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle, CheckCircle2, AlertCircle } from "lucide-react";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(
            "[role=dialog] input, [role=dialog] textarea, [role=dialog] button",
          )
          ?.focus(),
      30,
    );
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[role=dialog] button:not(:disabled), [role=dialog] input:not(:disabled), [role=dialog] select:not(:disabled), [role=dialog] textarea:not(:disabled), [role=dialog] a[href]",
          ),
        );
        if (!items.length) return;
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === items[items.length - 1]
        ) {
          event.preventDefault();
          items[0].focus();
        }
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", escape);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            title="닫기"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Busy({ label = "불러오는 중" }: { label?: string }) {
  return (
    <span className="busy">
      <LoaderCircle size={17} className="spin" />
      {label}
    </span>
  );
}

export function Message({
  text,
  error = false,
}: {
  text: string;
  error?: boolean;
}) {
  return (
    <div
      className={`message ${error ? "message-error" : "message-success"}`}
      role={error ? "alert" : "status"}
    >
      {error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
      <span>{text}</span>
    </div>
  );
}

// 서버 재시작·터널 순간 끊김(502·503·504·530, 연결 실패)은 조회 요청만 다시 시도한다.
const TRANSIENT = new Set([502, 503, 504, 530]);
const RETRY_DELAYS_MS = [1500, 3000, 5000];

export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const retries = method === "GET" ? RETRY_DELAYS_MS.length : 0;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers:
          body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw new Error("서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.");
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data as T;
    if (data.error) throw new Error(data.error);
    if (TRANSIENT.has(response.status) && attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    throw new Error(
      TRANSIENT.has(response.status)
        ? `서버가 재시작 중이거나 연결이 잠시 끊겼습니다. 잠시 후 다시 시도해 주세요. (HTTP ${response.status})`
        : `요청을 처리하지 못했습니다. 다시 시도해 주세요. (HTTP ${response.status})`,
    );
  }
}

export function seoulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function seoulInput(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
export function isoFromSeoul(value: string) {
  return new Date(
    `${value.length === 16 ? `${value}:00` : value}+09:00`,
  ).toISOString();
}

export function reminderToISO(draft: { at: string; originalAt?: string }) {
  return draft.originalAt && draft.at === seoulInput(draft.originalAt)
    ? draft.originalAt
    : isoFromSeoul(draft.at);
}
