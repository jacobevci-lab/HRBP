import {
  GoalStatus,
  LearningAssignmentStatus,
  LeaveRequestStatus,
  PlatformRole,
  PolicyAssignmentStatus,
  ReviewStatus,
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

export async function getEmployeeHomeData(ctx: RequestContext) {
  if (ctx.role !== PlatformRole.EMPLOYEE || !ctx.employmentId) return null;

  const employment = await db.employment.findFirst({
    where: { id: ctx.employmentId, tenantId: ctx.tenantId },
    select: {
      id: true,
      status: true,
      startDate: true,
      person: {
        select: {
          id: true,
          employeeNumber: true,
          givenName: true,
          familyName: true,
          workEmail: true
        }
      },
      position: {
        select: {
          title: true,
          orgUnit: { select: { name: true } }
        }
      },
      manager: {
        select: {
          person: { select: { givenName: true, familyName: true } }
        }
      }
    }
  });
  if (!employment) return null;

  const now = new Date();
  const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Europe/Istanbul" }).format(now));

  const [balances, pendingLeave, nextLeave, reviews, goals, learning, serviceOpen, policiesPending] = await Promise.all([
    db.leaveBalance.findMany({
      where: { tenantId: ctx.tenantId, employmentId: ctx.employmentId, periodYear: year },
      orderBy: { leaveType: { name: "asc" } },
      take: 12,
      select: {
        opening: true,
        accrued: true,
        used: true,
        adjustment: true,
        leaveType: { select: { code: true, name: true, unit: true } }
      }
    }),
    db.leaveRequest.count({
      where: { tenantId: ctx.tenantId, employmentId: ctx.employmentId, status: LeaveRequestStatus.PENDING }
    }),
    db.leaveRequest.findFirst({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: LeaveRequestStatus.APPROVED,
        startsAt: { gte: now }
      },
      orderBy: { startsAt: "asc" },
      select: {
        startsAt: true,
        endsAt: true,
        units: true,
        leaveType: { select: { name: true, unit: true } }
      }
    }),
    db.performanceReview.count({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: { in: [ReviewStatus.NOT_STARTED, ReviewStatus.SELF_REVIEW] }
      }
    }),
    db.goal.count({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: { in: [GoalStatus.ACTIVE, GoalStatus.AT_RISK] }
      }
    }),
    db.learningAssignment.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE] }
      },
      orderBy: [{ status: "desc" }, { dueAt: "asc" }],
      take: 10,
      select: {
        id: true,
        status: true,
        dueAt: true,
        course: { select: { title: true, mandatory: true } }
      }
    }),
    db.hRServiceRequest.count({
      where: { tenantId: ctx.tenantId, requestorId: ctx.actorId, status: { in: openServiceStatuses } }
    }),
    db.policyAssignment.count({
      where: {
        tenantId: ctx.tenantId,
        employmentId: ctx.employmentId,
        status: { in: [PolicyAssignmentStatus.PENDING, PolicyAssignmentStatus.OVERDUE] }
      }
    })
  ]);

  const leaveBalances = balances.map((item) => ({
    code: item.leaveType.code,
    name: item.leaveType.name,
    unit: item.leaveType.unit,
    available: Number(item.opening) + Number(item.accrued) + Number(item.adjustment) - Number(item.used)
  }));

  return {
    employee: {
      personId: employment.person.id,
      employeeNumber: employment.person.employeeNumber ?? "—",
      name: `${employment.person.givenName} ${employment.person.familyName}`,
      email: employment.person.workEmail ?? "—",
      position: employment.position?.title ?? "Unassigned",
      organization: employment.position?.orgUnit.name ?? "Unassigned",
      manager: employment.manager ? `${employment.manager.person.givenName} ${employment.manager.person.familyName}` : null,
      status: employment.status,
      startDate: employment.startDate
    },
    leaveBalances,
    pendingLeave,
    nextLeave,
    selfReviews: reviews,
    activeGoals: goals,
    learningAttention: learning.filter((item) => item.status === LearningAssignmentStatus.OVERDUE).length,
    learning,
    serviceOpen,
    policiesPending
  };
}
