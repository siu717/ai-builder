import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DELETE, PUT } from "../app/api/settings/data-keys/route";
import { createDatabase } from "../lib/db";
import { deleteDataApiKey, getDataApiKey, getState, saveDataApiKey } from "../lib/store";

const decodedKey = "abc+def/ghi==sensitive-data-go-kr";
const saraminKey = "saramin-sensitive-access-key-001";

function withEnvironment(t: TestContext, name: string, value: string | undefined) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "campus-data-keys-"));
  const path = join(directory, "campus.db");
  const db = await createDatabase(`file:${path}`);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined); });
  return { db, path };
}

test("data API keys are stored per provider and never appear in public state", async (t) => {
  withEnvironment(t, "DATA_GO_KR_API_KEY", undefined);
  withEnvironment(t, "SARAMIN_API_KEY", undefined);
  const { db, path } = await fixture(t);
  assert.deepEqual((await getState(db)).settings.dataKeys, { dataGoKr: null, saramin: null });
  await saveDataApiKey({ provider: "dataGoKr", apiKey: ` ${decodedKey} ` }, db);
  const state = await saveDataApiKey({ provider: "saramin", apiKey: saraminKey }, db);
  assert.deepEqual(state.settings.dataKeys, { dataGoKr: "saved", saramin: "saved" });
  assert.ok(!JSON.stringify(state).includes("sensitive"));
  const reopened = await createDatabase(`file:${path}`);
  t.after(() => reopened.close());
  assert.equal(await getDataApiKey("dataGoKr", reopened), decodedKey);
  assert.equal(await getDataApiKey("saramin", reopened), saraminKey);
});

test("encoded data.go.kr keys are stored decoded, and deleting restores the environment fallback", async (t) => {
  withEnvironment(t, "DATA_GO_KR_API_KEY", " env-data-key \n");
  const { db } = await fixture(t);
  assert.equal((await getState(db)).settings.dataKeys.dataGoKr, "environment");
  await saveDataApiKey({ provider: "dataGoKr", apiKey: encodeURIComponent(decodedKey) }, db);
  assert.equal(await getDataApiKey("dataGoKr", db), decodedKey);
  const cleared = await deleteDataApiKey({ provider: "dataGoKr" }, db);
  assert.equal(cleared.settings.dataKeys.dataGoKr, "environment");
  assert.equal(await getDataApiKey("dataGoKr", db), "env-data-key");
});

test("invalid data key input is rejected without changing the saved key", async (t) => {
  const { db } = await fixture(t);
  await saveDataApiKey({ provider: "saramin", apiKey: saraminKey }, db);
  const invalid: unknown[] = [
    { provider: "saramin", apiKey: "" }, { provider: "saramin", apiKey: "has space" },
    { provider: "unknown", apiKey: "x" }, { apiKey: "x" }, { provider: "saramin", apiKey: "x", extra: 1 },
  ];
  for (const input of invalid) await assert.rejects(saveDataApiKey(input, db));
  await assert.rejects(saveDataApiKey({ provider: "dataGoKr", apiKey: "bad%E0%A4%A" }, db));
  await assert.rejects(deleteDataApiKey({ provider: "nope" }, db));
  assert.equal(await getDataApiKey("saramin", db), saraminKey);
});

test("the data key route rejects cross-origin requests", async () => {
  const init = (method: string) => ({ method, headers: { "content-type": "application/json", origin: "https://evil.example", host: "127.0.0.1:3000" }, body: JSON.stringify({ provider: "saramin", apiKey: "x" }) });
  assert.equal((await PUT(new Request("http://127.0.0.1:3000/api/settings/data-keys", init("PUT")))).status, 403);
  assert.equal((await DELETE(new Request("http://127.0.0.1:3000/api/settings/data-keys", init("DELETE")))).status, 403);
});
