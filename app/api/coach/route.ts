import { coachResume, coachingRequestSchema } from "@/lib/ai";
import { apiError, assertSameOrigin, readJson, RouteError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const parsed = coachingRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new RouteError(422, "목표 공고와 이력서 또는 자기소개서를 모두 입력해 주세요. 각 입력은 50,000자까지 가능합니다.");
    return Response.json(await coachResume(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
