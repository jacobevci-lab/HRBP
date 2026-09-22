import { DataClassification, PlatformRole, TimeEntryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { canTransitionTime } from "@/lib/work-pay-state";
import { getRequestContext, mutationOriginAllowed, unauthorized, type RequestContext } from "@/lib/request-context";

const approvalRoles = new Set<PlatformRole>([
  PlatformRole.MANAGER,
  PlatformRole.TIME_ADMIN,
  PlatformRole.HR_OPERATIONS
]);

const operationalSubmitRoles = new Set<PlatformRole>([
  PlatformRole.TIME_ADMIN,
  PlatformRole.HR_OPERATIONS
]);

const lockRoles = new Set<PlatformRole>([
  PlatformRole.TIME_ADMIN,
  PlatformRole.HR_OPERATIONS
]);

function transitionAuthorized(ctx: RequestContext, employmentId: string, next: TimeEntryStatus) {
  const self = Boolean(ctx.employmentId && ctx.employmentId === employmentId);
  if (next === TimeEntryStatus.SUBMITTED) return self || operationalSubmitRoles.has(ctx.role);
  if (next === TimeEntryStatus.APPROVED || next === TimeEntryStatus.REJECTED) return !self && approvalRoles.has(ctx.role);
  if (next === TimeEntryStatus.LOCKED) return lockRoles.has(ctx.role);
  return false;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "time:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as { status?: TimeEntryStatus };
  if (!body.status || !Object.values(TimeEntryStatus).includes(body.status)) {
    return Response.json({ error: "A valid time-entry status is required." }, { status: 400 });
  }

  const scope = await resolveEmploymentScope(db, ctx);
  const result = await db.$transaction(async (tx) => {
    const current = await tx.timeEntry.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    if (!canActOnEmployment(scope, current.employmentId)) throw new Error("OUT_OF_SCOPE");
    if (!canTransitionTime(current.status, body.status!)) throw new Error("INVALID_TRANSITION");
    if (!transitionAuthorized(ctx, current.employmentId, body.status!)) throw new Error("POLICY_DENIED");

    const now = new Date();
    const decision = body.status === TimeEntryStatus.APPROVED || body.status === TimeEntryStatus.REJECTED;
    const updated = await tx.timeEntry.update({
      where: { id },
      data: {
        status: body.status,
        ...(decision ? { approvedById: ctx.actorId, approvedAt: now } : {}),
        ...(body.status === TimeEntryStatus.SUBMITTED ? { approvedById: null, approvedAt: null } : {})
      }
    });
    await appendAudit(tx, ctx, {
      action: `time-entry.${body.status!.toLowerCase()}`,
      resourceType: "TimeEntry",
      resourceId: id,
      classification: DataClassification.CONFIDENTIAL
    });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE", "INVALID_TRANSITION", "POLICY_DENIED"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Time entry not found in tenant." }, { status: 404 });
  if (result === "OUT_OF_SCOPE") return forbidden("Time entry is outside your authorized relationship scope.");
  if (result === "POLICY_DENIED") return forbidden("This time-entry transition requires a different relationship or operational role.");
  if (result === "INVALID_TRANSITION") return Response.json({ error: "Time entry cannot transition to that state." }, { status: 409 });
  return Response.json({ data: result });
}
