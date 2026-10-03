import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { getNotices, saveScholarshipPreferences, syncScholarshipEvents } from "@/lib/scholarships";
import { getState } from "@/lib/store";

export const runtime = "nodejs";

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const preferences = await saveScholarshipPreferences(await readJson(request));
    // 저장 즉시 한 번 맞춰 worker 주기를 기다리지 않고 결과를 보여 준다.
    const sync = await syncScholarshipEvents(await getNotices());
    return Response.json({ preferences, sync, state: await getState() });
  } catch (error) {
    return apiError(error);
  }
}
