import assert from "node:assert/strict";
import test from "node:test";
import { reminderToISO, seoulInput } from "../components/ui";

test("unchanged reminder drafts retain stored milliseconds", () => {
  const originalAt = "2026-10-03T04:16:30.856Z";
  assert.equal(reminderToISO({ at: seoulInput(originalAt), originalAt }), originalAt);
});

test("edited reminder time replaces the original timestamp", () => {
  assert.equal(reminderToISO({ at: "2026-10-03T13:17:30", originalAt: "2026-10-03T04:16:30.856Z" }), "2026-10-03T04:17:30.000Z");
});

test("one-minute preset retains exactly sixty seconds including milliseconds", () => {
  const now = new Date("2026-10-03T04:16:30.856Z").getTime();
  const originalAt = new Date(now + 60_000).toISOString();
  const saved = reminderToISO({ at: seoulInput(originalAt), originalAt });
  assert.equal(new Date(saved).getTime() - now, 60_000);
});
