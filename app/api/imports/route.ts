import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { createSource, getImportState, syncSource } from "@/lib/import-store";
import { getState } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await getImportState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

/** 수집원을 등록하고 바로 한 번 가져온다. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const source = await createSource(await readJson(request));
    const result = await syncSource(source.id);
    return Response.json({ result, imports: await getImportState(), app: await getState() }, { status: 201 });
  } catch (error) { return apiError(error); }
}
