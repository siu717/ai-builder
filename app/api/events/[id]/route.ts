import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { deleteEvent, updateEvent } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(await updateEvent((await context.params).id, await readJson(request)));
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(await deleteEvent((await context.params).id));
  } catch (error) { return apiError(error); }
}
