import { apiError } from "@/lib/http";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await getState(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
