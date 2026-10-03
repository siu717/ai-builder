import { apiError, assertSameOrigin } from "@/lib/http";
import { runPipelineTest } from "@/lib/scholarships";

export const runtime = "nodejs";

// 데모용: 수집된 공지 하나로 AI 분석과 텔레그램 발송을 바로 실행한다. 일정은 만들지 않는다.
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    return Response.json(await runPipelineTest(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
