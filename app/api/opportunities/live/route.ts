import { apiError, RouteError } from "@/lib/http";
import { getLiveOpportunities } from "@/lib/sources";
import { getProfile } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    if (kind !== "scholarship" && kind !== "job") throw new RouteError(400, "kind는 scholarship 또는 job이어야 합니다.");
    const result = await getLiveOpportunities(kind, await getProfile(), { query: params.get("q") ?? "" });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
