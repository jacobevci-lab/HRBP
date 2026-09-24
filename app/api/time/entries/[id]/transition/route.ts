import { DataClassification, Prisma, TimeEntryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asEnumValue, readJsonObject } from "@/lib/input-validation";
import { enqueueTimeApprovalNotification, enqueueTimeDecisionNotification } from "@/lib/time-notifications";
import { addUtcDays, findEffectiveWorkSchedule, startOfUtcDay, validateTimeEntryIntegrity } from "@/lib/time-governance";
import { canTransitionTime } from "@/lib/work-pay-state";
import { getRequestContext, mutationOriginAllowed, unauthorized, type RequestContext } from "@/lib/request-context";

const activeEntryStatuses = [TimeEntryStatus.DRAFT, TimeEntryStatus.SUBMITTED, TimeEntryStatus.APPROVED, TimeEntryStatus.LOCKED] as const;
const scheduleValidatedStatuses = new Set<TimeEntryStatus>([TimeEntryStatus.SUBMITTED, TimeEntryStatus.APPROVED, TimeEntryStatus.LOCKED]);

function transitionAuthorized(ctx: RequestContext, employmentId: string, next: TimeEntryStatus) {
  const self = Boolean(ctx.employmentId && ctx.employmentId === employmentId);
  if (next === TimeEntryStatus.SUBMITTED) return self ? can(ctx, "time:self-entry") : can(ctx, "time:write");
  if (next === TimeEntryStatus.APPROVED || next === TimeEntryStatus.REJECTED) return !self && can(ctx, "time:approve");
  if (next === TimeEntryStatus.LOCKED) return !self && can(ctx, "time:lock");
  return false;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");

  const { id } = await params;
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = asEnumValue(body.status, Object.values(TimeEntryStatus));
  if (!next) return Response.json({ error: "A valid time-entry status is required." }, { status: 400 });

  try {
    const result = await db.$transaction(async (tx) => {
      const scope = await resolveEmploymentScope(tx, ctx);
      const current = await tx.timeEntry.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          workDate: true,
          startAt: true,
          endAt: true,
          minutes: true,
          overtimeMinutes: true,
          status: true,
          approvedById: true,
          updatedAt: true,
          employment: {
            select: {
              managerEmploymentId: true,
              person: { select: { givenName: true, familyName: true } }
            }
          }
        }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (!canActOnEmployment(scope, current.employmentId)) throw new Error("OUT_OF_SCOPE");
      if (!canTransitionTime(current.status, next)) throw new Error("INVALID_TRANSITION");
      if (!transitionAuthorized(ctx, current.employmentId, next)) throw new Error("POLICY_DENIED");

      if (scheduleValidatedStatuses.has(next)) {
        const integrityError = validateTimeEntryIntegrity(current);
        if (integrityError) throw new Error("INVALID_ENTRY");
        const schedule = await findEffectiveWorkSchedule(tx, {
          tenantId: ctx.tenantId,
          employmentId: current.employmentId,
          workDate: current.workDate
        });
        if (!schedule) throw new Error("SCHEDULE_REQUIRED");
      }

      if (next === TimeEntryStatus.SUBMITTED) {
        const dayStart = startOfUtcDay(current.workDate);
        const dayEnd = addUtcDays(dayStart, 1);
        const overlap = await tx.timeEntry.findFirst({
          where: {
            id: { not: current.id },
            tenantId: ctx.tenantId,
            employmentId: current.employmentId,
            workDate: { gte: dayStart, lt: dayEnd },
            status: { in: [...activeEntryStatuses] },
            ...(current.startAt && current.endAt ? {
              OR: [
                { startAt: null },
                { endAt: null },
                { startAt: { lt: current.endAt }, endAt: { gt: current.startAt } }
              ]
            } : {})
          },
          select: { id: true }
        });
        if (overlap) throw new Error("OVERLAP");
      }

      if (next === TimeEntryStatus.LOCKED && current.approvedById === ctx.actorId) throw new Error("SAME_ACTOR_LOCK");

      const now = new Date();
      const decision = next === TimeEntryStatus.APPROVED || next === TimeEntryStatus.REJECTED;
      const write = await tx.timeEntry.updateMany({
        where: { id, tenantId: ctx.tenantId, status: current.status },
        data: {
          status: next,
          ...(decision ? { approvedById: ctx.actorId, approvedAt: now } : {}),
          ...(next === TimeEntryStatus.SUBMITTED ? { approvedById: null, approvedAt: null } : {})
        }
      });
      if (write.count !== 1) throw new Error("STALE_STATE");

      const updated = await tx.timeEntry.findUnique({ where: { id } });
      if (!updated) throw new Error("NOT_FOUND");

      await appendAudit(tx, ctx, {
        action: `time-entry.${next.toLowerCase()}`,
        resourceType: "TimeEntry",
        resourceId: id,
        classification: DataClassification.CONFIDENTIAL
      });

      if (next === TimeEntryStatus.SUBMITTED && current.employment.managerEmploymentId) {
        await enqueueTimeApprovalNotification(tx, {
          tenantId: ctx.tenantId,
          managerEmploymentId: current.employment.managerEmploymentId,
          entryId: id,
          submissionVersion: current.updatedAt.toISOString(),
          employeeName: `${current.employment.person.givenName} ${current.employment.person.familyName}`,
          workDate: current.workDate,
          minutes: current.minutes,
          overtimeMinutes: current.overtimeMinutes
        });
      }
      if (next === TimeEntryStatus.APPROVED || next === TimeEntryStatus.REJECTED) {
        await enqueueTimeDecisionNotification(tx, {
          tenantId: ctx.tenantId,
          employmentId: current.employmentId,
          entryId: id,
          decisionVersion: current.updatedAt.toISOString(),
          decision: next,
          workDate: current.workDate,
          minutes: current.minutes,
          overtimeMinutes: current.overtimeMinutes
        });
      }
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Response.json({ data: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Time entry not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Time entry is outside your authorized relationship scope.");
    if (code === "POLICY_DENIED") return forbidden("This time-entry transition requires a different self-service, approval or operational capability.");
    if (code === "INVALID_TRANSITION" || code === "STALE_STATE") return Response.json({ error: "Time entry cannot transition from its current state." }, { status: 409 });
    if (code === "INVALID_ENTRY") return Response.json({ error: "Time entry integrity validation failed. Correct worked minutes, overtime or the start/end interval before submitting." }, { status: 409 });
    if (code === "SCHEDULE_REQUIRED") return Response.json({ error: "An effective active work schedule is required before this time entry can move forward." }, { status: 409 });
    if (code === "OVERLAP") return Response.json({ error: "Another governed time entry overlaps this employment and work day." }, { status: 409 });
    if (code === "SAME_ACTOR_LOCK") return forbidden("The actor who approved this entry cannot also lock it for payroll consumption.");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Time state changed concurrently. Retry the transition." }, { status: 409 });
    throw error;
  }
}
