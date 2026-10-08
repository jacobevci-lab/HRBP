import {
  DataClassification,
  EmploymentStatus,
  LifecycleEventType,
  PositionStatus,
  Prisma,
  RequisitionStatus,
  ScheduledPositionChangeStatus
} from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { positionChangeImpactDigest, verifyPositionChangePreviewReceipt } from "@/lib/employee-position-change-preview";
import { asEnumValue, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const activeEmploymentStatuses: EmploymentStatus[] = [
  EmploymentStatus.PREBOARDING,
  EmploymentStatus.ACTIVE,
  EmploymentStatus.LEAVE,
  EmploymentStatus.SUSPENDED
];

const allowedEvents = [LifecycleEventType.TRANSFERRED, LifecycleEventType.PROMOTED] as const;
const openRequisitionStatuses = [
  RequisitionStatus.DRAFT,
  RequisitionStatus.APPROVAL,
  RequisitionStatus.OPEN,
  RequisitionStatus.ON_HOLD
];

function scheduleWindow(effectiveAt: Date) {
  const tomorrow = new Date();
  tomorrow.setHours(23, 59, 59, 999);
  const max = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  return effectiveAt > tomorrow && effectiveAt <= max;
}

export async function GET(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "people:read")) return forbidden();

  const personId = asIdentifier((await params).personId);
  if (!personId) return Response.json({ error: "A valid person id is required." }, { status: 400 });

  const data = await withDb((db) => db.scheduledPositionChange.findMany({
    where: { tenantId: ctx.tenantId, personId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      eventType: true,
      effectiveAt: true,
      status: true,
      blockedCode: true,
      attempts: true,
      appliedAt: true,
      cancelledAt: true,
      createdAt: true,
      targetPosition: {
        select: { id: true, positionCode: true, title: true }
      }
    }
  }));

  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "people:write") || !can(ctx, "positions:write")) {
    return forbidden("Scheduling a position change requires people:write and positions:write permissions.");
  }

  const personId = asIdentifier((await params).personId);
  if (!personId) return Response.json({ error: "A valid person id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const targetPositionId = asIdentifier(body.targetPositionId);
  const eventType = asEnumValue(body.eventType, allowedEvents);
  const previewReceipt = asText(body.previewReceipt, 8192);
  const reasonValue = asOptionalText(body.reason, 500);
  const reason = reasonValue ?? "";
  const effectiveAt = typeof body.effectiveAt === "string" ? new Date(body.effectiveAt) : null;

  if (!targetPositionId) return Response.json({ error: "targetPositionId is required and must be a string." }, { status: 400 });
  if (!eventType) return Response.json({ error: "eventType must be TRANSFERRED or PROMOTED." }, { status: 400 });
  if (!previewReceipt) return Response.json({ error: "A fresh signed impact preview receipt is required before scheduling a position change." }, { status: 409 });
  if (reasonValue === null) return Response.json({ error: "reason must be a string up to 500 characters." }, { status: 400 });
  if (!effectiveAt || Number.isNaN(effectiveAt.getTime())) return Response.json({ error: "effectiveAt must be a valid date string." }, { status: 400 });
  if (!scheduleWindow(effectiveAt)) {
    return Response.json({ error: "Scheduled position changes must be more than one day and no more than 365 days in the future." }, { status: 409 });
  }

  const preview = verifyPositionChangePreviewReceipt(previewReceipt, {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    personId,
    targetPositionId,
    eventType,
    effectiveAt,
    reason
  });
  if (!preview) {
    return Response.json({ error: "The signed impact preview is missing, expired or does not match this scheduled change. Generate a new preview." }, { status: 409 });
  }

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: {
          id: preview.employmentId,
          tenantId: ctx.tenantId,
          personId,
          status: { in: activeEmploymentStatuses }
        },
        select: {
          id: true,
          positionId: true,
          managerEmploymentId: true,
          position: {
            select: {
              id: true,
              positionCode: true,
              title: true,
              grade: true,
              location: true,
              critical: true,
              orgUnit: { select: { id: true, name: true } }
            }
          },
          _count: { select: { directReports: true } }
        }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
      if (employment.positionId !== preview.sourcePositionId) throw new Error("PREVIEW_STALE");

      const target = await tx.position.findFirst({
        where: {
          id: targetPositionId,
          tenantId: ctx.tenantId,
          validTo: null,
          status: PositionStatus.OPEN
        },
        select: {
          id: true,
          positionCode: true,
          title: true,
          grade: true,
          location: true,
          critical: true,
          orgUnit: { select: { id: true, name: true } }
        }
      });
      if (!target) throw new Error("TARGET_NOT_OPEN");

      const [incumbent, openTargetRequisitionCount, existingConflict] = await Promise.all([
        tx.employment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            positionId: target.id,
            status: { in: activeEmploymentStatuses },
            NOT: { id: employment.id }
          },
          select: { id: true }
        }),
        tx.requisition.count({
          where: {
            tenantId: ctx.tenantId,
            positionId: target.id,
            status: { in: openRequisitionStatuses }
          }
        }),
        tx.scheduledPositionChange.findFirst({
          where: {
            tenantId: ctx.tenantId,
            status: ScheduledPositionChangeStatus.PENDING,
            OR: [
              { employmentId: employment.id },
              { targetPositionId: target.id }
            ]
          },
          select: { id: true }
        })
      ]);
      if (incumbent) throw new Error("TARGET_OCCUPIED");
      if (existingConflict) throw new Error("SCHEDULE_CONFLICT");

      const currentImpactDigest = positionChangeImpactDigest({
        sourcePositionId: employment.positionId,
        sourcePositionCode: employment.position?.positionCode ?? null,
        sourceTitle: employment.position?.title ?? null,
        sourceOrgUnitId: employment.position?.orgUnit.id ?? null,
        sourceOrgUnitName: employment.position?.orgUnit.name ?? null,
        sourceGrade: employment.position?.grade ?? null,
        sourceLocation: employment.position?.location ?? null,
        sourceCritical: employment.position?.critical ?? false,
        managerEmploymentId: employment.managerEmploymentId,
        directReportCount: employment._count.directReports,
        targetPositionId: target.id,
        targetPositionCode: target.positionCode,
        targetTitle: target.title,
        targetOrgUnitId: target.orgUnit.id,
        targetOrgUnitName: target.orgUnit.name,
        targetGrade: target.grade,
        targetLocation: target.location,
        targetCritical: target.critical,
        openTargetRequisitionCount
      });

      if (currentImpactDigest !== preview.impactDigest) throw new Error("PREVIEW_STALE");

      const scheduled = await tx.scheduledPositionChange.create({
        data: {
          tenantId: ctx.tenantId,
          personId,
          employmentId: employment.id,
          sourcePositionId: employment.positionId,
          targetPositionId: target.id,
          eventType,
          effectiveAt,
          reason: reason || null,
          impactDigest: currentImpactDigest,
          requestedById: ctx.actorId
        },
        select: {
          id: true,
          eventType: true,
          effectiveAt: true,
          status: true,
          targetPosition: { select: { id: true, positionCode: true, title: true } }
        }
      });

      await appendAudit(tx, ctx, {
        action: eventType === LifecycleEventType.PROMOTED
          ? "EMPLOYEE_PROMOTION_SCHEDULED"
          : "EMPLOYEE_TRANSFER_SCHEDULED",
        resourceType: "ScheduledPositionChange",
        resourceId: scheduled.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Future-dated employee position change scheduled after signed impact review"
      });

      return scheduled;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Current active employment was not found in this tenant." }, { status: 404 });
    if (code === "PREVIEW_STALE") return Response.json({ error: "The employee or related impact state changed after preview. Generate a new preview." }, { status: 409 });
    if (code === "TARGET_NOT_OPEN") return Response.json({ error: "The target position is no longer open." }, { status: 409 });
    if (code === "TARGET_OCCUPIED") return Response.json({ error: "The target position already has an active incumbent." }, { status: 409 });
    if (code === "SCHEDULE_CONFLICT") return Response.json({ error: "A pending scheduled change already reserves this employment or target position." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return Response.json({ error: "Scheduled position-change state changed concurrently. Refresh and retry." }, { status: 409 });
    }
    console.error("[HRBP] Scheduled position change creation failed.");
    return Response.json({ error: "Scheduled position change could not be created." }, { status: 500 });
  }
}
