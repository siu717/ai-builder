/** 라우트 공통 응답·에러 처리. 모든 API 가 같은 모양의 JSON 을 돌려주게 한다. */
import { NextResponse } from "next/server";
import { z } from "zod";

import { MissingEnvError } from "./env";
import { log } from "./logger";

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json<ApiError>({ error: { code, message, details } }, { status });
}

/** 본문을 zod 로 검증한다. 실패 시 어떤 필드가 문제인지 그대로 돌려준다. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: fail(400, "invalid_json", "요청 본문이 JSON 이 아닙니다."),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(
        422,
        "invalid_body",
        "요청 값이 형식에 맞지 않습니다.",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * 라우트를 감싸 예상 못한 예외가 스택과 함께 클라이언트로 새지 않게 한다.
 * PRD 9절: AI 응답 실패·형식 오류는 입력을 보존한 채 재시도 가능한 오류로 돌려준다.
 */
export function route(name: string, handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof MissingEnvError) {
        log.error("route.config_missing", { route: name, key: error.key });
        return fail(503, "config_missing", error.message);
      }
      log.error("route.unhandled", {
        route: name,
        name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      return fail(
        500,
        "internal_error",
        "서버에서 처리하지 못했습니다. 입력은 유지되니 다시 시도해 주세요.",
      );
    }
  };
}
