import {
  DataClassification,
  Prisma,
  SignatureEnvelopeStatus,
  SignatureParticipantStatus,
  VaultScanStatus
} from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getVisibleDocument } from "@/lib/document-access";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const decisions = [SignatureParticipantStatus.SIGNED, SignatureParticipantStatus.DECLINED] as const;
const actionableParticipantStatuses = [SignatureParticipantStatus.PENDING, SignatureParticipantStatus.VIEWED];
const actionableEnvelopeStatuses = [SignatureEnvelopeStatus.SENT, SignatureEnvelopeStatus.IN_PROGRESS];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; envelopeId: string; participantId: string }> }
) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:read")) return forbidden();
  if (!ctx.employmentId) return forbidden("A signed employment identity is required for participant signature actions.");

  const resolved = await params;
  const documentId = asIdentifier(resolved.id);
  const envelopeId = asIdentifier(resolved.envelopeId);
  const participantId = asIdentifier(resolved.participantId);
  if (!documentId || !envelopeId || !participantId) {
    return Response.json({ error: "Valid document, envelope and participant ids are required." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const decision = asEnumValue(body.decision, decisions);
  if (!decision) return Response.json({ error: "decision must be SIGNED or DECLINED." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const document = await getVisibleDocument(tx, ctx, documentId);
    if (!document) throw new Error("DOCUMENT");

    const envelope = await tx.signatureEnvelope.findFirst({
      where: {
        id: envelopeId,
        tenantId: ctx.tenantId,
        documentId,
        status: { in: actionableEnvelopeStatuses }
      },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        documentVersion: { select: { id: true, scanStatus: true, uploadedAt: true } },
        participants: {
          orderBy: [{ signingOrder: "asc" }, { id: "asc" }],
          take: 100,
          select: { id: true, employmentId: true, signingOrder: true, status: true }
        }
      }
    });
    if (!envelope) throw new Error("ENVELOPE");
    if (envelope.expiresAt && envelope.expiresAt.getTime() <= Date.now()) throw new Error("EXPIRED");
    if (!envelope.documentVersion || envelope.documentVersion.scanStatus !== VaultScanStatus.CLEAN || !envelope.documentVersion.uploadedAt) {
      throw new Error("VERSION");
    }

    const participant = envelope.participants.find((entry) => entry.id === participantId);
    if (!participant || participant.employmentId !== ctx.employmentId) throw new Error("PARTICIPANT");
    if (!actionableParticipantStatuses.includes(participant.status)) throw new Error("STATE");

    const blockedByEarlierSigner = envelope.participants.some((entry) =>
      entry.signingOrder < participant.signingOrder && entry.status !== SignatureParticipantStatus.SIGNED
    );
    if (blockedByEarlierSigner) throw new Error("ORDER");

    const now = new Date();
    const updated = await tx.signatureParticipant.updateMany({
      where: {
        id: participant.id,
        tenantId: ctx.tenantId,
        envelopeId: envelope.id,
        employmentId: ctx.employmentId,
        status: { in: actionableParticipantStatuses }
      },
      data: {
        status: decision,
        ...(decision === SignatureParticipantStatus.SIGNED ? { signedAt: now } : {})
      }
    });
    if (updated.count !== 1) throw new Error("STATE");

    const remainingUnsigned = decision === SignatureParticipantStatus.SIGNED
      ? await tx.signatureParticipant.count({
          where: {
            tenantId: ctx.tenantId,
            envelopeId: envelope.id,
            id: { not: participant.id },
            status: { not: SignatureParticipantStatus.SIGNED }
          }
        })
      : 1;

    const nextEnvelopeStatus = decision === SignatureParticipantStatus.DECLINED
      ? SignatureEnvelopeStatus.VOIDED
      : remainingUnsigned === 0
        ? SignatureEnvelopeStatus.COMPLETED
        : SignatureEnvelopeStatus.IN_PROGRESS;

    await tx.signatureEnvelope.updateMany({
      where: { id: envelope.id, tenantId: ctx.tenantId, status: { in: actionableEnvelopeStatuses } },
      data: {
        status: nextEnvelopeStatus,
        completedAt: nextEnvelopeStatus === SignatureEnvelopeStatus.COMPLETED ? now : null
      }
    });

    await tx.signatureEvent.create({
      data: {
        tenantId: ctx.tenantId,
        envelopeId: envelope.id,
        eventType: decision === SignatureParticipantStatus.SIGNED ? "participant.signed" : "participant.declined",
        actorId: ctx.actorId,
        ipAddress: ctx.ipAddress,
        metadata: { participantId: participant.id, signingOrder: participant.signingOrder }
      }
    });

    await appendAudit(tx, ctx, {
      action: decision === SignatureParticipantStatus.SIGNED ? "document.signature-participant-signed" : "document.signature-participant-declined",
      resourceType: "SignatureParticipant",
      resourceId: participant.id,
      classification: document.classification ?? DataClassification.RESTRICTED,
      purpose: `Human signature participant decision recorded for envelope ${envelope.id}`
    });

    return { participantId: participant.id, participantStatus: decision, envelopeStatus: nextEnvelopeStatus };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return "CONFLICT" as const;
    if (error instanceof Error && ["DOCUMENT", "ENVELOPE", "EXPIRED", "VERSION", "PARTICIPANT", "STATE", "ORDER"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "DOCUMENT") return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });
  if (result === "ENVELOPE") return Response.json({ error: "Signature envelope is not available or no longer actionable." }, { status: 409 });
  if (result === "EXPIRED") return Response.json({ error: "This signature envelope has expired and cannot accept a participant decision." }, { status: 409 });
  if (result === "VERSION") return Response.json({ error: "The immutable signed document version is not CLEAN and ready." }, { status: 409 });
  if (result === "PARTICIPANT") return forbidden("The signature participant is not bound to your signed employment identity.");
  if (result === "STATE") return Response.json({ error: "The signature participant is no longer actionable." }, { status: 409 });
  if (result === "ORDER") return Response.json({ error: "Earlier signing-order participants must sign before this participant can act." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Signature state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
