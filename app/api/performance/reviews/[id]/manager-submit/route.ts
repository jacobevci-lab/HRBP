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
  if (!can(ctx, "performance:manager-review")) return forbidden();
  if (!ctx.employmentId) return forbidden("An employment-bound identity is required for manager review.");

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const managerRating = rating(body.managerRating);
  if (!managerRating) return Response.json({ error: "A valid manager rating is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const review = await tx.performanceReview.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          managerEmploymentId: true,
          status: true,
          selfRating: true,
          cycle: { select: { status: true } }
        }
      });
      if (!review) throw new Error("NOT_FOUND");
      if (review.managerEmploymentId !== ctx.employmentId) throw new Error("NOT_ASSIGNED_MANAGER");
      if (review.cycle.status !== ReviewCycleStatus.OPEN) throw new Error("CYCLE_LOCKED");
      if (review.status !== ReviewStatus.MANAGER_REVIEW) throw new Error("INVALID_STATE");
      if (!review.selfRating) throw new Error("SELF_RATING_REQUIRED");

      const updated = await tx.performanceReview.update({
        where: { id },
        data: { managerRating, status: ReviewStatus.CALIBRATION }
      });
      await appendAudit(tx, ctx, {
        action: "performance-review.manager-submitted",
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
    if (code === "NOT_ASSIGNED_MANAGER") return forbidden("Manager review can only be submitted by the assigned manager employment.");
    if (code === "CYCLE_LOCKED") return Response.json({ error: "The review cycle is no longer open for manager submission." }, { status: 409 });
    if (code === "INVALID_STATE") return Response.json({ error: "This review is not awaiting manager review." }, { status: 409 });
    if (code === "SELF_RATING_REQUIRED") return Response.json({ error: "The employee self rating is required before manager review." }, { status: 409 });
    throw error;
  }
}
