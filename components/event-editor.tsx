"use client";

import { useState } from "react";
import { Bell, BellPlus, Trash2, Save, Plus, Send } from "lucide-react";
import type {
  AppState,
  CalendarEvent,
  Channel,
  EventInput,
  EventKind,
  PublicSettings,
} from "@/lib/contracts";
import { KIND_LABELS } from "@/lib/contracts";
import {
  Modal,
  Message,
  Busy,
  request,
  seoulDate,
  seoulInput,
  reminderToISO,
} from "./ui";
import ChecklistEditor from "./checklist-editor";
import type { ChecklistItem } from "@/lib/checklist";

type ReminderDraft = { at: string; channel: Channel; originalAt?: string };
export type EventDraft = Partial<EventInput> & {
  id?: string;
  completed?: boolean;
};

export default function EventEditor({
  initial,
  settings,
  onClose,
  onSave,
}: {
  initial: EventDraft;
  settings: PublicSettings;
  onClose: () => void;
  onSave: (state: AppState) => void;
}) {
  const [title, setTitle] = useState(initial.title || "");
  const [kind, setKind] = useState<EventKind>(initial.kind || "assignment");
  const [date, setDate] = useState(initial.date ?? seoulDate());
  const [time, setTime] = useState(initial.time || "");
  const [notes, setNotes] = useState(initial.notes || "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    initial.checklist || [],
  );
  const [reminders, setReminders] = useState<ReminderDraft[]>(
    (initial.reminders || [])
      .filter((item) => new Date(item.at).getTime() > Date.now())
      .map((item) => ({ at: seoulInput(item.at), channel: item.channel, originalAt: item.at })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [saveKey] = useState(
    () =>
      initial.idempotencyKey ||
      (typeof crypto !== "undefined"
        ? crypto.randomUUID()
        : String(Date.now())),
  );

  function addReminder(offset?: number) {
    let originalAt: string;
    if (offset !== undefined && date) {
      const value = new Date(`${date}T${time || "09:00"}:00+09:00`);
      value.setUTCDate(value.getUTCDate() - offset);
      originalAt = value.toISOString();
    } else originalAt = new Date(Date.now() + 60_000).toISOString();
    setReminders([...reminders, { at: seoulInput(originalAt), originalAt, channel: "app" }]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!title.trim() || !date) {
      setError("일정 제목과 날짜를 확인해 주세요.");
      return;
    }
    if (checklist.some((item) => !item.text.trim())) {
      setError("준비물 내용을 입력하거나 빈 항목을 삭제해 주세요.");
      return;
    }
    if (
      reminders.some(
        (item) =>
          !item.at ||
          !Number.isFinite(
            new Date(
              `${item.at.length === 16 ? `${item.at}:00` : item.at}+09:00`,
            ).getTime(),
          ),
      )
    ) {
      setError("알림 날짜와 시각을 입력해 주세요.");
      return;
    }
    const formatted = reminders.map((item) => ({
      at: reminderToISO(item),
      channel: item.channel,
    }));
    if (formatted.some((item) => new Date(item.at).getTime() <= Date.now())) {
      setError("이미 지난 알림 시각입니다. 미래 시각을 선택해 주세요.");
      return;
    }
    const deadline = new Date(`${date}T${time ? `${time}:00` : "23:59:59.999"}+09:00`).getTime();
    if (formatted.some((item) => new Date(item.at).getTime() > deadline)) {
      setError("알림은 마감 날짜 또는 시각 이전으로 설정해 주세요.");
      return;
    }
    if (
      initial.isSample &&
      formatted.some((item) => item.channel === "telegram")
    ) {
      setError("샘플 일정은 앱 알림으로 등록해 주세요.");
      return;
    }
    const data: EventInput = {
      title: title.trim(),
      kind,
      date,
      time: time || null,
      notes,
      checklist: checklist.map((item) => ({ ...item, text: item.text.trim() })),
      source: initial.source || "",
      isSample: initial.isSample || false,
      reminders: formatted,
      idempotencyKey: saveKey,
    };
    setBusy(true);
    try {
      onSave(
        await request<AppState>(
          initial.id ? `/api/events/${initial.id}` : "/api/events",
          initial.id ? "PATCH" : "POST",
          data,
        ),
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "일정을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      onSave(await request<AppState>(`/api/events/${initial.id}`, "DELETE"));
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "일정을 삭제하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={initial.id ? "일정 상세 · 수정" : "새 일정"}
      onClose={onClose}
    >
      <form className="modal-body" onSubmit={save}>
        {initial.isSample && (
          <div className="sample-banner">샘플 일정 · 앱 알림만 발송됩니다</div>
        )}
        <label className="field">
          일정 제목
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="예: 데이터베이스 팀 과제 제출"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            종류
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as EventKind)}
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            날짜
            <input
              required
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </div>
        <label className="field">
          마감 시각 <span className="optional">선택</span>
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        {!time && <p className="field-note">마감 시간 확인 필요</p>}
        <label className="field">
          메모
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="제출 방법, 준비할 서류, 확인할 내용"
          />
        </label>
        <ChecklistEditor
          items={checklist}
          onChange={setChecklist}
          disabled={busy}
        />
        <div className="reminder-section">
          <div className="section-heading">
            <h3>
              <Bell size={16} /> 알림
            </h3>
            <span className="muted small">Asia/Seoul</span>
          </div>
          <div className="reminder-presets">
            <button
              type="button"
              className="text-button"
              onClick={() => addReminder(3)}
            >
              3일 전
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => addReminder(1)}
            >
              1일 전
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => addReminder(0)}
            >
              당일
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => addReminder()}
            >
              <BellPlus size={14} />
              1분 뒤
            </button>
          </div>
          {reminders.length === 0 && (
            <p className="field-note">예약된 알림 없음</p>
          )}
          {reminders.map((item, index) => (
            <div className="reminder-row" key={index}>
              <input
                aria-label={`알림 ${index + 1} 시각`}
                type="datetime-local"
                step="1"
                required
                value={item.at}
                onChange={(event) =>
                  setReminders(
                    reminders.map((current, position) =>
                      position === index
                        ? { ...current, at: event.target.value }
                        : current,
                    ),
                  )
                }
              />
              <select
                aria-label={`알림 ${index + 1} 수신 채널`}
                value={item.channel}
                onChange={(event) =>
                  setReminders(
                    reminders.map((current, position) =>
                      position === index
                        ? { ...current, channel: event.target.value as Channel }
                        : current,
                    ),
                  )
                }
              >
                <option value="app">앱 알림</option>
                <option
                  value="telegram"
                  disabled={
                    initial.isSample ||
                    !settings.telegramEnabled ||
                    !settings.telegramConfigured
                  }
                >
                  텔레그램
                </option>
              </select>
              <button
                className="icon-button danger-text"
                type="button"
                title="알림 삭제"
                aria-label={`알림 ${index + 1} 삭제`}
                onClick={() =>
                  setReminders(
                    reminders.filter((_, position) => index !== position),
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
            onClick={() => addReminder()}
          >
            <Plus size={15} />
            알림 추가
          </button>
        </div>
        {initial.source && (
          <details className="original-source">
            <summary>원문 확인</summary>
            <pre>{initial.source}</pre>
          </details>
        )}
        {error && <Message text={error} error />}
        {deleting && (
          <div className="delete-confirm">
            <span>이 일정과 예약된 알림을 삭제할까요?</span>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={remove}
            >
              삭제
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setDeleting(false)}
            >
              취소
            </button>
          </div>
        )}
        <div className="modal-actions">
          {initial.id && (
            <button
              type="button"
              className="icon-button danger-text"
              title="일정 삭제"
              aria-label="일정 삭제"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={19} />
            </button>
          )}
          <span className="action-spacer" />
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? (
              <Busy label="저장 중" />
            ) : (
              <>
                <Save size={16} />
                일정 저장
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
