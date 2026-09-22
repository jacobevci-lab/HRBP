import { DataClassification, EmploymentStatus, LifecycleEventType, PositionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const ACTIVE_EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  EmploymentStatus.PREBOARDING,
  EmploymentStatus.ACTIVE,
  EmploymentStatus.LEAVE,
  EmploymentStatus.SUSPENDED
];

const allowedEvents = new Set<LifecycleEventType>([
  LifecycleEventType.TRANSFERRED,
  LifecycleEventType.PROMOTED
]);

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "people:write") || !can(ctx, "positions:write")) {
    return forbidden("Position lifecycle changes require people:write and positions:write permissions.");
  }

  const { personId } = await params;
  const body = await request.json() as Record<string, unknown>;
  const targetPositionId = String(body.targetPositionId ?? "").trim();
  const eventType = String(body.eventType ?? "").trim().toUpperCase() as LifecycleEventType;
  const reason = String(body.reason ?? "").trim();
  const effectiveAt = body.effectiveAt ? new Date(String(body.effectiveAt)) : new Date();

  if (!targetPositionId) return Response.json({ error: "targetPositionId is required." }, { status: 400 });
  if (!allowedEvents.has(eventType)) return Response.json({ error: "eventType must be TRANSFERRED or PROMOTED." }, { status: 400 });
  if (Number.isNaN(effectiveAt.getTime())) return Response.json({ error: "effectiveAt must be a valid date." }, { status: 400 });

  const tomorrow = new Date();
  tomorrow.setHours(23, 59, 59, 999);
  if (effectiveAt > tomorrow) {
    return Response.json({ error: "Future-dated position changes are not applied immediately. Use a scheduled workflow when that capability is enabled." }, { status: 409 });
  }

  try {
    const result = await withDb((db) => db.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { tenantId: ctx.tenantId, personId, status: { in: ACTIVE_EMPLOYMENT_STATUSES } },
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          positionId: true,
          position: { select: { id: true, positionCode: true, title: true, status: true } }
        }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
      if (employment.positionId === targetPositionId) throw new Error("SAME_POSITION");

      const target = await tx.position.findFirst({
        where: { id: targetPositionId, tenantId: ctx.tenantId, validTo: null },
        select: { id: true, positionCode: true, title: true, status: true }
      });
      if (!target) throw new Error("TARGET_NOT_FOUND");
      if (target.status !== PositionStatus.OPEN) throw new Error("TARGET_NOT_OPEN");

      const incumbent = await tx.employment.findFirst({
        where: {
          tenantId: ctx.tenantId,
          positionId: target.id,
          status: { in: ACTIVE_EMPLOYMENT_STATUSES },
          NOT: { id: employment.id }
        },
        select: { id: true }
      });
      if (incumbent) throw new Error("TARGET_OCCUPIED");

      const claimed = await tx.employment.updateMany({
        where: { id: employment.id, tenantId: ctx.tenantId, positionId: employment.positionId },
        data: { positionId: target.id }
      });
      if (claimed.count !== 1) throw new Error("STATE_CONFLICT");

      if (employment.positionId) {
        await tx.position.updateMany({
          where: { id: employment.positionId, tenantId: ctx.tenantId, validTo: null },
          data: { status: PositionStatus.OPEN }
        });
      }
      await tx.position.update({ where: { id: target.id }, data: { status: PositionStatus.FILLED } });

      const fromLabel = employment.position ? `${employment.position.title} (${employment.position.positionCode})` : "Unassigned";
      const toLabel = `${target.title} (${target.positionCode})`;
      const lifecycle = await tx.employeeLifecycleEvent.create({
        data: {
          tenantId: ctx.tenantId,
          personId,
          employmentId: employment.id,
          type: eventType,
          effectiveAt,
          summary: `${eventType === LifecycleEventType.PROMOTED ? "Promoted" : "Transferred"}: ${fromLabel} → ${toLabel}${reason ? ` · ${reason}` : ""}`,
          actorId: ctx.actorId
        }
      });

      await appendAudit(tx, ctx, {
        action: eventType === LifecycleEventType.PROMOTED ? "EMPLOYEE_PROMOTED" : "EMPLOYEE_TRANSFERRED",
        resourceType: "Employment",
        resourceId: employment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Employee position lifecycle administration"
      });

      return {
        employmentId: employment.id,
        fromPositionId: employment.positionId,
        targetPositionId: target.id,
        eventId: lifecycle.id,
        eventType,
        effectiveAt
      };
    }));

    return Response.json({ data: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const errors: Record<string, [string, number]> = {
      EMPLOYMENT_NOT_FOUND: ["Current employment was not found in this tenant.", 404],
      SAME_POSITION: ["The target position is already assigned to this employee.", 409],
      TARGET_NOT_FOUND: ["The target position was not found in this tenant.", 404],
      TARGET_NOT_OPEN: ["The target position is not open for assignment.", 409],
      TARGET_OCCUPIED: ["The target position already has an active incumbent.", 409],
      STATE_CONFLICT: ["The employment changed concurrently. Refresh and try again.", 409]
    };
    if (errors[code]) return Response.json({ error: errors[code][0] }, { status: errors[code][1] });
    console.error("Employee position lifecycle transition failed", error);
    return Response.json({ error: "Employee position lifecycle change could not be completed." }, { status: 500 });
  }
}
