export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
