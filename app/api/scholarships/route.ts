import { apiError } from "@/lib/http";
import { getCollectionStatus, getNotices, getScholarshipPreferences } from "@/lib/scholarships";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return Response.json(
      { notices: await getNotices(), status: await getCollectionStatus(), preferences: await getScholarshipPreferences() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
