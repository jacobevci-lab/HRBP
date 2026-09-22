import { getGovernedAnalyticsMetrics } from "@/lib/analytics-privacy";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "analytics:read")) return forbidden();

  const url = new URL(request.url);
  const metricKey = url.searchParams.get("metric")?.trim() || null;
  const result = await getGovernedAnalyticsMetrics(db, ctx, metricKey);
  return Response.json(result);
}
