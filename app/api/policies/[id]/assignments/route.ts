import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { DataClassification, EmploymentStatus, PolicyAssignmentStatus, PolicyStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const MAX_ASSIGNMENTS = 500;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid policy id is required." }, { status: 400 });
  const body = await readJsonObject(request) as { employmentIds?: unknown; dueAt?: unknown };
  if (!body) return Response.json({ error: "A bounded JSON object body is required." }, { status: 400 });
  const rawIds = Array.isArray(body.employmentIds) ? body.employmentIds : [];
  if (rawIds.length > MAX_ASSIGNMENTS) return Response.json({ error: `At most ${MAX_ASSIGNMENTS} employment records may be assigned at once.` }, { status: 400 });
  const ids = [...new Set(rawIds
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => asIdentifier(value, 128) !== null))].sort();

  if (!ids.length) return Response.json({ error: "employmentIds are required." }, { status: 400 });
  if (ids.length > MAX_ASSIGNMENTS) return Response.json({ error: `At most ${MAX_ASSIGNMENTS} employment records may be assigned at once.` }, { status: 400 });
  if (ids.length !== rawIds.length) return Response.json({ error: "employmentIds contain invalid or duplicate values." }, { status: 400 });

  if (body.dueAt !== undefined && body.dueAt !== null && typeof body.dueAt !== "string") {
    return Response.json({ error: "dueAt must be a date string or null." }, { status: 400 });
  }
  const dueAt = typeof body.dueAt === "string" && body.dueAt.trim() ? new Date(body.dueAt) : undefined;
  if (dueAt && Number.isNaN(dueAt.getTime())) return Response.json({ error: "dueAt must be a valid date value." }, { status: 400 });
  if (dueAt && dueAt <= new Date()) return Response.json({ error: "dueAt must be in the future." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const initialScope = await resolveEmploymentScope(tx, ctx);
    if (ids.some((employmentId) => !canActOnEmployment(initialScope, employmentId))) throw new Error("OUT_OF_SCOPE");
    // Same parent order as acknowledgement: employment(s), then policy.
    // Stable ID order also keeps overlapping assignment batches consistent.
    await tx.$queryRaw`/* policy-assign:employment */ SELECT "id" FROM "Employment"
      WHERE "tenantId" = ${ctx.tenantId} AND "id" IN (${Prisma.join(ids)})
      ORDER BY "id" FOR SHARE`;
    await tx.$queryRaw`/* policy-assign:policy */ SELECT "id" FROM "PolicyRecord"
      WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR SHARE`;
    // Read after lock acquisition, not from a snapshot preceding a waited writer.
    if (dueAt && dueAt <= new Date()) throw new Error("DUE_AT");
    const policy = await tx.policyRecord.findFirst({
      where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED },
      select: { id: true }
    });
    if (!policy) throw new Error("NOT_FOUND");

    const scope = await resolveEmploymentScope(tx, ctx);
    if (ids.some((employmentId) => !canActOnEmployment(scope, employmentId))) throw new Error("OUT_OF_SCOPE");

    const valid = await tx.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ids }, status: { not: EmploymentStatus.TERMINATED } },
      select: { id: true }
    });
    if (valid.length !== ids.length) throw new Error("EMPLOYMENT");

    const created = await tx.policyAssignment.createMany({
      data: ids.map((employmentId) => ({
        tenantId: ctx.tenantId,
        policyId: id,
        employmentId,
        dueAt,
        status: PolicyAssignmentStatus.PENDING
      })),
      skipDuplicates: true
    });

    // A replay neither resets existing assignment state/due date nor creates a
    // second creation audit. Count actual inserts, not requested candidates.
    if (created.count > 0) await appendAudit(tx, ctx, {
      action: "policy.assignments-created",
      resourceType: "PolicyRecord",
      resourceId: id,
      classification: DataClassification.INTERNAL,
      purpose: `Assigned policy to ${created.count} new employment records`
    });
    return { assigned: created.count, requested: ids.length, skippedExisting: ids.length - created.count };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }).catch((error) => {
    if (error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE", "EMPLOYMENT", "DUE_AT"].includes(error.message)) return error.message;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025", "P2034"].includes(error.code)) return "CONFLICT";
    console.error("[HRBP] Policy assignment could not be completed.");
    return "UNAVAILABLE";
  });

  if (data === "NOT_FOUND") return Response.json({ error: "Published policy not found." }, { status: 404 });
  if (data === "OUT_OF_SCOPE") return forbidden("One or more employment records are outside your authorized relationship scope.");
  if (data === "EMPLOYMENT") return Response.json({ error: "One or more employment records are unavailable, terminated, or outside this tenant." }, { status: 400 });
  if (data === "DUE_AT" || data === "CONFLICT") return Response.json({ error: "Assignment prerequisites changed. Reload current records before continuing." }, { status: 409 });
  if (typeof data === "string") return Response.json({ error: "Policy assignment is unavailable. Reload current records before retrying." }, { status: 503 });
  return Response.json({ data }, { status: 201 });
}
