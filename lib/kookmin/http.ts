// 국민대 공개 페이지와 eCampus 달력을 읽어 오는 서버 전용 fetch 도우미.
// 오류 메시지에 요청 주소를 넣지 않는다. eCampus 개인 URL에는 인증 토큰이 들어 있다.

export const KMU_ORIGIN = "https://www.kookmin.ac.kr";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type UpstreamReason = "network" | "timeout" | "too-large" | "status";

export class UpstreamError extends Error {
  constructor(public readonly reason: UpstreamReason, public readonly upstreamStatus?: number) {
    super(`upstream ${reason}${upstreamStatus ? ` ${upstreamStatus}` : ""}`);
    this.name = "UpstreamError";
  }
}

export interface FetchTextOptions {
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
  redirect?: "follow" | "manual";
  fetcher?: typeof fetch;
}

export interface FetchedText {
  status: number;
  contentType: string;
  text: string;
}

function charsetOf(contentType: string, bytes: Uint8Array): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  // 헤더에 없으면 문서 앞부분의 <meta charset>을 본다.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] || "utf-8";
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(contentType, bytes));
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new UpstreamError("too-large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UpstreamError("too-large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** 시간 제한과 크기 제한을 걸어 텍스트를 읽는다. 2xx가 아니면 UpstreamError를 던진다. */
export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<FetchedText> {
  const { accept = "text/html,application/xhtml+xml", timeoutMs = 15_000, maxBytes = 2_000_000, redirect = "follow", fetcher = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5" },
      redirect,
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      throw new UpstreamError("status", response.status);
    }
    const contentType = response.headers.get("content-type") || "";
    const bytes = await readCapped(response, maxBytes);
    return { status: response.status, contentType, text: decodeBody(bytes, contentType) };
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    // 원래 오류에는 주소가 들어 있을 수 있어 버리고 이유만 남긴다.
    throw new UpstreamError(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

/** 프로세스 메모리에만 두는 작은 TTL 캐시. */
export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number, private readonly maxEntries = 200) {}

  fresh(key: string, now: number): T | undefined {
    const entry = this.entries.get(key);
    return entry && now - entry.at < this.ttlMs ? entry.value : undefined;
  }

  /** 만료 여부와 상관없이 마지막 값을 돌려준다. 원본 사이트 장애 때 쓴다. */
  stale(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }

  set(key: string, value: T, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, { at: now, value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  values(): T[] {
    return [...this.entries.values()].map((entry) => entry.value);
  }

  clear(): void {
    this.entries.clear();
  }
}
