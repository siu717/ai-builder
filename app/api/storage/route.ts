import { apiError, assertSameOrigin } from "@/lib/http";
import { createManualBackup, getStorageOverview } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await getStorageOverview(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await createManualBackup());
  } catch (error) {
    return apiError(error);
  }
}
