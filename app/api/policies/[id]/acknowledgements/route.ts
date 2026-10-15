import { DataClassification, EmploymentStatus, PolicyAssignmentStatus, PolicyStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:acknowledge")) return forbidden();
  if (!ctx.employmentId) return forbidden("Trusted employment context is required for acknowledgement.");

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid policy id is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    // Shared parent locks allow different employees to acknowledge concurrently,
    // but serialize against termination, retirement and policy-version changes.
    // The assignment lock also coordinates with ordinary UPDATE/DELETE writers.
    await tx.$queryRaw`/* policy-ack:employment */ SELECT "id" FROM "Employment"
      WHERE "id" = ${ctx.employmentId} AND "tenantId" = ${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`/* policy-ack:policy */ SELECT "id" FROM "PolicyRecord"
      WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR SHARE`;
    await tx.$queryRaw`/* policy-ack:assignment */ SELECT "id" FROM "PolicyAssignment"
      WHERE "policyId" = ${id} AND "employmentId" = ${ctx.employmentId}
        AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;

    // Read after acquiring the locks. A pre-lock snapshot could authorize a
    // stale screen after a competing waiver/termination/retirement committed.
    const now = new Date();
    const [policy, employment, assignment] = await Promise.all([
      tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED,
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }, select: { id: true, version: true } }),
      tx.employment.findFirst({ where: { id: ctx.employmentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } }, select: { id: true } }),
      tx.policyAssignment.findFirst({ where: { tenantId: ctx.tenantId, policyId: id, employmentId: ctx.employmentId }, select: { id: true, status: true } })
    ]);
    if (!policy || !employment || !assignment) throw new Error("NOT_FOUND");
    if (assignment.status === PolicyAssignmentStatus.WAIVED) throw new Error("STATE");

    const existing = await tx.policyAcknowledgement.findFirst({
      where: { tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id, policyVersion: policy.version }
    });
    if (existing) {
      // Evidence is immutable on replay: do not replace its original time,
      // actor or IP and do not append another acknowledgement audit event.
      if (assignment.status !== PolicyAssignmentStatus.ACKNOWLEDGED) throw new Error("STATE");
      return { data: existing, replayed: true };
    }
    if (assignment.status !== PolicyAssignmentStatus.PENDING && assignment.status !== PolicyAssignmentStatus.OVERDUE) throw new Error("STATE");

    await tx.policyAssignment.update({
      where: { id: assignment.id, tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id, status: assignment.status },
      data: { status: PolicyAssignmentStatus.ACKNOWLEDGED }
    });
    const acknowledgement = await tx.policyAcknowledgement.create({
      data: { tenantId: ctx.tenantId, policyId: policy.id, employmentId: employment.id, policyVersion: policy.version,
        acknowledgedBy: ctx.actorId, acknowledgedAt: now, ipAddress: ctx.ipAddress }
    });
    await appendAudit(tx, ctx, { action: "policy.acknowledged", resourceType: "PolicyAcknowledgement", resourceId: acknowledgement.id, classification: DataClassification.CONFIDENTIAL });
    return { data: acknowledgement, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }).catch((error) => {
    if (error instanceof Error && ["NOT_FOUND", "STATE"].includes(error.message)) return error.message;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code)) return "STATE";
    console.error("[HRBP] Policy acknowledgement could not be completed.");
    return "UNAVAILABLE";
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Effective published policy assignment not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "Policy assignment state changed or its receipt is inconsistent. Refresh before continuing." }, { status: 409 });
  if (typeof result === "string") return Response.json({ error: "Policy acknowledgement is unavailable. Reload the current record before retrying." }, { status: 503 });
  // Retain the existing 201 receipt contract for clients already in a browser.
  // meta.replayed distinguishes a returned original receipt from a new write.
  return Response.json({ data: result.data, meta: { replayed: result.replayed } }, { status: 201 });
}
