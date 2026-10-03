import { seoulToday } from "@/lib/catalog";
import { apiError, assertSameOrigin, RouteError } from "@/lib/http";
import { getExamSchedules, getPublicJobs, getPublicScholarships } from "@/lib/public-data";
import { getDataApiKey, getProfile } from "@/lib/store";
import { publicDataQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    // 호출마다 사용자의 일일 호출 한도를 쓰므로 다른 사이트에서 부르지 못하게 막는다.
    assertSameOrigin(request);
    const query = publicDataQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const serviceKey = await getDataApiKey("dataGoKr");
    if (!serviceKey) throw new RouteError(409, "설정 → 외부 데이터 API에서 공공데이터포털 인증키를 먼저 입력해주세요.");
    const options = { refresh: query.refresh === "1" };
    const result = query.source === "exams"
      ? await getExamSchedules(serviceKey, query.year || seoulToday().slice(0, 4), query.qualification || "T", options)
      : query.source === "jobs"
        ? await getPublicJobs(serviceKey, await getProfile(), options)
        : await getPublicScholarships(serviceKey, await getProfile(), options);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
