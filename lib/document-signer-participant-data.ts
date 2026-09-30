import {
  SignatureEnvelopeStatus,
  SignatureParticipantStatus,
  VaultScanStatus
} from "@prisma/client";
import { db } from "@/lib/db";
import { documentVisibilityWhere } from "@/lib/document-access";
import { asIdentifier } from "@/lib/input-validation";
import type { RequestContext } from "@/lib/request-context";

export type DocumentSignerParticipantData = {
  participantId: string;
  envelopeId: string;
  documentId: string;
  documentName: string;
  envelopeTitle: string;
  envelopeStatus: string;
  participantStatus: string;
  signingOrder: number;
  expiresAt: string | null;
  documentVersion: number;
  createdAt: string;
  actionable: boolean;
  blockedByEarlierSigner: boolean;
};

export async function getDocumentSignerParticipantData(
  ctx: RequestContext,
  rawParticipantId: string
): Promise<DocumentSignerParticipantData | null> {
  if (!ctx.employmentId) return null;
  const participantId = asIdentifier(rawParticipantId);
  if (!participantId) return null;

  const participant = await db.signatureParticipant.findFirst({
    where: {
      id: participantId,
      tenantId: ctx.tenantId,
      employmentId: ctx.employmentId
    },
    select: {
      id: true,
      signingOrder: true,
      status: true,
      envelope: {
        select: {
          id: true,
          documentId: true,
          title: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          documentVersion: {
            select: { version: true, scanStatus: true, uploadedAt: true }
          },
          participants: {
            orderBy: [{ signingOrder: "asc" }, { id: "asc" }],
            take: 100,
            select: { id: true, signingOrder: true, status: true }
          }
        }
      }
    }
  });
  if (!participant) return null;

  const visibility = await documentVisibilityWhere(db, ctx);
  const document = await db.documentRecord.findFirst({
    where: { AND: [visibility, { id: participant.envelope.documentId }] },
    select: { id: true, fileName: true }
  });
  if (!document) return null;

  const blockedByEarlierSigner = participant.envelope.participants.some((entry) =>
    entry.signingOrder < participant.signingOrder && entry.status !== SignatureParticipantStatus.SIGNED
  );
  const expired = Boolean(participant.envelope.expiresAt && participant.envelope.expiresAt.getTime() <= Date.now());
  const versionReady = Boolean(
    participant.envelope.documentVersion
    && participant.envelope.documentVersion.scanStatus === VaultScanStatus.CLEAN
    && participant.envelope.documentVersion.uploadedAt
  );
  const envelopeActionable = participant.envelope.status === SignatureEnvelopeStatus.SENT
    || participant.envelope.status === SignatureEnvelopeStatus.IN_PROGRESS;
  const participantActionable = participant.status === SignatureParticipantStatus.PENDING
    || participant.status === SignatureParticipantStatus.VIEWED;
  const actionable = envelopeActionable && participantActionable && !blockedByEarlierSigner && !expired && versionReady;

  return {
    participantId: participant.id,
    envelopeId: participant.envelope.id,
    documentId: document.id,
    documentName: document.fileName,
    envelopeTitle: participant.envelope.title,
    envelopeStatus: participant.envelope.status,
    participantStatus: participant.status,
    signingOrder: participant.signingOrder,
    expiresAt: participant.envelope.expiresAt?.toISOString() ?? null,
    documentVersion: participant.envelope.documentVersion?.version ?? 0,
    createdAt: participant.envelope.createdAt.toISOString(),
    actionable,
    blockedByEarlierSigner
  };
}
