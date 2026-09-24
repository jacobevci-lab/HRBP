import { DataClassification, GoalStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const statusTransitions: Record<GoalStatus, GoalStatus[]> = {
  DRAFT: [GoalStatus.ACTIVE, GoalStatus.CANCELLED],
  ACTIVE: [GoalStatus.AT_RISK, GoalStatus.COMPLETED, GoalStatus.CANCELLED],
  AT_RISK: [GoalStatus.ACTIVE, GoalStatus.COMPLETED, GoalStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: []
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const hasProgress = body.progress !== undefined && body.progress !== null && body.progress !== "";
  const progress = hasProgress ? Number(body.progress) : undefined;
  if (progress !== undefined && (!Number.isInteger(progress) || progress < 0 || progress > 100)) return Response.json({ error: "progress must be an integer from 0 to 100." }, { status: 400 });
  const requestedStatus = body.status ? String(body.status) as GoalStatus : undefined;
  if (requestedStatus && !Object.values(GoalStatus).includes(requestedStatus)) return Response.json({ error: "A valid goal status is required." }, { status: 400 });
  if (progress === undefined && !requestedStatus) return Response.json({ error: "progress or status is required." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const goal = await tx.goal.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, employmentId: true, status: true, progress: true } });
      if (!goal) throw new Error("NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, goal.employmentId)) throw new Error("OUT_OF_SCOPE");
      if ([GoalStatus.COMPLETED, GoalStatus.CANCELLED].includes(goal.status) && (progress !== undefined || (requestedStatus && requestedStatus !== goal.status))) throw new Error("TERMINAL");
      if (requestedStatus && requestedStatus !== goal.status && !(statusTransitions[goal.status] ?? []).includes(requestedStatus)) throw new Error("INVALID_TRANSITION");

      const nextStatus = requestedStatus ?? goal.status;
      const nextProgress = nextStatus === GoalStatus.COMPLETED ? 100 : progress ?? goal.progress;
      const updated = await tx.goal.update({ where: { id }, data: { status: nextStatus, progress: nextProgress } });
      await appendAudit(tx, ctx, { action: "goal.progress-updated", resourceType: "Goal", resourceId: id, classification: DataClassification.CONFIDENTIAL });
      return updated;
    });
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Goal not found in tenant." }, { status: 404 });
    if (code === "TERMINAL") return Response.json({ error: "Completed or cancelled goals are immutable." }, { status: 409 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "Goal transition is not allowed from the current state." }, { status: 409 });
    throw error;
  }
}
