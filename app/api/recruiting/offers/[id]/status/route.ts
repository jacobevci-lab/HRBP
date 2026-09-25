import { ApplicationStage, DataClassification, OfferStatus, Prisma, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
import { enqueueOfferApprovalNotification, enqueueOfferDecisionNotification } from "@/lib/recruiting-notifications";
import { canTransitionOffer, parseOfferStatus } from "@/lib/recruiting-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const OFFER_PIPELINE_STATUSES = new Set<OfferStatus>([
  OfferStatus.APPROVAL,
  OfferStatus.SENT,
  OfferStatus.ACCEPTED
]);
const OFFER_APPLICATION_STAGES = new Set<ApplicationStage>([
  ApplicationStage.INTERVIEW,
  ApplicationStage.ASSESSMENT,
  ApplicationStage.OFFER
]);
const offerApprovalDecisions = new Set<OfferStatus>([
  OfferStatus.DRAFT,
  OfferStatus.SENT,
  OfferStatus.WITHDRAWN
]);

function requiresApprovalAuthority(from: OfferStatus, to: OfferStatus) {
  return from === OfferStatus.APPROVAL && offerApprovalDecisions.has(to);
}

function decisionFor(next: OfferStatus): "APPROVED" | "RETURNED" | "WITHDRAWN" | null {
  if (next === OfferStatus.SENT) return "APPROVED";
  if (next === OfferStatus.DRAFT) return "RETURNED";
  if (next === OfferStatus.WITHDRAWN) return "WITHDRAWN";
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid offer id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = parseOfferStatus(body.status);
  if (!next) return Response.json({ error: "A valid offer status is required." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const current = await tx.offer.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          applicationId: true,
          currency: true,
          annualBase: true,
          startDate: true,
          application: {
            select: {
              stage: true,
              candidate: { select: { givenName: true, familyName: true } },
              requisition: { select: { title: true, status: true } }
            }
          }
        }
      });
      if (!current) throw new Error("OFFER_NOT_FOUND");
      if (!canTransitionOffer(current.status, next)) throw new Error("INVALID_TRANSITION");
      if (requiresApprovalAuthority(current.status, next) && !can(ctx, "recruiting:approve")) throw new Error("APPROVAL_AUTHORITY_REQUIRED");

      const now = new Date();
      if (OFFER_PIPELINE_STATUSES.has(next)) {
        if (!OFFER_APPLICATION_STAGES.has(current.application.stage)) throw new Error("APPLICATION_STAGE_INVALID");
        if (current.application.requisition.status !== RequisitionStatus.OPEN) throw new Error("REQUISITION_NOT_OPEN");
        if (current.expiresAt && current.expiresAt <= now) throw new Error("OFFER_EXPIRED");
      }

      const approvalDecision = requiresApprovalAuthority(current.status, next);
      const creatorAudit = approvalDecision ? await tx.auditEvent.findFirst({
        where: {
          tenantId: ctx.tenantId,
          resourceType: "Offer",
          resourceId: current.id,
          action: "OFFER_CREATED"
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { actorId: true }
      }) : null;

      if (current.status === OfferStatus.APPROVAL && next === OfferStatus.SENT && creatorAudit?.actorId === ctx.actorId) {
        throw new Error("SELF_APPROVAL_BLOCKED");
      }

      try {
        await tx.offer.update({
          where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
          data: { status: next }
        });
      } catch (error) {
        if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
        throw error;
      }

      if (OFFER_PIPELINE_STATUSES.has(next)) {
        const applicationUpdate = await tx.application.updateMany({
          where: { id: current.applicationId, tenantId: ctx.tenantId, stage: current.application.stage },
          data: { stage: ApplicationStage.OFFER }
        });
        if (applicationUpdate.count !== 1) throw new Error("STATE_CONFLICT");
      }

      await appendAudit(tx, ctx, {
        action: `OFFER_STATUS_${current.status}_TO_${next}`,
        resourceType: "Offer",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: approvalDecision ? "Independent candidate offer decision" : "Candidate offer lifecycle"
      });

      const candidateName = `${current.application.candidate.givenName} ${current.application.candidate.familyName}`;
      if (current.status === OfferStatus.DRAFT && next === OfferStatus.APPROVAL) {
        await enqueueOfferApprovalNotification(tx, {
          tenantId: ctx.tenantId,
          offerId: current.id,
          candidateName,
          requisitionTitle: current.application.requisition.title,
          currency: current.currency,
          annualBase: current.annualBase.toString(),
          startDate: current.startDate
        });
      }

      const decision = approvalDecision ? decisionFor(next) : null;
      if (decision && creatorAudit?.actorId) {
        await enqueueOfferDecisionNotification(tx, {
          tenantId: ctx.tenantId,
          recipientUserId: creatorAudit.actorId,
          offerId: current.id,
          candidateName,
          requisitionTitle: current.application.requisition.title,
          currency: current.currency,
          annualBase: current.annualBase.toString(),
          startDate: current.startDate,
          decision
        });
      }

      return { id: current.id, status: next };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "OFFER_NOT_FOUND") return Response.json({ error: "Offer was not found in this tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested offer-status transition is not allowed." }, { status: 409 });
    if (code === "APPROVAL_AUTHORITY_REQUIRED") return forbidden("Independent recruiting approval authority is required for this offer decision.");
    if (code === "SELF_APPROVAL_BLOCKED") return forbidden("The offer creator cannot approve and send the same offer.");
    if (code === "APPLICATION_STAGE_INVALID") return Response.json({ error: "The application is no longer in an offer-eligible stage." }, { status: 409 });
    if (code === "REQUISITION_NOT_OPEN") return Response.json({ error: "The requisition must be open before an offer can enter approval, be sent or be accepted." }, { status: 409 });
    if (code === "OFFER_EXPIRED") return Response.json({ error: "This offer is already past its expiry date." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The offer or application changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "The offer or application changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offer status transition failed", error);
    return Response.json({ error: "Offer status could not be changed." }, { status: 500 });
  }
}
