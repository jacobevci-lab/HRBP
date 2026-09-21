import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "analytics:read")) return forbidden();
  const url = new URL(request.url);
  const metricKey = url.searchParams.get("metric");
  const data = await db.metricDefinition.findMany({
    where: { tenantId: ctx.tenantId, active: true, ...(metricKey ? { key: metricKey } : {}) },
    orderBy: { name: "asc" },
    include: { snapshots: { where: { suppressed: false }, orderBy: { periodEnd: "desc" }, take: 12 } },
    take: 100
  });
  return Response.json({ data, privacy: { suppressedBelowDefinitionThreshold: true } });
}
