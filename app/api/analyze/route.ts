import { analyzeRequestSchema, analyzeText } from "@/lib/ai";
import { apiError, assertSameOrigin, readJson, RouteError } from "@/lib/http";
import { getProfile } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const parsed = analyzeRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new RouteError(422, "공지, 종류, 작성일(YYYY-MM-DD), 수업 시간(HH:mm), 샘플 여부를 확인해 주세요.");
    return Response.json(await analyzeText(parsed.data, await getProfile()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
