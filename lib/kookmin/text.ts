// 국민대 연동에서 함께 쓰는 순수 함수 모음. 브라우저에서도 불러올 수 있도록 node 모듈을 쓰지 않는다.

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'",
  middot: "·", hellip: "…", ndash: "–", mdash: "—", bull: "•",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  rarr: "→", larr: "←", times: "×", deg: "°", tilde: "~", sim: "∼",
  copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,10});/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** HTML 조각을 읽을 수 있는 본문 텍스트로 바꾼다. 스크립트·스타일은 버리고 문단 구분만 남긴다. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|iframe|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style)\b[\s\S]*$/gi, " ")
    // 포스터 이미지만 있는 공지가 많다. 대체 텍스트가 있으면 본문으로 남긴다.
    .replace(/<img\b[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_match, double?: string, single?: string) => ` ${double ?? single ?? ""} `)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol|section|article|blockquote|dd|dt|caption)\s*>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(stripped)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 태그를 지우고 한 줄로 만든다. 제목·셀 텍스트에 쓴다. */
export function inlineText(html: string): string {
  return htmlToText(html).replace(/\s+/g, " ").trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  // 서로게이트 쌍의 앞쪽만 남지 않게 한다.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** ID에 쓰는 안정적인 조각. 한글·영문·숫자만 남긴다. */
export function slug(text: string, max = 60): string {
  const value = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return Array.from(value).slice(0, max).join("").replace(/-+$/g, "") || "item";
}

/** 암호용이 아닌 짧은 안정 해시(FNV-1a). UID가 없는 항목의 식별자를 만들 때 쓴다. */
export function stableHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + index), 0x811c9dc5) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

export interface SeoulParts {
  year: number;
  month: number;
  day: number;
  date: string;
  time: string;
}

/** 시각(instant)을 Asia/Seoul 달력 날짜와 HH:mm으로 바꾼다. 한국은 서머타임이 없어 +09:00 고정이다. */
export function seoulParts(instant: Date): SeoulParts {
  const shifted = new Date(instant.getTime() + SEOUL_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return { year, month, day, date: formatDate(year, month, day), time: `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}` };
}

/** `YYYY-MM-DD`에 일수를 더한다. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Moodle이 과제 일정 제목 뒤에 붙이는 말. 북마클릿 코드에도 같은 식을 넣는다. */
export const DUE_SUFFIX_SOURCE = "\\s+(?:is due to be graded|is due|should be completed|제출\\s*마감일?|마감일?|제출\\s*기한|기한)\\s*$";

export function cleanAssignmentTitle(raw: string): string {
  const title = raw.replace(/\s+/g, " ").trim();
  const cleaned = title.replace(new RegExp(DUE_SUFFIX_SOURCE, "i"), "").trim();
  return cleaned || title;
}
