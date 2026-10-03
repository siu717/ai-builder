import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { markNotificationsRead } from "@/lib/store";

export const runtime = "nodejs";
const schema = z.object({ ids: z.array(z.string().uuid()).max(1000).optional() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await readJson(request));
    return Response.json(await markNotificationsRead(input.ids));
  } catch (error) { return apiError(error); }
}
