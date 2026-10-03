import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { deleteDataApiKey, saveDataApiKey } from "@/lib/store";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveDataApiKey(await readJson(request)));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await deleteDataApiKey(await readJson(request)));
  } catch (error) {
    return apiError(error);
  }
}
