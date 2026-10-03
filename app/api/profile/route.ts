import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { getProfile, saveProfile } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json(await getProfile()); } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveProfile(await readJson(request)));
  } catch (error) { return apiError(error); }
}
