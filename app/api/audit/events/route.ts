import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "audit:read")) return forbidden();
  const url = new URL(request.url);
  const resourceType = url.searchParams.get("resourceType");
  const actorId = url.searchParams.get("actorId");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
  const data = await db.auditEvent.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(resourceType ? { resourceType } : {}),
      ...(actorId ? { actorId } : {})
    },
    orderBy: { ledgerSequence: "desc" },
    take: limit,
    // Keep the existing JSON contract free of BigInt fields.
    select: {
      id: true,
      tenantId: true,
      actorId: true,
      action: true,
      resourceType: true,
      resourceId: true,
      purpose: true,
      classification: true,
      ipAddress: true,
      occurredAt: true,
      hash: true,
      previousHash: true
    }
  });
  return Response.json({ data, integrity: { chainedHashes: true, payloadExcluded: true } });
}
