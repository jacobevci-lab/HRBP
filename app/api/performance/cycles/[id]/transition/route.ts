import { DataClassification, ReviewCycleStatus, ReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<ReviewCycleStatus, ReviewCycleStatus[]> = {
  DRAFT: [ReviewCycleStatus.OPEN],
  OPEN: [ReviewCycleStatus.CALIBRATION],
  CALIBRATION: [ReviewCycleStatus.FINALIZED],
  FINALIZED: [ReviewCycleStatus.CLOSED],
  CLOSED: []
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as { status?: string };
  const next = String(body.status ?? "") as ReviewCycleStatus;
  if (!Object.values(ReviewCycleStatus).includes(next)) return Response.json({ error: "A valid cycle status is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const cycle = await tx.reviewCycle.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, status: true, startsAt: true, endsAt: true }
      });
      if (!cycle) throw new Error("NOT_FOUND");
      if (!(transitions[cycle.status] ?? []).includes(next)) throw new Error("INVALID_TRANSITION");

      if (next === ReviewCycleStatus.OPEN && cycle.endsAt <= cycle.startsAt) throw new Error("INVALID_DATES");
      if (next === ReviewCycleStatus.CALIBRATION) {
        const pendingParticipants = await tx.performanceReview.count({
          where: {
            tenantId: ctx.tenantId,
            cycleId: id,
            status: { in: [ReviewStatus.NOT_STARTED, ReviewStatus.SELF_REVIEW, ReviewStatus.MANAGER_REVIEW] }
          }
        });
        if (pendingParticipants > 0) throw new Error(`PENDING_PARTICIPANTS:${pendingParticipants}`);
      }
      if (next === ReviewCycleStatus.FINALIZED) {
        const unfinished = await tx.performanceReview.count({
          where: { tenantId: ctx.tenantId, cycleId: id, status: { not: ReviewStatus.FINALIZED } }
        });
        if (unfinished > 0) throw new Error(`UNFINISHED:${unfinished}`);
      }

      const updated = await tx.reviewCycle.update({
        where: { id },
        data: { status: next, finalizedAt: next === ReviewCycleStatus.FINALIZED ? new Date() : undefined }
      });
      await appendAudit(tx, ctx, {
        action: `review-cycle.transition.${cycle.status.toLowerCase()}.${next.toLowerCase()}`,
        resourceType: "ReviewCycle",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Review cycle not found in tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "Cycle transition is not allowed from the current state." }, { status: 409 });
    if (code === "INVALID_DATES") return Response.json({ error: "Cycle end date must be after its start date." }, { status: 400 });
    if (code.startsWith("PENDING_PARTICIPANTS:")) return Response.json({ error: `${code.split(":")[1]} reviews are still awaiting employee or manager action before calibration can begin.` }, { status: 409 });
    if (code.startsWith("UNFINISHED:")) return Response.json({ error: `${code.split(":")[1]} reviews must be finalized before the cycle can be finalized.` }, { status: 409 });
    throw error;
  }
}
