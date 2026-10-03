import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { AppState } from "../lib/contracts";

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL || new URL(baseURL).port !== "3200",
    "API key checks use the isolated preview on port 3200.",
  );
});

async function readState(request: APIRequestContext): Promise<AppState> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("AI keys can be saved, replaced and removed without appearing in public state", async ({
  page,
  request,
}, testInfo) => {
  const reset = await request.delete("/api/settings/ai");
  expect(reset.ok()).toBeTruthy();
  const baseline: AppState = await reset.json();
  const firstKey = `sk-ant-api03-e2e-placeholder-${randomUUID()}`;
  const replacementKey = `sk-ant-api03-e2e-replacement-${randomUUID()}`;
  try {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("button", { name: "설정", exact: true })
      .click();
    const section = page.getByRole("region", { name: "AI 분석 설정" });
    const input = section.getByLabel("AI API 키 (Anthropic · OpenAI)", { exact: true });
    const save = section.getByRole("button", {
      name: "API 키 저장",
      exact: true,
    });
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveAttribute("autocomplete", "new-password");
    await expect(input).toHaveValue("");
    await expect(save).toBeDisabled();

    await input.fill(firstKey);
    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/settings/ai") &&
        response.request().method() === "PUT",
    );
    await save.click();
    const response = await saving;
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).not.toContain(firstKey);
    const state: AppState = JSON.parse(body);
    expect(state.settings.aiConfigured).toBe(true);
    expect(state.settings.aiKeySource).toBe("saved");
    expect(state.settings).not.toHaveProperty("apiKey");
    expect(state.settings).not.toHaveProperty("anthropicApiKey");
    await expect(input).toHaveValue("");
    await expect(section.getByText("설정됨", { exact: true })).toBeVisible();
    await section.screenshot({ path: testInfo.outputPath("ai-settings.png") });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => JSON.stringify(Object.values(localStorage))),
    ).not.toContain(firstKey);
    expect(JSON.stringify(await readState(request))).not.toContain(firstKey);

    await page.reload();
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("button", { name: "설정", exact: true })
      .click();
    await expect(input).toHaveValue("");
    await expect(section.getByText("설정됨", { exact: true })).toBeVisible();
    await input.fill("   ");
    await expect(save).toBeDisabled();
    const blank = await request.put("/api/settings/ai", {
      data: { apiKey: "   " },
    });
    expect(blank.status()).toBe(400);
    expect((await readState(request)).settings.aiKeySource).toBe("saved");

    await input.fill(replacementKey);
    const replacing = page.waitForResponse(
      (result) =>
        result.url().endsWith("/api/settings/ai") &&
        result.request().method() === "PUT",
    );
    await save.click();
    const replaced = await replacing;
    expect(replaced.ok()).toBeTruthy();
    const updated = await replaced.text();
    expect(updated).not.toContain(firstKey);
    expect(updated).not.toContain(replacementKey);
    await expect(input).toHaveValue("");

    await section
      .getByRole("button", { name: "저장된 API 키 삭제", exact: true })
      .click();
    const confirmation = section.getByRole("group", {
      name: "API 키 삭제 확인",
    });
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "취소", exact: true })
      .click();
    await expect(confirmation).not.toBeVisible();
    expect((await readState(request)).settings.aiKeySource).toBe("saved");
    await section
      .getByRole("button", { name: "저장된 API 키 삭제", exact: true })
      .click();
    const deleting = page.waitForResponse(
      (result) =>
        result.url().endsWith("/api/settings/ai") &&
        result.request().method() === "DELETE",
    );
    await confirmation
      .getByRole("button", { name: "API 키 삭제", exact: true })
      .click();
    const deleted = await deleting;
    expect(deleted.ok()).toBeTruthy();
    const finalState: AppState = await deleted.json();
    expect(finalState.settings.aiKeySource).toBe(baseline.settings.aiKeySource);
    expect(finalState.settings.aiConfigured).toBe(
      baseline.settings.aiConfigured,
    );
    await expect(
      section.getByText(
        baseline.settings.aiKeySource === "environment"
          ? "환경변수 사용"
          : "키 미설정",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: "저장된 API 키 삭제", exact: true }),
    ).not.toBeVisible();
    await expect(input).toHaveValue("");
  } finally {
    await request.delete("/api/settings/ai");
  }
});

test("cross-origin AI key changes are rejected", async ({ request }) => {
  const before = await readState(request);
  const hostileKey = `sk-ant-api03-e2e-hostile-${randomUUID()}`;
  const save = await request.put("/api/settings/ai", {
    headers: { Origin: "https://unrelated.example" },
    data: { apiKey: hostileKey },
  });
  expect(save.status()).toBe(403);
  expect(await save.text()).not.toContain(hostileKey);
  const remove = await request.delete("/api/settings/ai", {
    headers: { Origin: "https://unrelated.example" },
  });
  expect(remove.status()).toBe(403);
  const after = await readState(request);
  expect(after.settings.aiConfigured).toBe(before.settings.aiConfigured);
  expect(after.settings.aiKeySource).toBe(before.settings.aiKeySource);
});

test("an API key save failure preserves the draft and shows the error", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name: "설정", exact: true })
    .click();
  const section = page.getByRole("region", { name: "AI 분석 설정" });
  const input = section.getByLabel("AI API 키 (Anthropic · OpenAI)", { exact: true });
  const fakeKey = `sk-ant-api03-e2e-retry-${randomUUID()}`;
  await page.route("**/api/settings/ai", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "저장 서버 연결을 확인해 주세요." }),
    }),
  );
  await input.fill(fakeKey);
  await section
    .getByRole("button", { name: "API 키 저장", exact: true })
    .click();
  await expect(section.getByRole("alert")).toHaveText(
    "저장 서버 연결을 확인해 주세요.",
  );
  await expect(input).toHaveValue(fakeKey);
  await expect(
    section.getByRole("button", { name: "API 키 저장", exact: true }),
  ).toBeEnabled();
  await input.fill("");
  await page.unroute("**/api/settings/ai");
});
