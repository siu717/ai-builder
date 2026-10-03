import assert from "node:assert/strict";
import { test } from "node:test";
import { basicAuthFromEnv, isAuthorized } from "../lib/basic-auth";

const credentials = { user: "team", password: "s3cret:with-colon" };
const header = (value: string) => `Basic ${Buffer.from(value, "utf8").toString("base64")}`;

test("basic auth is off unless both user and password are set", () => {
  assert.equal(basicAuthFromEnv({}), null);
  assert.equal(basicAuthFromEnv({ BASIC_AUTH_USER: "team" }), null);
  assert.equal(basicAuthFromEnv({ BASIC_AUTH_PASSWORD: "x" }), null);
  assert.equal(basicAuthFromEnv({ BASIC_AUTH_USER: "  ", BASIC_AUTH_PASSWORD: "x" }), null);
  assert.deepEqual(basicAuthFromEnv({ BASIC_AUTH_USER: " team ", BASIC_AUTH_PASSWORD: "x" }), { user: "team", password: "x" });
});

test("basic auth accepts only the exact user and password", () => {
  assert.equal(isAuthorized(header("team:s3cret:with-colon"), credentials), true);
  assert.equal(isAuthorized(header("team:wrong"), credentials), false);
  assert.equal(isAuthorized(header("other:s3cret:with-colon"), credentials), false);
  assert.equal(isAuthorized(header("team:s3cret:with-colo"), credentials), false);
  assert.equal(isAuthorized(header("team"), credentials), false);
  assert.equal(isAuthorized(null, credentials), false);
  assert.equal(isAuthorized("Bearer abc", credentials), false);
  assert.equal(isAuthorized("Basic not base64!", credentials), false);
});
