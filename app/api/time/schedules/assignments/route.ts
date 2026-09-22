import { DataClassification, PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const scheduleManagers = new Set<PlatformRole>([
  PlatformRole.TIME_ADMIN,
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TENANT_ADMIN
]);

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "time:write") || !scheduleManagers.has(ctx.role)) return forbidden("Work schedule assignment requires a time-administration role.");

  const body = await request.json() as { employmentId?: string; scheduleId?: string; effectiveFrom?: string; effectiveTo?: string };
  if (!body.employmentId || !body.scheduleId || !body.effectiveFrom) {
    return Response.json({ error: "employmentId, scheduleId and effectiveFrom are required." }, { status: 400 });
  }

  const effectiveFrom = new Date(body.effectiveFrom);
  const effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : undefined;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime()))) {
    return Response.json({ error: "Effective dates must be valid ISO date values." }, { status: 400 });
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    return Response.json({ error: "effectiveTo must be after effectiveFrom." }, { status: 400 });
  }

  const data = await db.$transaction(async (tx) => {
    const [employment, schedule] = await Promise.all([
      tx.employment.findFirst({ where: { id: body.employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
      tx.workSchedule.findFirst({ where: { id: body.scheduleId, tenantId: ctx.tenantId, active: true }, select: { id: true } })
    ]);
    if (!employment || !schedule) throw new Error("NOT_FOUND");

    await tx.workScheduleAssignment.updateMany({
      where: { tenantId: ctx.tenantId, employmentId: body.employmentId, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
      data: { effectiveTo: effectiveFrom }
    });
    const assignment = await tx.workScheduleAssignment.create({
      data: {
        tenantId: ctx.tenantId,
        employmentId: body.employmentId!,
        scheduleId: body.scheduleId!,
        effectiveFrom,
        effectiveTo
      }
    });
    await appendAudit(tx, ctx, { action: "work-schedule.assigned", resourceType: "WorkScheduleAssignment", resourceId: assignment.id, classification: DataClassification.CONFIDENTIAL });
    return assignment;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));

  if (!data) return Response.json({ error: "Employment or active work schedule not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
