import { apiError, RouteError } from "@/lib/http";
import { getNoticeDetail } from "@/lib/kookmin/notices";
import { KMU_JOB_ID, KMU_SCHOLARSHIP_ID } from "@/lib/sources/kookmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 국민대 공지 본문을 돌려준다. "AI로 조건 분석"에 넣을 원문으로 쓴다. */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const sourceId = params.get("sourceId");
    const externalId = params.get("externalId") ?? "";
    if (sourceId !== KMU_SCHOLARSHIP_ID && sourceId !== KMU_JOB_ID) throw new RouteError(400, "본문을 가져올 수 없는 출처입니다.");
    if (!/^\d{1,12}$/.test(externalId)) throw new RouteError(400, "공지 번호가 올바르지 않습니다.");
    // 상세 페이지는 게시판 번호와 상관없이 글 번호로 열린다.
    const notice = await getNoticeDetail(sourceId === KMU_SCHOLARSHIP_ID ? "scholarship" : "general", externalId);
    return Response.json({ text: notice.text, notice }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
