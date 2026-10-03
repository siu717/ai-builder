import { NextResponse, type NextRequest } from "next/server";
import { basicAuthFromEnv, isAuthorized } from "@/lib/basic-auth";
import { ANONYMOUS_COOKIE_NAME, isAnonymousPublicMode, resolveAnonymousSession } from "@/lib/anonymous-session";
import { apiError, assertSameOrigin } from "@/lib/http";

export async function proxy(request: NextRequest) {
  if (isAnonymousPublicMode()) {
    // Health probes must not allocate a new guest database on every request.
    if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertSameOrigin(request);
      const guest = await resolveAnonymousSession(request.cookies.get(ANONYMOUS_COOKIE_NAME)?.value);
      request.cookies.set(ANONYMOUS_COOKIE_NAME, guest.value);
      const headers = new Headers(request.headers);
      headers.set("cookie", request.cookies.toString());
      const response = NextResponse.next({ request: { headers } });
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
      response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      if (guest.fresh) {
        response.cookies.set(ANONYMOUS_COOKIE_NAME, guest.value, {
          httpOnly: true,
          secure: request.nextUrl.protocol === "https:" || process.env.APP_URL?.startsWith("https://") === true,
          sameSite: "lax",
          path: "/",
          expires: new Date(guest.session.expiresAt),
        });
      }
      return response;
    } catch (error) {
      return apiError(error);
    }
  }

  // Private installations retain the existing site-wide password.
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
