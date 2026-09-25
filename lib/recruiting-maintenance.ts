import { ApplicationStage, DataClassification, OfferStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

const RETENTION_TERMINAL_STAGES = [ApplicationStage.REJECTED, ApplicationStage.WITHDRAWN];

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:recruiting-maintenance",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Scheduled recruiting lifecycle maintenance"
  };
}

async function expireSentOffers(now: Date, maxBatch: number) {
  const offers = await db.offer.findMany({
    where: {
      status: OfferStatus.SENT,
      expiresAt: { not: null, lte: now }
    },
    orderBy: { expiresAt: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      expiresAt: true,
      currency: true,
      annualBase: true,
      startDate: true,
      application: {
        select: {
          candidate: { select: { givenName: true, familyName: true } },
          requisition: { select: { title: true } }
        }
      }
    }
  });

  let expiredOffers = 0;
  let notificationsQueued = 0;

  for (const offer of offers) {
    const changed = await db.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: {
          id: offer.id,
          tenantId: offer.tenantId,
          status: OfferStatus.SENT,
          expiresAt: { not: null, lte: now }
        },
        data: { status: OfferStatus.EXPIRED }
      });
      if (updated.count !== 1) return { changed: false, notified: false };

      const creatorAudit = await tx.auditEvent.findFirst({
        where: {
          tenantId: offer.tenantId,
          resourceType: "Offer",
          resourceId: offer.id,
          action: "OFFER_CREATED"
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { actorId: true }
      });

      await appendAudit(tx, systemContext(offer.tenantId), {
        action: "OFFER_STATUS_SENT_TO_EXPIRED",
        resourceType: "Offer",
        resourceId: offer.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Automatic offer expiry at configured deadline"
      });

      const candidateName = `${offer.application.candidate.givenName} ${offer.application.candidate.familyName}`;
      await enqueueNotificationOutbox(tx, {
        tenantId: offer.tenantId,
        eventType: "RECRUITING_OFFER_EXPIRED",
        ...(creatorAudit?.actorId ? { recipientUserId: creatorAudit.actorId } : { recipientRole: "RECRUITER" }),
        templateKey: "recruiting.offer-expired",
        resourceType: "Offer",
        resourceId: offer.id,
        dedupeKey: `offer:${offer.id}:expired`,
        classification: DataClassification.RESTRICTED,
        payload: {
          recruitingRecordType: "OFFER",
          recruitingTitle: offer.application.requisition.title,
          recruitingCandidateName: candidateName,
          recruitingCurrency: offer.currency,
          recruitingAnnualBase: offer.annualBase.toString(),
          recruitingStartDate: offer.startDate.toISOString(),
          recruitingExpiresAt: offer.expiresAt?.toISOString() ?? now.toISOString(),
          recruitingDecision: "EXPIRED"
        }
      });

      return { changed: true, notified: true };
    });

    if (changed.changed) expiredOffers += 1;
    if (changed.notified) notificationsQueued += 1;
  }

  return { scanned: offers.length, expiredOffers, notificationsQueued };
}

async function eraseExpiredCandidatePii(now: Date, maxBatch: number) {
  const candidates = await db.candidate.findMany({
    where: {
      hiredPersonId: null,
      retentionUntil: { not: null, lte: now },
      applications: {
        every: { stage: { in: RETENTION_TERMINAL_STAGES } }
      }
    },
    orderBy: { retentionUntil: "asc" },
    take: maxBatch,
    select: { id: true, tenantId: true }
  });

  let erasedCandidates = 0;
  for (const candidate of candidates) {
    const changed = await db.$transaction(async (tx) => {
      const updated = await tx.candidate.updateMany({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          hiredPersonId: null,
          retentionUntil: { not: null, lte: now },
          applications: {
            every: { stage: { in: RETENTION_TERMINAL_STAGES } }
          }
        },
        data: {
          givenName: "Erased",
          familyName: "Candidate",
          email: `erased+${candidate.id}@retained.invalid`,
          phone: null,
          source: null,
          retentionUntil: null,
          classification: DataClassification.INTERNAL
        }
      });
      if (updated.count !== 1) return false;

      await appendAudit(tx, systemContext(candidate.tenantId), {
        action: "CANDIDATE_PII_ERASED_RETENTION",
        resourceType: "Candidate",
        resourceId: candidate.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Candidate retention period elapsed after all applications became terminal"
      });
      return true;
    });
    if (changed) erasedCandidates += 1;
  }

  return { scanned: candidates.length, erasedCandidates };
}

export async function runRecruitingMaintenance(now = new Date()) {
  const maxBatch = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_RECRUITING_MAINTENANCE_BATCH_SIZE", 250))));
  const offerExpiry = await expireSentOffers(now, maxBatch);
  const candidateRetention = await eraseExpiredCandidatePii(now, maxBatch);
  return { offerExpiry, candidateRetention };
}
