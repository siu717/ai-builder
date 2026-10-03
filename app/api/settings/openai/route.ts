import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { deleteOpenAIApiKey, saveOpenAIApiKey } from "@/lib/store";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await saveOpenAIApiKey(await readJson(request)));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await deleteOpenAIApiKey());
  } catch (error) {
    return apiError(error);
  }
}
