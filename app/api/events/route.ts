import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { createEvent } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await createEvent(await readJson(request)), { status: 201 });
  } catch (error) { return apiError(error); }
}
