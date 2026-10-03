import { apiError, RouteError } from "@/lib/http";
import { getNoticeDetail, isKookminBoard } from "@/lib/kookmin/notices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ board: string; articleNo: string }> }): Promise<Response> {
  try {
    const { board, articleNo } = await params;
    if (!isKookminBoard(board)) throw new RouteError(400, "공지 게시판을 확인해주세요.");
    if (!/^\d{1,12}$/.test(articleNo)) throw new RouteError(400, "공지 글 번호를 확인해주세요.");
    return Response.json({ item: await getNoticeDetail(board, articleNo) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
