import { ZodError } from "zod";

export class RouteError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "RouteError";
  }
}

// Deployed address. Behind a TLS proxy Request.url is plain http, so compare against this origin instead.
function deployedOrigin(): URL | null {
  if (!process.env.APP_URL) return null;
  try {
    const parsed = new URL(process.env.APP_URL);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const url = new URL(request.url);
  const receivedHost = request.headers.get("host") || url.host;
  const deployed = deployedOrigin();
  if (deployed && receivedHost.toLowerCase() === deployed.host) {
    if ((origin && origin !== deployed.origin) || (site && !["same-origin", "none"].includes(site))) {
      throw new RouteError(403, "같은 앱에서 보낸 요청만 허용됩니다.");
    }
    return;
  }
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(receivedHost) || !["http:", "https:"].includes(url.protocol)) {
    throw new RouteError(403, "같은 앱에서 보낸 요청만 허용됩니다.");
  }
  let receivedOrigin: URL;
  try {
    // Next may use its internal hostname in Request.url; Host is the browser's address.
    receivedOrigin = new URL(`${url.protocol}//${receivedHost}`);
  } catch {
    throw new RouteError(403, "같은 앱에서 보낸 요청만 허용됩니다.");
  }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(receivedOrigin.hostname);
  const validHost = localHost && !receivedOrigin.username && !receivedOrigin.password && receivedOrigin.pathname === "/" && !receivedOrigin.search && !receivedOrigin.hash;
  if (!validHost || (origin && origin !== receivedOrigin.origin) || (site && !["same-origin", "none"].includes(site))) {
    throw new RouteError(403, "같은 앱에서 보낸 요청만 허용됩니다.");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new RouteError(415, "JSON 형식으로 요청해주세요.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 1_000_000) {
    throw new RouteError(413, "입력 내용이 너무 깁니다.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RouteError(400, "요청 형식이 올바르지 않습니다.");
  }
}

export function apiError(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues[0]?.message || "입력값을 확인해주세요." }, { status: 400 });
  }
  if (error instanceof Error && "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 600) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
}
