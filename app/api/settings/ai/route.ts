import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { deleteAnthropicApiKey, saveAnthropicApiKey } from "@/lib/store";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveAnthropicApiKey(await readJson(request)));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await deleteAnthropicApiKey());
  } catch (error) {
    return apiError(error);
  }
}
