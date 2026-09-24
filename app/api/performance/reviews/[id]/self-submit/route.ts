import { DataClassification, PerformanceBand, ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function rating(value: unknown): PerformanceBand | null {
  const candidate = String(value ?? "") as PerformanceBand;
  return Object.values(PerformanceBand).includes(candidate) ? candidate : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:self-submit")) return forbidden();
  if (!ctx.employmentId) return forbidden("An employment-bound identity is required for self review.");

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const selfRating = rating(body.selfRating);
  if (!selfRating) return Response.json({ error: "A valid self rating is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const review = await tx.performanceReview.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          managerEmploymentId: true,
          status: true,
          cycle: { select: { status: true } }
        }
      });
      if (!review) throw new Error("NOT_FOUND");
      if (review.employmentId !== ctx.employmentId) throw new Error("NOT_SELF");
      if (review.cycle.status !== ReviewCycleStatus.OPEN) throw new Error("CYCLE_LOCKED");
      if (review.status !== ReviewStatus.NOT_STARTED && review.status !== ReviewStatus.SELF_REVIEW) throw new Error("INVALID_STATE");

      const employment = await tx.employment.findFirst({
        where: { id: ctx.employmentId, tenantId: ctx.tenantId },
        select: { managerEmploymentId: true }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
      const managerEmploymentId = review.managerEmploymentId ?? employment.managerEmploymentId;
      if (!managerEmploymentId) throw new Error("MANAGER_REQUIRED");

      const result = await tx.performanceReview.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          employmentId: ctx.employmentId,
          status: { in: [ReviewStatus.NOT_STARTED, ReviewStatus.SELF_REVIEW] }
        },
        data: {
          selfRating,
          managerEmploymentId,
          status: ReviewStatus.MANAGER_REVIEW
        }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.performanceReview.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: "performance-review.self-submitted",
        resourceType: "PerformanceReview",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Performance review not found in tenant." }, { status: 404 });
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Employment identity is no longer active in this tenant." }, { status: 404 });
    if (code === "NOT_SELF") return forbidden("Self review can only be submitted for your own employment record.");
    if (code === "CYCLE_LOCKED") return Response.json({ error: "The review cycle is no longer open for self submission." }, { status: 409 });
    if (code === "INVALID_STATE" || code === "STALE_STATE") return Response.json({ error: "This review is no longer awaiting self review." }, { status: 409 });
    if (code === "MANAGER_REQUIRED") return Response.json({ error: "An assigned manager is required before the self review can be submitted." }, { status: 409 });
    throw error;
  }
}
