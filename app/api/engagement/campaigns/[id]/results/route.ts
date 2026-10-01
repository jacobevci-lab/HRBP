import { can, forbidden } from "@/lib/authorization";
import { getEngagementCampaignResults } from "@/lib/engagement-results";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "engagement:write")) return forbidden();

  const { id } = await params;
  try {
    const data = await getEngagementCampaignResults(ctx, id);
    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "FORBIDDEN") return forbidden();
    if (code === "NOT_FOUND") return Response.json({ error: "Campaign not found." }, { status: 404 });
    if (code === "STATE") return Response.json({ error: "Campaign results are not available before the campaign opens." }, { status: 409 });
    if (code === "TOO_LARGE") return Response.json({ error: "Survey exceeds the supported result question limit." }, { status: 409 });
    if (code === "RESULT_SET_TOO_LARGE") return Response.json({ error: "Campaign exceeds the interactive result set limit. Use governed analytics export instead." }, { status: 409 });
    console.error("Engagement result aggregation failed", error);
    return Response.json({ error: "Engagement results could not be loaded." }, { status: 500 });
  }
}
