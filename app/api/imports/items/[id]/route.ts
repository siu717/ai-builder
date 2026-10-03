import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { addImportToCalendar, getImportState, setImportDismissed } from "@/lib/import-store";
import { getState } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const { action } = z.object({ action: z.enum(["add", "dismiss", "restore"]) }).strict().parse(await readJson(request));
    const app = action === "add" ? await addImportToCalendar(id) : (await setImportDismissed(id, action === "dismiss"), await getState());
    return Response.json({ imports: await getImportState(), app });
  } catch (error) { return apiError(error); }
}
