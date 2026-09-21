import { DataClassification, PolicyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:write")) return forbidden();
  const { id } = await params;
  const data = await db.$transaction(async (tx) => {
    const current = await tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    const publishable = current.status === PolicyStatus.DRAFT || current.status === PolicyStatus.REVIEW || current.status === PolicyStatus.APPROVED;
    if (!publishable) throw new Error("STATE");
    const now = new Date();
    const record = await tx.policyRecord.update({ where: { id }, data: { status: PolicyStatus.PUBLISHED, approvedById: current.approvedById ?? ctx.actorId, approvedAt: current.approvedAt ?? now, publishedAt: now } });
    await appendAudit(tx, ctx, { action: "policy.published", resourceType: "PolicyRecord", resourceId: id, classification: DataClassification.INTERNAL });
    return record;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "STATE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "NOT_FOUND") return Response.json({ error: "Policy not found." }, { status: 404 });
  if (data === "STATE") return Response.json({ error: "Policy cannot be published from its current state." }, { status: 409 });
  return Response.json({ data });
}
