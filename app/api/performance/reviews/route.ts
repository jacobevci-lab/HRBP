import { DataClassification, ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "performance:read")) return forbidden();
  const scope = await resolveEmploymentScope(db, ctx);
  const data = await db.performanceReview.findMany({ where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) }, orderBy: { updatedAt: "desc" }, include: { cycle: { select: { id: true, name: true, status: true } } }, take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:write")) return forbidden();
  const body = await request.json() as { cycleId?: string; employmentId?: string; managerEmploymentId?: string };
  if (!body.cycleId || !body.employmentId) return Response.json({ error: "cycleId and employmentId are required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, body.employmentId!)) throw new Error("OUT_OF_SCOPE");
      const [cycle, employment, manager] = await Promise.all([
        tx.reviewCycle.findFirst({ where: { id: body.cycleId, tenantId: ctx.tenantId }, select: { id: true, status: true } }),
        tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        body.managerEmploymentId ? tx.employment.findFirst({ where: { id: body.managerEmploymentId, tenantId: ctx.tenantId }, select: { id: true } }) : Promise.resolve({ id: "" })
      ]);
      if (!cycle || !employment || (body.managerEmploymentId && !manager)) throw new Error("NOT_FOUND");
      if (![ReviewCycleStatus.DRAFT, ReviewCycleStatus.OPEN].includes(cycle.status)) throw new Error("CYCLE_LOCKED");
      const review = await tx.performanceReview.create({ data: { tenantId: ctx.tenantId, cycleId: body.cycleId!, employmentId: body.employmentId!, managerEmploymentId: body.managerEmploymentId || undefined, status: ReviewStatus.NOT_STARTED } });
      await appendAudit(tx, ctx, { action: "performance-review.created", resourceType: "PerformanceReview", resourceId: review.id, classification: DataClassification.CONFIDENTIAL });
      return review;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Cycle or employment record not found in tenant." }, { status: 404 });
    if (code === "CYCLE_LOCKED") return Response.json({ error: "Reviews can only be added while the cycle is draft or open." }, { status: 409 });
    if (code.includes("Unique constraint")) return Response.json({ error: "A review already exists for this employee in the selected cycle." }, { status: 409 });
    throw error;
  }
}
