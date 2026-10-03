/**
 * PRD 8절: "분석용 원문·서류·프로필을 로그에 그대로 출력하지 않는다".
 *
 * 그래서 로그에는 길이·해시·개수 같은 메타데이터만 넣는다. 원문을 넘기면
 * 실수로 찍히는 게 아니라 아예 요약으로 바뀌도록 redact() 를 거치게 했다.
 */
import { createHash } from "node:crypto";

type Level = "info" | "warn" | "error";

/** 민감 문자열을 로그에 안전한 지문으로 바꾼다. 같은 입력은 같은 지문이 되어 추적은 가능하다. */
export function redact(value: string | null | undefined) {
  if (!value) return { chars: 0, sha256: null };
  return {
    chars: value.length,
    sha256: createHash("sha256").update(value).digest("hex").slice(0, 12),
  };
}

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
