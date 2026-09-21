import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "time:write")) return forbidden();
  const body = await request.json() as { employmentId?: string; scheduleId?: string; effectiveFrom?: string; effectiveTo?: string };
  if (!body.employmentId || !body.scheduleId || !body.effectiveFrom) return Response.json({ error: "employmentId, scheduleId and effectiveFrom are required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const [employment, schedule] = await Promise.all([
      tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
      tx.workSchedule.findFirst({ where: { id: body.scheduleId, tenantId: ctx.tenantId, active: true }, select: { id: true } })
    ]);
    if (!employment || !schedule) throw new Error("NOT_FOUND");
    await tx.workScheduleAssignment.updateMany({ where: { tenantId: ctx.tenantId, employmentId: body.employmentId, effectiveTo: null, effectiveFrom: { lt: new Date(body.effectiveFrom!) } }, data: { effectiveTo: new Date(body.effectiveFrom!) } });
    const assignment = await tx.workScheduleAssignment.create({ data: { tenantId: ctx.tenantId, employmentId: body.employmentId!, scheduleId: body.scheduleId!, effectiveFrom: new Date(body.effectiveFrom!), effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined } });
    await appendAudit(tx, ctx, { action: "work-schedule.assigned", resourceType: "WorkScheduleAssignment", resourceId: assignment.id, classification: DataClassification.CONFIDENTIAL });
    return assignment;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Employment or active work schedule not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
