import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { getPublicSettings, saveSettings } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try { return Response.json(await getPublicSettings()); } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveSettings(await readJson(request)));
  } catch (error) { return apiError(error); }
}
