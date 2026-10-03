import { apiError, RouteError } from "@/lib/http";
import { getSchedule } from "@/lib/kookmin/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `?year=2027`처럼 학년도를 고를 수 있다. 없으면 서울 기준 현재 학년도다.
export async function GET(request: Request): Promise<Response> {
  try {
    const rawYear = new URL(request.url).searchParams.get("year");
    const year = rawYear === null ? undefined : Number(rawYear);
    if (rawYear !== null && (!/^\d{4}$/.test(rawYear) || Number(rawYear) < 2000 || Number(rawYear) > 2100)) {
      throw new RouteError(400, "학년도를 확인해주세요.");
    }
    return Response.json(await getSchedule({ year }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
