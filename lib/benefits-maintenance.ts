import { BenefitEnrollmentStatus, DataClassification, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import type { RequestContext } from "@/lib/request-context";
import { runtimeNumber } from "@/lib/runtime-env";

function systemContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:benefits-maintenance",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Scheduled benefit lifecycle maintenance"
  };
}

export async function runBenefitsMaintenance() {
  const now = new Date();
  const maxBatch = Math.min(1000, Math.max(25, Math.floor(runtimeNumber("HRBP_BENEFITS_EXPIRY_BATCH_SIZE", 200))));
  const plans = await db.benefitPlan.findMany({
    where: { active: true, effectiveTo: { not: null, lte: now } },
    orderBy: { effectiveTo: "asc" },
    take: maxBatch,
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      effectiveTo: true,
      enrollments: {
        where: { status: { in: [BenefitEnrollmentStatus.PENDING, BenefitEnrollmentStatus.ACTIVE, BenefitEnrollmentStatus.SUSPENDED] } },
        select: { id: true, status: true, effectiveFrom: true }
      }
    }
  });

  let expiredPlans = 0;
  let endedEnrollments = 0;
  let anomalousEnrollments = 0;
  let notificationsQueued = 0;

  for (const plan of plans) {
    const planEnd = plan.effectiveTo;
    if (!planEnd) continue;
    const result = await db.$transaction(async (tx) => {
      const changed = await tx.benefitPlan.updateMany({
        where: { id: plan.id, tenantId: plan.tenantId, active: true, effectiveTo: { lte: now } },
        data: { active: false }
      });
      if (changed.count !== 1) return { expired: false, ended: 0, anomalies: 0, notified: false };

      let ended = 0;
      let anomalies = 0;
      for (const enrollment of plan.enrollments) {
        if (enrollment.effectiveFrom > planEnd) {
          anomalies += 1;
          continue;
        }
        const enrollmentChanged = await tx.benefitEnrollment.updateMany({
          where: {
            id: enrollment.id,
            tenantId: plan.tenantId,
            status: enrollment.status
          },
          data: {
            status: BenefitEnrollmentStatus.ENDED,
            effectiveTo: planEnd
          }
        });
        if (enrollmentChanged.count !== 1) continue;
        ended += 1;
        await appendAudit(tx, systemContext(plan.tenantId), {
          action: "benefit-enrollment.ended-on-plan-expiry",
          resourceType: "BenefitEnrollment",
          resourceId: enrollment.id,
          classification: DataClassification.RESTRICTED,
          purpose: `Governing benefit plan ${plan.code} expired at ${planEnd.toISOString()}`
        });
      }

      await appendAudit(tx, systemContext(plan.tenantId), {
        action: "benefit-plan.expired",
        resourceType: "BenefitPlan",
        resourceId: plan.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: `Effective period ended at ${planEnd.toISOString()}; ${ended} open enrollments ended; ${anomalies} anomalous enrollments require review`
      });
      await enqueueNotificationOutbox(tx, {
        tenantId: plan.tenantId,
        eventType: "BENEFIT_PLAN_EXPIRED",
        recipientRole: PlatformRole.HR_OPERATIONS,
        templateKey: "benefits.plan-expired",
        resourceType: "BenefitPlan",
        resourceId: plan.id,
        dedupeKey: `benefit-plan:${plan.id}:expired:${planEnd.toISOString().slice(0, 10)}`,
        classification: DataClassification.CONFIDENTIAL,
        payload: {
          benefitPlanCode: plan.code,
          benefitPlanName: plan.name,
          benefitPlanEffectiveTo: planEnd.toISOString(),
          endedEnrollments: ended,
          anomalousEnrollments: anomalies
        }
      });
      return { expired: true, ended, anomalies, notified: true };
    });

    if (result.expired) expiredPlans += 1;
    endedEnrollments += result.ended;
    anomalousEnrollments += result.anomalies;
    if (result.notified) notificationsQueued += 1;
  }

  return {
    scanned: plans.length,
    expiredPlans,
    endedEnrollments,
    anomalousEnrollments,
    notificationsQueued,
    batchSize: maxBatch
  };
}
