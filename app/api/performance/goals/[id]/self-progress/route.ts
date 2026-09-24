import { DataClassification, GoalStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:goal-progress")) return forbidden();
  if (!ctx.employmentId) return forbidden("An employment-bound identity is required to update goal progress.");

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const progress = Number(body.progress);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    return Response.json({ error: "progress must be an integer from 0 to 100." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const goal = await tx.goal.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, employmentId: true, status: true }
      });
      if (!goal) throw new Error("NOT_FOUND");
      if (goal.employmentId !== ctx.employmentId) throw new Error("NOT_SELF");
      if (goal.status !== GoalStatus.ACTIVE && goal.status !== GoalStatus.AT_RISK) throw new Error("GOAL_LOCKED");

      const result = await tx.goal.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          employmentId: ctx.employmentId,
          status: { in: [GoalStatus.ACTIVE, GoalStatus.AT_RISK] }
        },
        data: { progress }
      });
      if (result.count !== 1) throw new Error("STALE_STATE");
      const updated = await tx.goal.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: "goal.self-progress-updated",
        resourceType: "Goal",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Goal not found in tenant." }, { status: 404 });
    if (code === "NOT_SELF") return forbidden("Goal progress can only be updated for your own employment record.");
    if (code === "GOAL_LOCKED" || code === "STALE_STATE") return Response.json({ error: "Only active or at-risk goals accept employee progress updates." }, { status: 409 });
    throw error;
  }
}
