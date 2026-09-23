import { DataClassification } from "@prisma/client";
import { materializeBuiltInAnalyticsForContext } from "@/lib/analytics-builtins";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "analytics:read")) return forbidden();

  const result = await db.$transaction(async (tx) => {
    const materialized = await materializeBuiltInAnalyticsForContext(tx, ctx);
    await appendAudit(tx, ctx, {
      action: "ANALYTICS_METRICS_MATERIALIZED",
      resourceType: "MetricSnapshotBatch",
      resourceId: `${ctx.actorId}:${materialized.generatedAt.toISOString()}`,
      classification: DataClassification.CONFIDENTIAL,
      purpose: materialized.relationshipScoped
        ? "Refresh governed analytics for the caller's relationship-scoped workforce population"
        : "Refresh governed analytics for the tenant-wide workforce population"
    });
    return materialized;
  });

  return Response.json({ data: result }, { status: 201 });
}
