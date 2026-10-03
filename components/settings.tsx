"use client";

import { useState, useEffect } from "react";
import {
  UserRound,
  Send,
  Save,
  BellRing,
  ExternalLink,
  CheckCircle2,
  Radio,
  KeyRound,
} from "lucide-react";
import type { AppState, Profile, PublicSettings } from "@/lib/contracts";
import { Busy, Message, request } from "./ui";

export default function Settings({
  profile,
  settings,
  onSave,
}: {
  profile: Profile;
  settings: PublicSettings;
  onSave: (state: AppState) => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(settings.telegramChatId);
  const [enabled, setEnabled] = useState(settings.telegramEnabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  useEffect(() => {
    if ("Notification" in window) setPermission(Notification.permission);
  }, []);
  const field = (key: keyof Profile, value: string) =>
    setDraft({ ...draft, [key]: value });
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy("profile");
    setError("");
    setMessage("");
    try {
      onSave(await request<AppState>("/api/profile", "PUT", draft));
      setMessage("학생 프로필을 저장했습니다.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "프로필을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function saveTelegram(event: React.FormEvent) {
    event.preventDefault();
    setBusy("telegram");
    setError("");
    setMessage("");
    try {
      onSave(
        await request<AppState>("/api/settings", "PUT", {
          telegramToken: token || undefined,
          telegramChatId: chatId.trim(),
          telegramEnabled: enabled,
        }),
      );
      setToken("");
      setMessage("텔레그램 알림 설정을 저장했습니다.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "텔레그램 설정을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function testTelegram() {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const result = await request<{ ok: true; message: string }>(
        "/api/telegram/test",
        "POST",
        {},
      );
      setMessage(result.message);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "테스트 메시지를 보내지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function enableBrowser() {
    if (!("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      setError("브라우저 알림 권한을 확인하지 못했습니다.");
    }
  }
  return (
    <div className="settings-layout">
      {error && <Message text={error} error />}
      {message && <Message text={message} />}
      <section className="settings-section">
        <div className="section-heading">
          <h2>
            <UserRound size={19} />
            학생 프로필
          </h2>
        </div>
        <form onSubmit={saveProfile}>
          <div className="form-grid">
            <label className="field">
              이름
              <input
                required
                value={draft.name}
                maxLength={60}
                onChange={(event) => field("name", event.target.value)}
              />
            </label>
            <label className="field">
              학년
              <select
                value={draft.year}
                onChange={(event) => field("year", event.target.value)}
              >
                <option value="">미입력</option>
                <option value="1">1학년</option>
                <option value="2">2학년</option>
                <option value="3">3학년</option>
                <option value="4">4학년</option>
                <option value="graduate">졸업 · 졸업 예정</option>
              </select>
            </label>
            <label className="field">
              전공
              <input
                value={draft.major}
                maxLength={100}
                onChange={(event) => field("major", event.target.value)}
                placeholder="예: 컴퓨터공학"
              />
            </label>
            <div className="form-grid gpa-fields">
              <label className="field">
                학점
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={draft.gpaScale}
                  value={draft.gpa}
                  onChange={(event) => field("gpa", event.target.value)}
                  placeholder="미입력"
                />
              </label>
              <label className="field">
                만점
                <select
                  value={draft.gpaScale}
                  onChange={(event) => field("gpaScale", event.target.value)}
                >
                  <option value="4.5">4.5</option>
                  <option value="4.3">4.3</option>
                  <option value="4.0">4.0</option>
                </select>
              </label>
            </div>
          </div>
          <label className="field">
            관심 직무
            <input
              value={draft.interests}
              maxLength={300}
              onChange={(event) => field("interests", event.target.value)}
              placeholder="예: 프론트엔드 개발, 서비스 기획"
            />
          </label>
          <label className="field">
            경력 · 보유 역량 <span className="optional">선택</span>
            <textarea
              rows={3}
              value={draft.experience}
              onChange={(event) => field("experience", event.target.value)}
              placeholder="프로젝트, 인턴 경험, 사용 기술, 자격증"
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={busy !== null}
          >
            {busy === "profile" ? (
              <Busy label="저장 중" />
            ) : (
              <>
                <Save size={16} />
                프로필 저장
              </>
            )}
          </button>
        </form>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <h2>
            <Send size={19} />
            텔레그램 알림
          </h2>
          <span
            className={`connection-label ${settings.telegramConfigured && settings.telegramEnabled ? "connected" : ""}`}
          >
            <span />
            {settings.telegramConfigured
              ? settings.telegramEnabled
                ? "연결됨"
                : "비활성"
              : "연결 대기"}
          </span>
        </div>
        <form onSubmit={saveTelegram}>
          <div className="telegram-switch-row">
            <span>텔레그램으로 일정 알림 받기</span>
            <label className="switch">
              <input
                aria-label="텔레그램 알림 활성화"
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span />
            </label>
          </div>
          <label className="field">
            Bot Token
            <input
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                settings.telegramConfigured
                  ? "저장된 토큰 유지"
                  : "봇 토큰 입력"
              }
            />
          </label>
          <label className="field">
            Chat ID
            <input
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              placeholder="개인 채팅 또는 그룹 ID"
            />
          </label>
          {settings.botUsername && (
            <div className="bot-link">
              <CheckCircle2 size={16} />
              <a
                href={`https://t.me/${settings.botUsername}`}
                target="_blank"
                rel="noreferrer"
              >
                @{settings.botUsername}
                <ExternalLink size={13} />
              </a>
            </div>
          )}
          <div className="inline-actions">
            <button
              className="button primary"
              type="submit"
              disabled={busy !== null}
            >
              {busy === "telegram" ? (
                <Busy label="저장 중" />
              ) : (
                <>
                  <Save size={16} />
                  연결 저장
                </>
              )}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={
                busy !== null ||
                !settings.telegramConfigured ||
                !settings.telegramEnabled ||
                token.length > 0 ||
                chatId.trim() !== settings.telegramChatId ||
                enabled !== settings.telegramEnabled
              }
              onClick={testTelegram}
            >
              {busy === "test" ? (
                <Busy label="발송 중" />
              ) : (
                <>
                  <Send size={15} />
                  테스트 발송
                </>
              )}
            </button>
          </div>
          <a
            className="text-button botfather-link"
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
          >
            <KeyRound size={14} />
            BotFather <ExternalLink size={13} />
          </a>
        </form>
      </section>
      <section className="settings-section browser-section">
        <div className="section-heading">
          <h2>
            <BellRing size={19} />
            브라우저 알림
          </h2>
        </div>
        <div className="setting-inline">
          <span>알림 권한</span>
          <span
            className={`status-text ${permission === "granted" ? "status-met" : "status-unknown"}`}
          >
            {permission === "granted"
              ? "허용됨"
              : permission === "denied"
                ? "차단됨"
                : permission === "unsupported"
                  ? "지원하지 않는 브라우저"
                  : "권한 대기"}
          </span>
          <button
            className="button secondary"
            onClick={enableBrowser}
            disabled={permission !== "default"}
          >
            <BellRing size={16} />
            권한 요청
          </button>
        </div>
        <div className="setting-inline">
          <span>
            <Radio size={16} />
            예약 알림 서버
          </span>
          <span
            className={`status-text ${settings.workerLastSeen && Date.now() - new Date(settings.workerLastSeen).getTime() < 120_000 ? "status-met" : "status-unknown"}`}
          >
            {settings.workerLastSeen &&
            Date.now() - new Date(settings.workerLastSeen).getTime() < 120_000
              ? "실행 중"
              : "연결 대기"}
          </span>
        </div>
        <div className="setting-inline">
          <span>
            <SparklesIcon />
            AI 분석
          </span>
          <span
            className={`status-text ${settings.aiConfigured ? "status-met" : "status-unknown"}`}
          >
            {settings.aiConfigured ? "연결됨" : "API 키 설정 필요"}
          </span>
        </div>
      </section>
    </div>
  );
}

function SparklesIcon() {
  return <span className="ai-mini-icon">AI</span>;
}
