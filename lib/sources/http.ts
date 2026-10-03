import { fetchText } from "../kookmin/http";
import type { SourceContext } from "./types";

export const SOURCE_TIMEOUT_MS = 8_000;

/** 공개 페이지·API를 읽는다. 오류에는 주소(키가 들어갈 수 있음)를 남기지 않는다(fetchText가 보장). */
export async function getText(url: string, ctx: SourceContext, accept?: string, maxBytes = 3_000_000): Promise<string> {
  return (await fetchText(url, { fetcher: ctx.fetcher, timeoutMs: SOURCE_TIMEOUT_MS, maxBytes, accept })).text;
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * `cache: "no-store"` 없이 읽는다. 드림스폰은 요청에 `Cache-Control: no-cache`·`Pragma` 헤더가 붙으면
 * 연결을 끊는다(ECONNRESET, 2026-10-03 확인). fetchText는 no-store를 강제하므로 따로 둔다.
 */
export async function getTextPlain(url: string, ctx: SourceContext, maxChars = 3_000_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await (ctx.fetcher ?? fetch)(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" }, signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("upstream status");
    }
    const text = await response.text();
    if (text.length > maxChars) throw new Error("upstream too large");
    return text;
  } catch (error) {
    // 원래 오류에는 주소가 들어 있을 수 있어 이유만 남긴다.
    throw new Error(controller.signal.aborted ? "upstream timeout" : error instanceof Error && /^upstream /.test(error.message) ? error.message : "upstream network");
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(url: string, ctx: SourceContext): Promise<unknown> {
  return JSON.parse(await getText(url, ctx, "application/json")) as unknown;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function httpUrl(value: unknown): string {
  const text = str(value);
  if (!text) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname.includes(".") ? parsed.toString() : "";
  } catch {
    return "";
  }
}
