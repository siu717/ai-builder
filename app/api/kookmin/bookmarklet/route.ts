import { apiError, RouteError } from "@/lib/http";
import { buildBookmarklet, buildBookmarkletCode } from "@/lib/kookmin/bookmarklet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appOrigin(request: Request): string {
  if (process.env.APP_URL) {
    try {
      const deployed = new URL(process.env.APP_URL);
      if (["http:", "https:"].includes(deployed.protocol)) return deployed.origin;
    } catch {
      // 잘못된 APP_URL이면 받은 Host로 만든다.
    }
  }
  const host = request.headers.get("host") || new URL(request.url).host;
  // Host 값이 북마클릿 코드에 들어가므로 호스트와 포트 형태만 받는다.
  if (!/^(?:[a-z0-9.-]{1,253}|\[[0-9a-f:]{2,45}\])(?::\d{1,5})?$/i.test(host)) {
    throw new RouteError(400, "앱 주소를 확인하지 못했습니다.");
  }
  return `http://${host}`;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const origin = appOrigin(request);
    return Response.json({ href: buildBookmarklet(origin), code: buildBookmarkletCode(origin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
