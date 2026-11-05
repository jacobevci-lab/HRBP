import {
  EmploymentStatus,
  ExitTaskStatus,
  OnboardingStatus,
  OnboardingTaskStatus,
  PlatformRole,
  ScheduledPositionChangeStatus,
  SeparationStatus,
  ServicePriority,
  ServiceRequestStatus
} from "@prisma/client";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

const openServiceStatuses = [
  ServiceRequestStatus.OPEN,
  ServiceRequestStatus.TRIAGE,
  ServiceRequestStatus.IN_PROGRESS,
  ServiceRequestStatus.WAITING_EMPLOYEE,
  ServiceRequestStatus.WAITING_THIRD_PARTY
];

export async function getHROperationsHubData(ctx: RequestContext) {
  if (ctx.role !== PlatformRole.HR_OPERATIONS) return null;
  const now = new Date();
  const next14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [
    onboardingOpen,
    onboardingBlocked,
    onboardingOverdue,
    upcomingStarters,
    separationOpen,
    separationBlocked,
    serviceOpen,
    serviceBreached,
    serviceCritical,
    scheduledBlocked,
    missingPosition,
    missingWorkEmail
  ] = await Promise.all([
    db.onboardingPlan.count({
      where: { tenantId: ctx.tenantId, status: { in: [OnboardingStatus.NOT_STARTED, OnboardingStatus.IN_PROGRESS, OnboardingStatus.BLOCKED] } }
    }),
    db.onboardingTask.count({
      where: { tenantId: ctx.tenantId, status: OnboardingTaskStatus.BLOCKED }
    }),
    db.onboardingTask.count({
      where: {
        tenantId: ctx.tenantId,
        dueDate: { lt: now },
        status: { in: [OnboardingTaskStatus.NOT_STARTED, OnboardingTaskStatus.IN_PROGRESS, OnboardingTaskStatus.BLOCKED] }
      }
    }),
    db.onboardingPlan.count({
      where: {
        tenantId: ctx.tenantId,
        targetStartDate: { gte: now, lte: next14 },
        status: { in: [OnboardingStatus.NOT_STARTED, OnboardingStatus.IN_PROGRESS, OnboardingStatus.BLOCKED] }
      }
    }),
    db.separationProcess.count({
      where: { tenantId: ctx.tenantId, status: { notIn: [SeparationStatus.CLOSED, SeparationStatus.CANCELLED] } }
    }),
    db.separationTask.count({
      where: {
        tenantId: ctx.tenantId,
        blocking: true,
        OR: [
          { status: ExitTaskStatus.BLOCKED },
          {
            dueAt: { lt: now },
            status: { in: [ExitTaskStatus.NOT_STARTED, ExitTaskStatus.IN_PROGRESS] }
          }
        ]
      }
    }),
    db.hRServiceRequest.count({
      where: { tenantId: ctx.tenantId, status: { in: openServiceStatuses } }
    }),
    db.hRServiceRequest.count({
      where: { tenantId: ctx.tenantId, status: { in: openServiceStatuses }, slaDueAt: { lt: now } }
    }),
    db.hRServiceRequest.count({
      where: { tenantId: ctx.tenantId, status: { in: openServiceStatuses }, priority: ServicePriority.CRITICAL }
    }),
    db.scheduledPositionChange.count({
      where: { tenantId: ctx.tenantId, status: ScheduledPositionChangeStatus.BLOCKED }
    }),
    db.employment.count({
      where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED }, positionId: null }
    }),
    db.employment.count({
      where: { tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED }, person: { workEmail: null } }
    })
  ]);

  return {
    onboardingOpen,
    onboardingBlocked,
    onboardingOverdue,
    upcomingStarters,
    separationOpen,
    separationBlocked,
    serviceOpen,
    serviceBreached,
    serviceCritical,
    scheduledBlocked,
    missingPosition,
    missingWorkEmail,
    totalOperationalAttention:
      onboardingBlocked + onboardingOverdue + separationBlocked + serviceBreached + serviceCritical + scheduledBlocked + missingPosition + missingWorkEmail
  };
}
