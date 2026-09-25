import { DataClassification, OfferStatus, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:recruiting-maintenance",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Scheduled recruiting lifecycle maintenance"
  };
}

export async function runRecruitingMaintenance(now = new Date()) {
  const maxBatch = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_RECRUITING_MAINTENANCE_BATCH_SIZE", 250))));
  const candidates = await db.offer.findMany({
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

  for (const candidate of candidates) {
    const changed = await db.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          status: OfferStatus.SENT,
          expiresAt: { not: null, lte: now }
        },
        data: { status: OfferStatus.EXPIRED }
      });
      if (updated.count !== 1) return { changed: false, notified: false };

      const creatorAudit = await tx.auditEvent.findFirst({
        where: {
          tenantId: candidate.tenantId,
          resourceType: "Offer",
          resourceId: candidate.id,
          action: "OFFER_CREATED"
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { actorId: true }
      });

      await appendAudit(tx, systemContext(candidate.tenantId), {
        action: "OFFER_STATUS_SENT_TO_EXPIRED",
        resourceType: "Offer",
        resourceId: candidate.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Automatic offer expiry at configured deadline"
      });

      const candidateName = `${candidate.application.candidate.givenName} ${candidate.application.candidate.familyName}`;
      await enqueueNotificationOutbox(tx, {
        tenantId: candidate.tenantId,
        eventType: "RECRUITING_OFFER_EXPIRED",
        ...(creatorAudit?.actorId ? { recipientUserId: creatorAudit.actorId } : { recipientRole: "RECRUITER" }),
        templateKey: "recruiting.offer-expired",
        resourceType: "Offer",
        resourceId: candidate.id,
        dedupeKey: `offer:${candidate.id}:expired`,
        classification: DataClassification.RESTRICTED,
        payload: {
          recruitingRecordType: "OFFER",
          recruitingTitle: candidate.application.requisition.title,
          recruitingCandidateName: candidateName,
          recruitingCurrency: candidate.currency,
          recruitingAnnualBase: candidate.annualBase.toString(),
          recruitingStartDate: candidate.startDate.toISOString(),
          recruitingExpiresAt: candidate.expiresAt?.toISOString() ?? now.toISOString(),
          recruitingDecision: "EXPIRED"
        }
      });

      return { changed: true, notified: true };
    });

    if (changed.changed) expiredOffers += 1;
    if (changed.notified) notificationsQueued += 1;
  }

  return { scanned: candidates.length, expiredOffers, notificationsQueued };
}
