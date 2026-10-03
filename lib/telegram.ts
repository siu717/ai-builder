import { KIND_LABELS, type EventInput } from "./contracts";

export interface TelegramResult {
  ok: boolean;
  error?: string;
  retryAfter?: number;
  ambiguous?: boolean;
}

interface TelegramResponse {
  ok?: boolean;
  error_code?: number;
  parameters?: { retry_after?: number };
  result?: { username?: string };
}

async function requestTelegram(token: string, method: "sendMessage" | "getMe", body: object, fetcher = fetch): Promise<{ result: TelegramResult; username?: string }> {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    let data: TelegramResponse;
    try {
      data = await response.json() as TelegramResponse;
    } catch {
      return { result: { ok: false, ambiguous: true, error: "텔레그램 응답을 확인할 수 없습니다. 중복 방지를 위해 자동 재전송하지 않습니다." } };
    }
    if (response.ok && data.ok === true) {
      return { result: { ok: true }, username: data.result?.username };
    }
    const code = data.error_code || response.status;
    if (code === 429) {
      const retryAfter = Math.min(3600, Math.max(1, Math.ceil(data.parameters?.retry_after || 30)));
      return { result: { ok: false, error: "텔레그램 전송 제한으로 재시도 대기 중입니다.", retryAfter } };
    }
    if (code === 401 || code === 404) return { result: { ok: false, error: "텔레그램 봇 토큰을 확인해주세요." } };
    if (code === 403) return { result: { ok: false, error: "봇이 메시지를 보낼 수 없습니다. 봇을 시작하고 차단 여부를 확인해주세요." } };
    if (code === 400) return { result: { ok: false, error: "텔레그램 Chat ID를 확인하고 봇에게 /start를 보내주세요." } };
    return { result: { ok: false, error: "텔레그램 전송에 실패했습니다.", ...(data.ok === false && code >= 500 ? { retryAfter: 10 } : {}) } };
  } catch {
    return { result: { ok: false, ambiguous: true, error: "텔레그램 연결 결과를 확인할 수 없습니다. 중복 방지를 위해 자동 재전송하지 않습니다." } };
  }
}

export async function sendTelegramMessage(token: string, chatId: string, text: string, fetcher = fetch): Promise<TelegramResult> {
  return (await requestTelegram(token, "sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } }, fetcher)).result;
}

export async function verifyTelegramBot(token: string, fetcher = fetch): Promise<{ ok: boolean; username: string | null; error?: string }> {
  const response = await requestTelegram(token, "getMe", {}, fetcher);
  return { ok: response.result.ok, username: response.username || null, error: response.result.error };
}

export function notificationText(event: EventInput): string {
  return `[캠퍼스 비서 · ${KIND_LABELS[event.kind]}]\n${event.title}\n마감: ${event.date}${event.time ? ` ${event.time} (한국 시간)` : " (시각 확인 필요)"}${event.notes ? `\n${event.notes.slice(0, 1000)}` : ""}`;
}
