import { DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "time:configure")) return forbidden("Work schedule assignment requires time:configure.");

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

  try {
    const data = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employmentId)) throw new Error("OUT_OF_SCOPE");

      const [employment, schedule] = await Promise.all([
        tx.employment.findFirst({ where: { id: employmentId, tenantId: ctx.tenantId }, select: { id: true } }),
        tx.workSchedule.findFirst({
          where: { id: scheduleId, tenantId: ctx.tenantId, active: true },
          select: { id: true, effectiveFrom: true, effectiveTo: true }
        })
      ]);
      if (!employment || !schedule) throw new Error("NOT_FOUND");
      if (effectiveFrom < schedule.effectiveFrom) throw new Error("SCHEDULE_RANGE");
      const normalizedEffectiveTo = effectiveTo ?? schedule.effectiveTo ?? undefined;
      if (normalizedEffectiveTo && normalizedEffectiveTo <= effectiveFrom) throw new Error("SCHEDULE_RANGE");
      if (schedule.effectiveTo && normalizedEffectiveTo && normalizedEffectiveTo > schedule.effectiveTo) throw new Error("SCHEDULE_RANGE");

      const futureOverlap = await tx.workScheduleAssignment.findFirst({
        where: {
          tenantId: ctx.tenantId,
          employmentId,
          effectiveFrom: {
            gte: effectiveFrom,
            ...(normalizedEffectiveTo ? { lt: normalizedEffectiveTo } : {})
          }
        },
        select: { id: true }
      });
      if (futureOverlap) throw new Error("OVERLAP");

      const previousAssignments = await tx.workScheduleAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          employmentId,
          effectiveFrom: { lt: effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }]
        },
        select: { id: true }
      });
      for (const previous of previousAssignments) {
        await tx.workScheduleAssignment.update({ where: { id: previous.id }, data: { effectiveTo: effectiveFrom } });
      }

      const assignment = await tx.workScheduleAssignment.create({
        data: {
          tenantId: ctx.tenantId,
          employmentId,
          scheduleId,
          effectiveFrom,
          effectiveTo: normalizedEffectiveTo
        }
      });
      await appendAudit(tx, ctx, {
        action: "work-schedule.assigned",
        resourceType: "WorkScheduleAssignment",
        resourceId: assignment.id,
        classification: DataClassification.CONFIDENTIAL
      });
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Employment or active work schedule not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "SCHEDULE_RANGE") return Response.json({ error: "Assignment dates must stay within the active schedule effective range." }, { status: 409 });
    if (code === "OVERLAP") return Response.json({ error: "A future work schedule assignment overlaps the requested effective range." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "A schedule assignment already begins on this effective date." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Schedule assignment changed concurrently. Retry the request." }, { status: 409 });
    throw error;
  }
}
