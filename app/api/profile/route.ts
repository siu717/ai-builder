import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { markBuiltinSourcesStale } from "@/lib/import-store";
import { getProfile, saveProfile } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json(await getProfile()); } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const state = await saveProfile(await readJson(request));
    // 맞춤 검색어가 바뀌었으니 기본 수집원을 다음 주기에 바로 다시 가져온다.
    await markBuiltinSourcesStale();
    return Response.json(state);
  } catch (error) { return apiError(error); }
}
