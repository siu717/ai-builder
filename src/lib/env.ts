/**
 * 환경변수 접근을 한 곳으로 모음.
 *
 * 빌드 시점에 키가 없어도 빌드는 성공해야 하므로(Vercel 최초 배포), 검증은
 * 실제로 값을 쓰는 순간에 한다. 누락은 500이 아니라 설명 가능한 에러로 만든다.
 */
import { z } from "zod";

const DEFAULT_TIMEZONE = "Asia/Seoul";

export class MissingEnvError extends Error {
  constructor(public readonly key: string) {
    super(`환경변수 ${key} 가 설정되지 않았습니다. .env.example 을 참고하세요.`);
    this.name = "MissingEnvError";
  }
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new MissingEnvError(key);
  return value;
}

export const env = {
  /** Claude API 키. 서버에서만 읽는다 — NEXT_PUBLIC_ 접두사를 붙이지 말 것. */
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),

  /** libSQL 접속 URL. 로컬은 file:./local.db, 프로덕션은 libsql://... */
  databaseUrl: () => process.env.DATABASE_URL ?? "file:./local.db",

  /** Turso 등 원격 libSQL 에만 필요. 파일 DB 에서는 비어 있어야 정상. */
  databaseAuthToken: () => process.env.DATABASE_AUTH_TOKEN || undefined,

  timezone: () => process.env.APP_TIMEZONE ?? DEFAULT_TIMEZONE,

  isProduction: () => process.env.NODE_ENV === "production",
} as const;

/** 설정 누락을 요청 처리 전에 한 번에 확인 — /api/health 가 이걸 쓴다. */
export function checkConfig() {
  const checks = {
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
  };
  const remote = env.databaseUrl().startsWith("libsql://");
  return {
    checks,
    /** 원격 DB 인데 토큰이 없으면 연결 단계에서 실패한다. */
    databaseAuthTokenRequired: remote && !env.databaseAuthToken(),
    timezone: env.timezone(),
  };
}

export const timezoneSchema = z.string().default(DEFAULT_TIMEZONE);
