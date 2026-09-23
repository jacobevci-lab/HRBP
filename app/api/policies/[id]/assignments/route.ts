import { DataClassification, EmploymentStatus, PolicyAssignmentStatus, PolicyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { employmentIds?: string[]; dueAt?: string };
  const ids = [...new Set((body.employmentIds ?? []).filter(Boolean))];
  if (!ids.length) return Response.json({ error: "employmentIds are required." }, { status: 400 });
  const dueAt = body.dueAt ? new Date(body.dueAt) : undefined;
  if (dueAt && Number.isNaN(dueAt.getTime())) return Response.json({ error: "dueAt must be a valid date value." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const policy = await tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED }, select: { id: true } });
    if (!policy) throw new Error("NOT_FOUND");
    const scope = await resolveEmploymentScope(tx, ctx);
    if (ids.some((employmentId) => !canActOnEmployment(scope, employmentId))) throw new Error("OUT_OF_SCOPE");
    const valid = await tx.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ids }, status: { not: EmploymentStatus.TERMINATED } },
      select: { id: true }
    });
    if (valid.length !== ids.length) throw new Error("EMPLOYMENT");
    await tx.policyAssignment.createMany({
      data: ids.map((employmentId) => ({ tenantId: ctx.tenantId, policyId: id, employmentId, dueAt, status: PolicyAssignmentStatus.PENDING })),
      skipDuplicates: true
    });
    await appendAudit(tx, ctx, { action: "policy.assignments-created", resourceType: "PolicyRecord", resourceId: id, classification: DataClassification.INTERNAL, purpose: `Assigned to ${ids.length} employment records` });
    return { assigned: ids.length };
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE", "EMPLOYMENT"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Published policy not found." }, { status: 404 });
  if (data === "OUT_OF_SCOPE") return forbidden("One or more employment records are outside your authorized relationship scope.");
  if (data === "EMPLOYMENT") return Response.json({ error: "One or more employment records are unavailable, terminated, or outside this tenant." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
