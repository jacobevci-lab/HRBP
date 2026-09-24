import { DataClassification, GoalStatus } from "@prisma/client";
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
  const data = await db.goal.findMany({ where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "performance:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const employmentId = String(body.employmentId ?? "");
  const title = String(body.title ?? "").trim();
  const startsAtRaw = String(body.startsAt ?? "");
  const dueAtRaw = String(body.dueAt ?? "");
  if (!employmentId || !title || !startsAtRaw || !dueAtRaw) return Response.json({ error: "employmentId, title, startsAt and dueAt are required." }, { status: 400 });

  const startsAt = new Date(startsAtRaw);
  const dueAt = new Date(dueAtRaw);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(dueAt.getTime()) || dueAt < startsAt) return Response.json({ error: "Goal dates are invalid or dueAt is before startsAt." }, { status: 400 });
  const progress = body.progress === undefined || body.progress === "" ? 0 : Number(body.progress);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) return Response.json({ error: "progress must be an integer from 0 to 100." }, { status: 400 });
  const weight = body.weight === undefined || body.weight === "" ? undefined : Number(body.weight);
  if (weight !== undefined && (!Number.isFinite(weight) || weight < 0 || weight > 100)) return Response.json({ error: "weight must be between 0 and 100." }, { status: 400 });
  const status = body.status && Object.values(GoalStatus).includes(body.status as GoalStatus) ? body.status as GoalStatus : GoalStatus.DRAFT;
  const parentGoalId = body.parentGoalId ? String(body.parentGoalId) : undefined;

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");
      const [employment, parentGoal] = await Promise.all([
        tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        parentGoalId ? tx.goal.findFirst({ where: { id: parentGoalId, tenantId: ctx.tenantId, ...employmentIdFilter(scope) }, select: { id: true } }) : Promise.resolve(null)
      ]);
      if (!employment) throw new Error("NOT_FOUND");
      if (parentGoalId && !parentGoal) throw new Error("PARENT_NOT_FOUND");

      const goal = await tx.goal.create({ data: {
        tenantId: ctx.tenantId,
        employmentId,
        title: title.slice(0, 240),
        description: body.description ? String(body.description).trim().slice(0, 4000) : undefined,
        parentGoalId,
        weight,
        progress: status === GoalStatus.COMPLETED ? 100 : progress,
        status,
        startsAt,
        dueAt
      }});
      await appendAudit(tx, ctx, { action: "goal.created", resourceType: "Goal", resourceId: goal.id, classification: DataClassification.CONFIDENTIAL });
      return goal;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
    if (code === "PARENT_NOT_FOUND") return Response.json({ error: "Parent goal was not found inside the authorized tenant scope." }, { status: 404 });
    throw error;
  }
}
