import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { getImportState, syncAllSources, syncSource } from "@/lib/import-store";
import { getState } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { sourceId } = z.object({ sourceId: z.string().min(1).max(100).optional() }).strict().parse(await readJson(request));
    const results = sourceId ? [await syncSource(sourceId)] : await syncAllSources();
    return Response.json({ results, imports: await getImportState(), app: await getState() });
  } catch (error) { return apiError(error); }
}
