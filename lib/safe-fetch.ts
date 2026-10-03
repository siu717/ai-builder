import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class FetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchError";
  }
}

export type TextFetcher = (url: string) => Promise<string>;

function ipv4Private(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return ipv4Private(address);
  const value = address.toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value);
}

/** 사용자가 등록한 주소는 서버 내부망을 가리킬 수 있으므로 공인 주소만 허용한다. */
async function assertPublicUrl(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new FetchError("http 또는 https 주소만 가져올 수 있습니다.");
  }
  if (process.env.ALLOW_PRIVATE_IMPORT_URLS === "1") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => {
    throw new FetchError(`${url.hostname} 주소를 찾을 수 없습니다.`);
  })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new FetchError("내부망 주소는 가져올 수 없습니다.");
  }
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 300));
  const charset = contentType?.match(/charset=["']?([\w-]+)/i)?.[1]
    || head.match(/encoding=["']([\w-]+)["']/i)?.[1]
    || "utf-8";
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export function normalizeFeedUrl(value: string): string {
  return value.trim().replace(/^webcals?:\/\//i, "https://");
}

export async function fetchPublicText(value: string, { maxBytes = 3_000_000, timeoutMs = 15_000 } = {}): Promise<string> {
  let url = new URL(normalizeFeedUrl(value));
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(url);
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", signal, headers: { "User-Agent": "ChamsipCampus/1.0 (+schedule import)" } });
    } catch {
      throw new FetchError(signal.aborted ? "응답 시간이 초과되었습니다." : "주소에 연결하지 못했습니다.");
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    if (!response.ok) throw new FetchError(`서버가 ${response.status} 응답을 반환했습니다.`);
    if (Number(response.headers.get("content-length")) > maxBytes) throw new FetchError("응답이 너무 큽니다.");
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FetchError("응답이 너무 큽니다.");
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decode(bytes, response.headers.get("content-type"));
  }
  throw new FetchError("리디렉션이 너무 많습니다.");
}
