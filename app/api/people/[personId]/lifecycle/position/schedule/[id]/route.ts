import { DataClassification, ScheduledPositionChangeStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function DELETE(request: Request, { params }: { params: Promise<{ personId: string; id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "people:write") || !can(ctx, "positions:write")) {
    return forbidden("Cancelling a scheduled position change requires people:write and positions:write permissions.");
  }

  const resolved = await params;
  const personId = asIdentifier(resolved.personId);
  const id = asIdentifier(resolved.id);
  if (!personId || !id) return Response.json({ error: "Valid person and scheduled change ids are required." }, { status: 400 });

  const result = await withDb((db) => db.$transaction(async (tx) => {
    const current = await tx.scheduledPositionChange.findFirst({
      where: { id, tenantId: ctx.tenantId, personId },
      select: { id: true, status: true, employmentId: true }
    });
    if (!current) return { kind: "not-found" as const };
    const scope = await resolveEmploymentScope(tx, ctx);
    if (!canActOnEmployment(scope, current.employmentId)) return { kind: "forbidden" as const };
    if (current.status !== ScheduledPositionChangeStatus.PENDING) {
      return { kind: "state" as const, status: current.status };
    }

    const now = new Date();
    const changed = await tx.scheduledPositionChange.updateMany({
      where: {
        id,
        tenantId: ctx.tenantId,
        personId,
        status: ScheduledPositionChangeStatus.PENDING
      },
      data: {
        status: ScheduledPositionChangeStatus.CANCELLED,
        cancelledAt: now,
        cancelledById: ctx.actorId
      }
    });
    if (changed.count !== 1) return { kind: "state" as const, status: "CHANGED" as const };

    await appendAudit(tx, ctx, {
      action: "EMPLOYEE_POSITION_CHANGE_SCHEDULE_CANCELLED",
      resourceType: "ScheduledPositionChange",
      resourceId: id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Future-dated employee position change cancelled before execution"
    });

    return { kind: "cancelled" as const, cancelledAt: now };
  }));

  if (result.kind === "not-found") return Response.json({ error: "Scheduled position change was not found." }, { status: 404 });
  if (result.kind === "forbidden") return forbidden("Employment is outside your authorized relationship scope.");
  if (result.kind === "state") return Response.json({ error: "Only pending scheduled position changes can be cancelled." }, { status: 409 });
  return Response.json({ data: { id, status: ScheduledPositionChangeStatus.CANCELLED, cancelledAt: result.cancelledAt } });
}
