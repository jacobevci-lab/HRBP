import { DataClassification, ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:self-submit")) return forbidden();
  if (!ctx.employmentId) return forbidden("An employment-bound identity is required for self review.");

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid performance review id is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const review = await tx.performanceReview.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          status: true,
          cycle: { select: { status: true } }
        }
      });
      if (!review) throw new Error("NOT_FOUND");
      if (review.employmentId !== ctx.employmentId) throw new Error("NOT_SELF");
      if (review.cycle.status !== ReviewCycleStatus.OPEN) throw new Error("CYCLE_LOCKED");
      if (review.status !== ReviewStatus.NOT_STARTED) throw new Error("INVALID_STATE");

      const updated = await tx.performanceReview.updateMany({
        where: {
          id: review.id,
          tenantId: ctx.tenantId,
          employmentId: ctx.employmentId,
          status: ReviewStatus.NOT_STARTED
        },
        data: { status: ReviewStatus.SELF_REVIEW }
      });
      if (updated.count !== 1) throw new Error("STALE_STATE");

      await appendAudit(tx, ctx, {
        action: "performance-review.self-started",
        resourceType: "PerformanceReview",
        resourceId: review.id,
        classification: DataClassification.CONFIDENTIAL
      });

      return tx.performanceReview.findUnique({
        where: { id: review.id },
        select: { id: true, status: true, updatedAt: true }
      });
    });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Performance review not found in tenant." }, { status: 404 });
    if (code === "NOT_SELF") return forbidden("Self review can only be started for your own employment record.");
    if (code === "CYCLE_LOCKED") return Response.json({ error: "The review cycle is no longer open for self review." }, { status: 409 });
    if (code === "INVALID_STATE" || code === "STALE_STATE") return Response.json({ error: "This review is no longer waiting to be started." }, { status: 409 });
    throw error;
  }
}
