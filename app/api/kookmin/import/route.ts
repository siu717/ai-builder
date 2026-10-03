import { z } from "zod";
import { apiError, assertSameOrigin, readJson, RouteError } from "@/lib/http";
import { importEvents } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 항목 하나하나는 importEvents가 검증해 failed로 돌려준다. 여기서는 묶음의 형태만 본다.
const importSchema = z.object({
  items: z.array(z.unknown(), "가져올 항목을 선택해주세요.").min(1, "가져올 항목을 선택해주세요.").max(200, "한 번에 200개까지 가져올 수 있습니다."),
}, "가져올 항목을 선택해주세요.").strict();

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const parsed = importSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || "";
      // 형식 오류는 zod 기본 문구(영문)라서 한국어 안내로 바꾼다.
      throw new RouteError(400, /[가-힣]/.test(message) ? message : "가져올 항목의 형식을 확인해주세요.");
    }
    return Response.json(await importEvents(parsed.data.items), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
