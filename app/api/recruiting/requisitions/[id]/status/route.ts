import { DataClassification, PositionStatus, Prisma, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
import { enqueueRequisitionApprovalNotification, enqueueRequisitionDecisionNotification } from "@/lib/recruiting-notifications";
import { canTransitionRequisition, parseRequisitionStatus } from "@/lib/recruiting-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const requisitionApprovalDecisions = new Set<RequisitionStatus>([
  RequisitionStatus.OPEN,
  RequisitionStatus.DRAFT,
  RequisitionStatus.CANCELLED
]);

function requiresApprovalAuthority(from: RequisitionStatus, to: RequisitionStatus) {
  return from === RequisitionStatus.APPROVAL && requisitionApprovalDecisions.has(to);
}

function decisionFor(next: RequisitionStatus): "APPROVED" | "RETURNED" | "CANCELLED" | null {
  if (next === RequisitionStatus.OPEN) return "APPROVED";
  if (next === RequisitionStatus.DRAFT) return "RETURNED";
  if (next === RequisitionStatus.CANCELLED) return "CANCELLED";
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid requisition id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = parseRequisitionStatus(body.status);
  if (!next) return Response.json({ error: "A valid requisition status is required." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const current = await tx.requisition.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, title: true, status: true, positionId: true, hiringManagerId: true, openings: true, openedAt: true }
      });
      if (!current) throw new Error("REQUISITION_NOT_FOUND");
      if (!canTransitionRequisition(current.status, next)) throw new Error("INVALID_TRANSITION");
      if (requiresApprovalAuthority(current.status, next) && !can(ctx, "recruiting:approve")) throw new Error("APPROVAL_AUTHORITY_REQUIRED");

      if (next === RequisitionStatus.OPEN) {
        if (!current.positionId) throw new Error("POSITION_REQUIRED");
        if (!current.hiringManagerId) throw new Error("HIRING_MANAGER_REQUIRED");
        if (current.openings !== 1) throw new Error("POSITION_CAPACITY_MISMATCH");

        const position = await tx.position.findFirst({
          where: { id: current.positionId, tenantId: ctx.tenantId },
          select: { id: true, status: true }
        });
        if (!position) throw new Error("POSITION_NOT_FOUND");
        if (position.status !== PositionStatus.OPEN) throw new Error("POSITION_NOT_OPEN");

        const competing = await tx.requisition.findFirst({
          where: {
            tenantId: ctx.tenantId,
            id: { not: current.id },
            positionId: position.id,
            status: { in: [RequisitionStatus.OPEN, RequisitionStatus.ON_HOLD] }
          },
          select: { id: true }
        });
        if (competing) throw new Error("POSITION_REQUISITION_CONFLICT");
      }

      const approvalDecision = requiresApprovalAuthority(current.status, next);
      const creatorAudit = approvalDecision ? await tx.auditEvent.findFirst({
        where: {
          tenantId: ctx.tenantId,
          resourceType: "Requisition",
          resourceId: current.id,
          action: "REQUISITION_CREATED"
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { actorId: true }
      }) : null;

      if (current.status === RequisitionStatus.APPROVAL && next === RequisitionStatus.OPEN && creatorAudit?.actorId === ctx.actorId) {
        throw new Error("SELF_APPROVAL_BLOCKED");
      }

      try {
        await tx.requisition.update({
          where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
          data: {
            status: next,
            openedAt: next === RequisitionStatus.OPEN && !current.openedAt ? new Date() : current.openedAt
          }
        });
      } catch (error) {
        if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
        throw error;
      }

      await appendAudit(tx, ctx, {
        action: `REQUISITION_STATUS_${current.status}_TO_${next}`,
        resourceType: "Requisition",
        resourceId: current.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: approvalDecision ? "Independent hiring requisition decision" : "Hiring requisition lifecycle"
      });

      if (current.status === RequisitionStatus.DRAFT && next === RequisitionStatus.APPROVAL) {
        await enqueueRequisitionApprovalNotification(tx, {
          tenantId: ctx.tenantId,
          requisitionId: current.id,
          title: current.title,
          openings: current.openings
        });
      }

      const decision = approvalDecision ? decisionFor(next) : null;
      if (decision && creatorAudit?.actorId) {
        await enqueueRequisitionDecisionNotification(tx, {
          tenantId: ctx.tenantId,
          recipientUserId: creatorAudit.actorId,
          requisitionId: current.id,
          title: current.title,
          openings: current.openings,
          decision
        });
      }

      return { id: current.id, status: next };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "REQUISITION_NOT_FOUND") return Response.json({ error: "Requisition was not found in this tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested requisition-status transition is not allowed." }, { status: 409 });
    if (code === "APPROVAL_AUTHORITY_REQUIRED") return forbidden("Independent recruiting approval authority is required for this requisition decision.");
    if (code === "SELF_APPROVAL_BLOCKED") return forbidden("The requisition creator cannot approve and open the same requisition.");
    if (code === "POSITION_REQUIRED") return Response.json({ error: "A requisition must be linked to a position before it can be opened." }, { status: 409 });
    if (code === "HIRING_MANAGER_REQUIRED") return Response.json({ error: "A requisition must have a hiring manager before it can be opened." }, { status: 409 });
    if (code === "POSITION_CAPACITY_MISMATCH") return Response.json({ error: "A position-backed requisition represents one authorized headcount position and must have exactly one opening." }, { status: 409 });
    if (code === "POSITION_NOT_FOUND") return Response.json({ error: "The requisition position was not found in this tenant." }, { status: 409 });
    if (code === "POSITION_NOT_OPEN") return Response.json({ error: "The requisition position is not open for hiring." }, { status: 409 });
    if (code === "POSITION_REQUISITION_CONFLICT") return Response.json({ error: "Another active requisition already owns this position." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The requisition changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "The requisition changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Requisition status transition failed", error);
    return Response.json({ error: "Requisition status could not be changed." }, { status: 500 });
  }
}
