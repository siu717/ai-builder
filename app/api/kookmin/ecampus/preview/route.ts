import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { previewEcampus } from "@/lib/kookmin/ecampus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 개인 달력 URL에는 인증 토큰이 들어 있다. 저장하거나 로그에 남기지 않는다.
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    return Response.json(await previewEcampus(await readJson(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
