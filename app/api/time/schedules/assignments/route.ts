import { DataClassification, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asDate, asIdentifier, readJsonObject } from "@/lib/input-validation";
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

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const employmentId = asIdentifier(body.employmentId);
  const scheduleId = asIdentifier(body.scheduleId);
  const effectiveFrom = asDate(body.effectiveFrom);
  const effectiveTo = body.effectiveTo === undefined || body.effectiveTo === null || body.effectiveTo === "" ? undefined : asDate(body.effectiveTo);

  if (!employmentId || !scheduleId || !effectiveFrom) {
    return Response.json({ error: "employmentId, scheduleId and effectiveFrom must be valid scalar values." }, { status: 400 });
  }
  if (body.effectiveTo !== undefined && body.effectiveTo !== null && body.effectiveTo !== "" && !effectiveTo) {
    return Response.json({ error: "effectiveTo must be a valid ISO date string." }, { status: 400 });
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    return Response.json({ error: "effectiveTo must be after effectiveFrom." }, { status: 400 });
  }

  const data = await db.$transaction(async (tx) => {
    const [employment, schedule] = await Promise.all([
      tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
      tx.workSchedule.findFirst({ where: { id: scheduleId, tenantId: ctx.tenantId, active: true }, select: { id: true } })
    ]);
    if (!employment || !schedule) throw new Error("NOT_FOUND");

    const previousAssignments = await tx.workScheduleAssignment.findMany({
      where: { tenantId: ctx.tenantId, employmentId, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
      select: { id: true }
    });
    for (const previous of previousAssignments) {
      await tx.workScheduleAssignment.update({
        where: { id: previous.id },
        data: { effectiveTo: effectiveFrom }
      });
    }

    const assignment = await tx.workScheduleAssignment.create({
      data: {
        tenantId: ctx.tenantId,
        employmentId,
        scheduleId,
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
