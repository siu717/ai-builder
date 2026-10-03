import { getCatalog } from "@/lib/catalog";
import { apiError } from "@/lib/http";
import { getProfile } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ opportunities: getCatalog(await getProfile()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
