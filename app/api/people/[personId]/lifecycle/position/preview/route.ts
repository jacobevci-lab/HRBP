import { EmploymentStatus, LifecycleEventType, PositionStatus, RequisitionStatus } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { createPositionChangePreviewReceipt, positionChangeImpactDigest } from "@/lib/employee-position-change-preview";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const ACTIVE_EMPLOYMENT_STATUSES: EmploymentStatus[] = [
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

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "people:write") || !can(ctx, "positions:write")) {
    return forbidden("Position lifecycle changes require people:write and positions:write permissions.");
  }

  const personId = asIdentifier((await params).personId);
  if (!personId) return Response.json({ error: "A valid person id is required." }, { status: 400 });

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const targetPositionId = asIdentifier(body.targetPositionId);
  const eventType = asEnumValue(body.eventType, allowedEvents);
  const reasonValue = asOptionalText(body.reason, 500);
  const reason = reasonValue ?? "";
  const effectiveAt = body.effectiveAt === undefined ? new Date() : typeof body.effectiveAt === "string" ? new Date(body.effectiveAt) : null;

  if (!targetPositionId) return Response.json({ error: "targetPositionId is required and must be a string." }, { status: 400 });
  if (!eventType) return Response.json({ error: "eventType must be TRANSFERRED or PROMOTED." }, { status: 400 });
  if (reasonValue === null) return Response.json({ error: "reason must be a string up to 500 characters." }, { status: 400 });
  if (!effectiveAt || Number.isNaN(effectiveAt.getTime())) return Response.json({ error: "effectiveAt must be a valid date string." }, { status: 400 });

  const maxScheduledAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  if (effectiveAt > maxScheduledAt) {
    return Response.json({ error: "Position changes can be previewed at most 365 days in advance." }, { status: 409 });
  }

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { tenantId: ctx.tenantId, personId, status: { in: ACTIVE_EMPLOYMENT_STATUSES } },
        orderBy: { startDate: "desc" },
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
      if (employment.positionId === targetPositionId) throw new Error("SAME_POSITION");

      const target = await tx.position.findFirst({
        where: { id: targetPositionId, tenantId: ctx.tenantId, validTo: null },
        select: {
          id: true,
          positionCode: true,
          title: true,
          grade: true,
          location: true,
          critical: true,
          status: true,
          orgUnit: { select: { id: true, name: true } }
        }
      });
      if (!target) throw new Error("TARGET_NOT_FOUND");
      if (target.status !== PositionStatus.OPEN) throw new Error("TARGET_NOT_OPEN");

      const [incumbent, openTargetRequisitionCount] = await Promise.all([
        tx.employment.findFirst({
          where: {
            tenantId: ctx.tenantId,
            positionId: target.id,
            status: { in: ACTIVE_EMPLOYMENT_STATUSES },
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
        })
      ]);
      if (incumbent) throw new Error("TARGET_OCCUPIED");

      const impactDigest = positionChangeImpactDigest({
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

      const receipt = createPositionChangePreviewReceipt({
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        personId,
        employmentId: employment.id,
        sourcePositionId: employment.positionId,
        targetPositionId: target.id,
        eventType,
        effectiveAt,
        reason,
        impactDigest
      });

      const orgUnitChanged = (employment.position?.orgUnit.id ?? null) !== target.orgUnit.id;
      const gradeChanged = (employment.position?.grade ?? null) !== (target.grade ?? null);
      const locationChanged = (employment.position?.location ?? null) !== (target.location ?? null);
      const warnings: string[] = [];
      if (employment._count.directReports > 0) warnings.push("DIRECT_REPORT_RELATIONSHIPS_UNCHANGED");
      if (orgUnitChanged && employment.managerEmploymentId) warnings.push("MANAGER_RELATIONSHIP_UNCHANGED");
      if (openTargetRequisitionCount > 0) warnings.push("TARGET_REQUISITIONS_REMAIN_OPEN");
      if (gradeChanged) warnings.push("GRADE_CHANGE_REQUIRES_COMPENSATION_REVIEW");
      if (locationChanged) warnings.push("LOCATION_CHANGE_REQUIRES_POLICY_REVIEW");
      if (target.critical) warnings.push("TARGET_POSITION_IS_CRITICAL");

      return {
        receipt: receipt.token,
        expiresAt: receipt.expiresAt,
        employmentId: employment.id,
        eventType,
        effectiveAt,
        sourcePosition: employment.position ? {
          id: employment.position.id,
          positionCode: employment.position.positionCode,
          title: employment.position.title,
          grade: employment.position.grade,
          location: employment.position.location,
          critical: employment.position.critical,
          orgUnit: employment.position.orgUnit
        } : null,
        targetPosition: {
          id: target.id,
          positionCode: target.positionCode,
          title: target.title,
          grade: target.grade,
          location: target.location,
          critical: target.critical,
          orgUnit: target.orgUnit
        },
        impacts: {
          orgUnitChanged,
          gradeChanged,
          locationChanged,
          directReportCount: employment._count.directReports,
          managerRelationshipPresent: Boolean(employment.managerEmploymentId),
          openTargetRequisitionCount
        },
        warnings
      };
    }));

    return Response.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const errors: Record<string, [string, number]> = {
      EMPLOYMENT_NOT_FOUND: ["Current employment was not found in this tenant.", 404],
      SAME_POSITION: ["The target position is already assigned to this employee.", 409],
      TARGET_NOT_FOUND: ["The target position was not found in this tenant.", 404],
      TARGET_NOT_OPEN: ["The target position is not open for assignment.", 409],
      TARGET_OCCUPIED: ["The target position already has an active incumbent.", 409]
    };
    if (errors[code]) return Response.json({ error: errors[code][0] }, { status: errors[code][1] });
    console.error("[HRBP] Employee position-change preview failed.");
    return Response.json({ error: "Employee position-change impact preview could not be prepared." }, { status: 500 });
  }
}
