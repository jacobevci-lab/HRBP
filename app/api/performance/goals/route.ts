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
  const startsAt = String(body.startsAt ?? "");
  const dueAt = String(body.dueAt ?? "");
  if (!employmentId || !title || !startsAt || !dueAt) return Response.json({ error: "employmentId, title, startsAt and dueAt are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");
    const employment = await tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } });
    if (!employment) throw new Error("NOT_FOUND");
    const goal = await tx.goal.create({ data: {
      tenantId: ctx.tenantId, employmentId, title,
      description: body.description ? String(body.description) : undefined,
      parentGoalId: body.parentGoalId ? String(body.parentGoalId) : undefined,
      weight: body.weight as string | number | undefined,
      progress: body.progress ? Number(body.progress) : 0,
      status: body.status && Object.values(GoalStatus).includes(body.status as GoalStatus) ? body.status as GoalStatus : GoalStatus.DRAFT,
      startsAt: new Date(startsAt), dueAt: new Date(dueAt)
    }});
    await appendAudit(tx, ctx, { action: "goal.created", resourceType: "Goal", resourceId: goal.id, classification: DataClassification.CONFIDENTIAL });
    return goal;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  if (data === "NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
