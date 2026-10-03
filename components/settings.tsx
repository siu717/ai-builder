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
  Sparkles,
  Trash2,
  Database,
} from "lucide-react";
import {
  DATA_PROVIDERS,
  type AppState,
  type DataProvider,
  type Profile,
  type PublicSettings,
} from "@/lib/contracts";
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
  const [aiKey, setAiKey] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [confirmAiDelete, setConfirmAiDelete] = useState(false);
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
  async function saveAiKey(event: React.FormEvent) {
    event.preventDefault();
    if (!aiKey.trim() || busy !== null) return;
    setBusy("ai-save");
    setAiError("");
    setAiMessage("");
    try {
      const state = await request<AppState>("/api/settings/ai", "PUT", {
        apiKey: aiKey.trim(),
      });
      setAiKey("");
      setConfirmAiDelete(false);
      onSave(state);
      setAiMessage("AI 분석용 API 키를 저장했습니다.");
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : "API 키를 저장하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function deleteAiKey() {
    if (busy !== null) return;
    setBusy("ai-delete");
    setAiError("");
    setAiMessage("");
    try {
      const state = await request<AppState>("/api/settings/ai", "DELETE");
      setAiKey("");
      setConfirmAiDelete(false);
      onSave(state);
      setAiMessage("저장된 API 키를 삭제했습니다.");
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : "API 키를 삭제하지 못했습니다.",
      );
    } finally {
      setBusy(null);
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
      <section
        className="settings-section browser-section"
        aria-label="AI 분석 설정"
      >
        <div className="section-heading">
          <h2>
            <Sparkles size={19} />
            AI 분석 설정
          </h2>
          <span
            className={`status-text ${settings.aiConfigured ? "status-met" : "status-unknown"}`}
          >
            {settings.aiKeySource === "saved"
              ? "설정됨"
              : settings.aiKeySource === "environment"
                ? "환경변수 사용"
                : "키 미설정"}
          </span>
        </div>
        <form onSubmit={saveAiKey} className="ai-key-form">
          <label className="field">
            ANTHROPIC_API_KEY
            <input
              type="password"
              autoComplete="new-password"
              value={aiKey}
              disabled={busy !== null}
              onChange={(event) => setAiKey(event.target.value)}
              placeholder={
                settings.aiKeySource === "saved"
                  ? "새 API 키 입력"
                  : "API 키 입력"
              }
            />
          </label>
          <div className="inline-actions">
            <button
              type="submit"
              className="button primary"
              disabled={busy !== null || !aiKey.trim()}
            >
              {busy === "ai-save" ? (
                <Busy label="저장 중" />
              ) : (
                <>
                  <Save size={16} />
                  API 키 저장
                </>
              )}
            </button>
            {settings.aiKeySource === "saved" && (
              <button
                type="button"
                className="icon-button danger-text"
                title="저장된 API 키 삭제"
                aria-label="저장된 API 키 삭제"
                disabled={busy !== null}
                onClick={() => setConfirmAiDelete(true)}
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
          {confirmAiDelete && settings.aiKeySource === "saved" && (
            <div
              className="delete-confirm"
              role="group"
              aria-label="API 키 삭제 확인"
            >
              <span>저장된 API 키를 삭제할까요?</span>
              <button
                type="button"
                className="button danger"
                disabled={busy !== null}
                onClick={deleteAiKey}
              >
                {busy === "ai-delete" ? (
                  <Busy label="삭제 중" />
                ) : (
                  "API 키 삭제"
                )}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy !== null}
                onClick={() => setConfirmAiDelete(false)}
              >
                취소
              </button>
            </div>
          )}
          {aiError && <Message text={aiError} error />}
          {aiMessage && <Message text={aiMessage} />}
        </form>
      </section>
      <section
        className="settings-section browser-section"
        aria-label="외부 데이터 API"
      >
        <div className="section-heading">
          <h2>
            <Database size={19} />
            외부 데이터 API
          </h2>
        </div>
        {DATA_PROVIDERS.map((provider) => (
          <DataKeyForm
            key={provider}
            provider={provider}
            settings={settings}
            busy={busy}
            setBusy={setBusy}
            onSave={onSave}
          />
        ))}
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
      </section>
    </div>
  );
}

const DATA_KEY_INFO: Record<
  DataProvider,
  { title: string; label: string; hint: string; link: string; linkLabel: string }
> = {
  dataGoKr: {
    title: "공공데이터포털",
    label: "DATA_GO_KR_API_KEY",
    hint: "공공기관 채용정보, 큐넷 시험일정, 장학금 데이터를 각각 활용신청한 뒤 마이페이지의 일반 인증키를 입력하세요. 하나의 키로 승인된 데이터를 모두 사용하며, Encoding·Decoding 키 중 어느 것을 입력해도 됩니다.",
    link: "https://www.data.go.kr",
    linkLabel: "data.go.kr",
  },
  saramin: {
    title: "사람인",
    label: "SARAMIN_API_KEY",
    hint: "사람인 오픈 API 승인 후 발급되는 access-key를 입력하세요.",
    link: "https://oapi.saramin.co.kr",
    linkLabel: "oapi.saramin.co.kr",
  },
};

function DataKeyForm({
  provider,
  settings,
  busy,
  setBusy,
  onSave,
}: {
  provider: DataProvider;
  settings: PublicSettings;
  busy: string | null;
  setBusy: (busy: string | null) => void;
  onSave: (state: AppState) => void;
}) {
  const info = DATA_KEY_INFO[provider];
  const source = settings.dataKeys[provider];
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!apiKey.trim() || busy !== null) return;
    setBusy(`${provider}-save`);
    setError("");
    setMessage("");
    try {
      const state = await request<AppState>("/api/settings/data-keys", "PUT", {
        provider,
        apiKey: apiKey.trim(),
      });
      setApiKey("");
      setConfirmDelete(false);
      onSave(state);
      setMessage(`${info.title} API 키를 저장했습니다.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "API 키를 저장하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (busy !== null) return;
    setBusy(`${provider}-delete`);
    setError("");
    setMessage("");
    try {
      const state = await request<AppState>("/api/settings/data-keys", "DELETE", {
        provider,
      });
      setApiKey("");
      setConfirmDelete(false);
      onSave(state);
      setMessage(`저장된 ${info.title} API 키를 삭제했습니다.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "API 키를 삭제하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <form
      onSubmit={save}
      className="ai-key-form data-key-form"
      aria-label={`${info.title} API 키`}
    >
      <div className="setting-inline">
        <span>{info.title}</span>
        <span
          className={`status-text ${source ? "status-met" : "status-unknown"}`}
        >
          {source === "saved"
            ? "설정됨"
            : source === "environment"
              ? "환경변수 사용"
              : "키 미설정"}
        </span>
        <a
          className="text-button"
          href={info.link}
          target="_blank"
          rel="noreferrer"
        >
          {info.linkLabel} <ExternalLink size={13} />
        </a>
      </div>
      <p className="data-key-hint">{info.hint}</p>
      <label className="field">
        {info.label}
        <input
          type="password"
          autoComplete="new-password"
          value={apiKey}
          disabled={busy !== null}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={source === "saved" ? "새 API 키 입력" : "API 키 입력"}
        />
      </label>
      <div className="inline-actions">
        <button
          type="submit"
          className="button primary"
          disabled={busy !== null || !apiKey.trim()}
        >
          {busy === `${provider}-save` ? (
            <Busy label="저장 중" />
          ) : (
            <>
              <Save size={16} />
              API 키 저장
            </>
          )}
        </button>
        {source === "saved" && (
          <button
            type="button"
            className="icon-button danger-text"
            title={`저장된 ${info.title} API 키 삭제`}
            aria-label={`저장된 ${info.title} API 키 삭제`}
            disabled={busy !== null}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
      {confirmDelete && source === "saved" && (
        <div
          className="delete-confirm"
          role="group"
          aria-label={`${info.title} API 키 삭제 확인`}
        >
          <span>저장된 {info.title} API 키를 삭제할까요?</span>
          <button
            type="button"
            className="button danger"
            disabled={busy !== null}
            onClick={remove}
          >
            {busy === `${provider}-delete` ? (
              <Busy label="삭제 중" />
            ) : (
              "API 키 삭제"
            )}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy !== null}
            onClick={() => setConfirmDelete(false)}
          >
            취소
          </button>
        </div>
      )}
      {error && <Message text={error} error />}
      {message && <Message text={message} />}
    </form>
  );
}
