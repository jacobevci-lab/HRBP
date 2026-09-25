import { DataClassification, PlatformRole, Prisma, RequisitionStatus, SeparationStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { asDate, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "offboarding:write")) return forbidden();

  const processId = asIdentifier((await params).id);
  if (!processId) return Response.json({ error: "A valid separation process id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  if (typeof body.required !== "boolean") return Response.json({ error: "required must be a boolean." }, { status: 400 });
  const required = body.required;
  const reason = asText(body.reason, 2000);
  if (!reason || reason.length < 10) return Response.json({ error: "Replacement decision reason must be between 10 and 2000 characters." }, { status: 400 });
  const targetHireDate = body.targetHireDate === undefined || body.targetHireDate === null || body.targetHireDate === "" ? null : asDate(body.targetHireDate);
  if (body.targetHireDate && !targetHireDate) return Response.json({ error: "targetHireDate must be a valid date." }, { status: 400 });
  if (required && !can(ctx, "recruiting:write")) return forbidden("Creating a backfill requisition requires recruiting:write.");

  try {
    const data = await db.$transaction(async (tx) => {
      const process = await tx.separationProcess.findFirst({
        where: { id: processId, tenantId: ctx.tenantId },
        select: {
          id: true,
          employmentId: true,
          status: true,
          completedAt: true,
          lastWorkingDate: true,
          updatedAt: true,
          replacementRequired: true,
          replacementRequisitionId: true
        }
      });
      if (!process) throw new Error("NOT_FOUND");
      if (process.status === SeparationStatus.CLOSED || process.status === SeparationStatus.CANCELLED || process.completedAt) throw new Error("TERMINAL");
      if (process.replacementRequisitionId) throw new Error("HANDED_OFF");

      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, process.employmentId)) throw new Error("OUT_OF_SCOPE");

      const employment = await tx.employment.findFirst({
        where: { id: process.employmentId, tenantId: ctx.tenantId },
        select: {
          id: true,
          positionId: true,
          person: { select: { givenName: true, familyName: true } },
          position: { select: { id: true, title: true, positionCode: true } }
        }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
      if (required && (!employment.positionId || !employment.position)) throw new Error("POSITION_REQUIRED");

      const now = new Date();
      let requisition: { id: string; status: RequisitionStatus; targetHireDate: Date | null } | null = null;
      if (required && employment.position) {
        requisition = await tx.requisition.create({
          data: {
            tenantId: ctx.tenantId,
            positionId: employment.position.id,
            title: `Backfill · ${employment.position.title}`,
            status: RequisitionStatus.DRAFT,
            openings: 1,
            targetHireDate: targetHireDate ?? process.lastWorkingDate
          },
          select: { id: true, status: true, targetHireDate: true }
        });
      }

      const updated = await tx.separationProcess.updateMany({
        where: {
          id: process.id,
          tenantId: ctx.tenantId,
          status: process.status,
          completedAt: null,
          updatedAt: process.updatedAt,
          replacementRequisitionId: null
        },
        data: {
          replacementRequired: required,
          replacementDecisionReason: reason,
          replacementDecisionById: ctx.actorId,
          replacementDecisionAt: now,
          replacementRequisitionId: requisition?.id ?? null
        }
      });
      if (updated.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: required ? "offboarding.replacement-required" : "offboarding.replacement-not-required",
        resourceType: "SeparationProcess",
        resourceId: process.id,
        classification: DataClassification.RESTRICTED,
        purpose: required ? "Human-approved replacement decision with governed recruiting handoff" : "Human-confirmed no-replacement decision for governed separation"
      });

      if (requisition && employment.position) {
        await appendAudit(tx, ctx, {
          action: "REQUISITION_CREATED_FROM_OFFBOARDING",
          resourceType: "Requisition",
          resourceId: requisition.id,
          classification: DataClassification.CONFIDENTIAL,
          purpose: "Draft backfill requisition created from explicit offboarding replacement decision"
        });
        await enqueueNotificationOutbox(tx, {
          tenantId: ctx.tenantId,
          eventType: "OFFBOARDING_BACKFILL_DRAFT_CREATED",
          recipientRole: PlatformRole.RECRUITER,
          templateKey: "offboarding.backfill-draft",
          resourceType: "Requisition",
          resourceId: requisition.id,
          dedupeKey: `offboarding-backfill:${process.id}:${requisition.id}`,
          classification: DataClassification.CONFIDENTIAL,
          payload: {
            separationProcessId: process.id,
            replacementRequisitionId: requisition.id,
            employeeName: `${employment.person.givenName} ${employment.person.familyName}`,
            positionTitle: employment.position.title,
            positionCode: employment.position.positionCode,
            targetHireDate: requisition.targetHireDate?.toISOString() ?? null,
            reminderState: "backfill-draft"
          }
        });
      }

      return {
        processId: process.id,
        replacementRequired: required,
        replacementDecisionReason: reason,
        replacementDecisionById: ctx.actorId,
        replacementDecisionAt: now,
        replacementRequisitionId: requisition?.id ?? null,
        requisitionStatus: requisition?.status ?? null,
        targetHireDate: requisition?.targetHireDate ?? null
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "NOT_FOUND") return Response.json({ error: "Separation process not found." }, { status: 404 });
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Employment record not found." }, { status: 409 });
    if (code === "OUT_OF_SCOPE") return forbidden("Separation process is outside your authorized relationship scope.");
    if (code === "TERMINAL") return Response.json({ error: "Closed or cancelled separations cannot receive a replacement decision." }, { status: 409 });
    if (code === "POSITION_REQUIRED") return Response.json({ error: "A position-backed employment is required before a backfill requisition can be created." }, { status: 409 });
    if (code === "HANDED_OFF") return Response.json({ error: "A backfill requisition is already linked to this separation. Manage or cancel that requisition in Recruiting before changing the decision." }, { status: 409 });
    if (code === "STATE_CONFLICT" || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) return Response.json({ error: "The separation changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offboarding replacement decision failed", error);
    return Response.json({ error: "Replacement decision could not be recorded." }, { status: 500 });
  }
}
