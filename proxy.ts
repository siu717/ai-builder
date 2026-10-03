import { NextResponse, type NextRequest } from "next/server";
import { basicAuthFromEnv, isAuthorized } from "@/lib/basic-auth";

// Site-wide password for public deployments. The app has no accounts, so everyone who gets in
// shares one profile, calendar and Telegram setting. Off unless BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set.
export function proxy(request: NextRequest) {
  const credentials = basicAuthFromEnv();
  if (!credentials || isAuthorized(request.headers.get("authorization"), credentials)) return NextResponse.next();
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Campus", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
