import { DataClassification, PolicyAssignmentStatus, PolicyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:acknowledge")) return forbidden();
  if (!ctx.employmentId) return forbidden("Trusted employment context is required for acknowledgement.");
  const { id } = await params;

  const data = await db.$transaction(async (tx) => {
    const [policy, employment] = await Promise.all([
      tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED } }),
      tx.employment.findFirst({ where: { id: ctx.employmentId, tenantId: ctx.tenantId }, select: { id: true } })
    ]);
    if (!policy || !employment) throw new Error("NOT_FOUND");
    const acknowledgement = await tx.policyAcknowledgement.upsert({
      where: { policyId_employmentId_policyVersion: { policyId: policy.id, employmentId: employment.id, policyVersion: policy.version } },
      update: { acknowledgedBy: ctx.actorId, acknowledgedAt: new Date(), ipAddress: ctx.ipAddress },
      create: { tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id, policyVersion: policy.version, acknowledgedBy: ctx.actorId, ipAddress: ctx.ipAddress }
    });
    await tx.policyAssignment.updateMany({ where: { tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id }, data: { status: PolicyAssignmentStatus.ACKNOWLEDGED } });
    await appendAudit(tx, ctx, { action: "policy.acknowledged", resourceType: "PolicyAcknowledgement", resourceId: acknowledgement.id, classification: DataClassification.CONFIDENTIAL });
    return acknowledgement;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Published policy or employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
