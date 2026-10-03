import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { testTelegram } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    z.object({}).strict().parse(await readJson(request));
    return Response.json(await testTelegram());
  } catch (error) { return apiError(error); }
}
