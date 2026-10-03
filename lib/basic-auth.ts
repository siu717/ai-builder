import { createHash, timingSafeEqual } from "node:crypto";

export interface BasicAuthCredentials {
  user: string;
  password: string;
}

// Both values must be set to turn protection on, so local development stays open by default.
export function basicAuthFromEnv(env: Record<string, string | undefined> = process.env): BasicAuthCredentials | null {
  const user = env.BASIC_AUTH_USER?.trim();
  const password = env.BASIC_AUTH_PASSWORD;
  return user && password ? { user, password } : null;
}

// Hash first so the comparison is constant-time regardless of input length.
function sameSecret(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function isAuthorized(header: string | null, credentials: BasicAuthCredentials): boolean {
  const match = header?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!match) return false;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const userOk = sameSecret(decoded.slice(0, separator), credentials.user);
  const passwordOk = sameSecret(decoded.slice(separator + 1), credentials.password);
  return userOk && passwordOk;
}
