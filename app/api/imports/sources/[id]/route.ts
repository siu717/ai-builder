import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { deleteSource, getImportState, updateSource } from "@/lib/import-store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await updateSource((await context.params).id, await readJson(request));
    return Response.json({ imports: await getImportState() });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await deleteSource((await context.params).id);
    return Response.json({ imports: await getImportState() });
  } catch (error) { return apiError(error); }
}
