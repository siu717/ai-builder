import { apiError, RouteError } from "@/lib/http";
import { getNotices, isKookminBoard, NOTICE_MAX_PAGE } from "@/lib/kookmin/notices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    const board = query.get("board") ?? "academic";
    if (!isKookminBoard(board)) throw new RouteError(400, "공지 게시판을 확인해주세요.");
    const rawPage = query.get("page") ?? "1";
    const page = Number(rawPage);
    if (!/^\d{1,4}$/.test(rawPage) || page < 1 || page > NOTICE_MAX_PAGE) throw new RouteError(400, "쪽 번호를 확인해주세요.");
    return Response.json(await getNotices(board, page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
