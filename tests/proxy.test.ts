import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { ANONYMOUS_COOKIE_NAME } from "../lib/anonymous-session";

test("private deployment still challenges unauthenticated requests", async (t) => {
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  process.env.PUBLIC_ACCESS_MODE = "private";
  process.env.BASIC_AUTH_USER = "team";
  process.env.BASIC_AUTH_PASSWORD = "test-password";
  const denied = await proxy(new NextRequest("http://localhost:3300/"));
  assert.equal(denied.status, 401);
  assert.ok(denied.headers.has("www-authenticate"));
  const allowed = await proxy(new NextRequest("http://localhost:3300/", {
    headers: { authorization: `Basic ${Buffer.from("team:test-password").toString("base64")}` },
  }));
  assert.equal(allowed.status, 200);
});

test("anonymous proxy issues isolated cookies without a Basic Auth challenge", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "campus-proxy-"));
  const previous = { ...process.env };
  t.after(async () => { process.env = previous; await rm(directory, { recursive: true, force: true }); });
  process.env.PUBLIC_ACCESS_MODE = "anonymous";
  process.env.PUBLIC_SESSION_DIR = directory;
  process.env.APP_URL = "https://campus.example";
  process.env.BASIC_AUTH_USER = "team";
  process.env.BASIC_AUTH_PASSWORD = "private-password";
  const first = await proxy(new NextRequest("http://localhost:3300/"));
  assert.equal(first.status, 200);
  assert.equal(first.headers.has("www-authenticate"), false);
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  const firstCookie = first.headers.get("set-cookie")!;
  assert.match(firstCookie, /HttpOnly/i);
  assert.match(firstCookie, /SameSite=lax/i);
  assert.match(firstCookie, /Secure/i);
  const cookie = firstCookie.split(";")[0];
  assert.match(cookie, new RegExp(`^${ANONYMOUS_COOKIE_NAME}=`));
  assert.equal(first.headers.get("x-middleware-request-cookie"), cookie);
  const sameVisitor = await proxy(new NextRequest("http://localhost:3300/api/state", { headers: { cookie } }));
  assert.equal(sameVisitor.status, 200);
  assert.equal(sameVisitor.headers.has("set-cookie"), false);
  assert.equal(sameVisitor.headers.get("x-middleware-request-cookie"), cookie);
  const second = await proxy(new NextRequest("http://localhost:3300/"));
  assert.notEqual(second.headers.get("set-cookie"), firstCookie);
  const invalid = await proxy(new NextRequest("http://localhost:3300/", {
    headers: { cookie: `${ANONYMOUS_COOKIE_NAME}=../../private.db` },
  }));
  assert.equal(invalid.status, 200);
  assert.ok(invalid.headers.has("set-cookie"));
  const hostile = await proxy(new NextRequest("https://campus.example/api/settings/ai", {
    method: "DELETE",
    headers: { host: "campus.example", origin: "https://foreign.example", cookie },
  }));
  assert.equal(hostile.status, 403);
  assert.equal(hostile.headers.has("set-cookie"), false);
  const health = await proxy(new NextRequest("http://localhost:3300/api/health"));
  assert.equal(health.status, 200);
  assert.equal(health.headers.has("set-cookie"), false);
});
