import {
  EmploymentStatus,
  GoalStatus,
  LearningAssignmentStatus,
  LeaveRequestStatus,
  PlatformRole,
  ReviewStatus,
  TimeEntryStatus
} from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

function countByEmployment(rows: Array<{ employmentId: string }>) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.employmentId, (counts.get(row.employmentId) ?? 0) + 1);
  return counts;
}

export async function getManagerHubData(ctx: RequestContext) {
  if (ctx.role !== PlatformRole.MANAGER || !ctx.employmentId) return null;

  const team = await db.employment.findMany({
    where: {
      tenantId: ctx.tenantId,
      managerEmploymentId: ctx.employmentId,
      status: { not: EmploymentStatus.TERMINATED }
    },
    orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
    take: 200,
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
          critical: true,
          orgUnit: { select: { name: true } }
        }
      }
    }
  });

  const employmentIds = team.map((item) => item.id);
  if (!employmentIds.length) {
    return {
      teamSize: 0,
      decisions: 0,
      atRiskGoals: 0,
      learningAttention: 0,
      attentionPeople: 0,
      rows: []
    };
  }

  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [leave, time, reviews, goals, learning] = await Promise.all([
    can(ctx, "leave:read") ? db.leaveRequest.findMany({
      where: { tenantId: ctx.tenantId, employmentId: { in: employmentIds }, status: LeaveRequestStatus.PENDING },
      select: { employmentId: true }
    }) : Promise.resolve([]),
    can(ctx, "time:read") ? db.timeEntry.findMany({
      where: { tenantId: ctx.tenantId, employmentId: { in: employmentIds }, status: TimeEntryStatus.SUBMITTED },
      select: { employmentId: true }
    }) : Promise.resolve([]),
    can(ctx, "performance:read") ? db.performanceReview.findMany({
      where: { tenantId: ctx.tenantId, employmentId: { in: employmentIds }, status: ReviewStatus.MANAGER_REVIEW },
      select: { employmentId: true }
    }) : Promise.resolve([]),
    can(ctx, "performance:read") ? db.goal.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: { in: employmentIds },
        OR: [
          { status: GoalStatus.AT_RISK },
          { status: GoalStatus.ACTIVE, dueAt: { lt: now } }
        ]
      },
      select: { employmentId: true }
    }) : Promise.resolve([]),
    can(ctx, "learning:read") ? db.learningAssignment.findMany({
      where: {
        tenantId: ctx.tenantId,
        employmentId: { in: employmentIds },
        OR: [
          { status: LearningAssignmentStatus.OVERDUE },
          {
            status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS] },
            dueAt: { not: null, lte: nextWeek }
          }
        ]
      },
      select: { employmentId: true }
    }) : Promise.resolve([])
  ]);

  const leaveCount = countByEmployment(leave);
  const timeCount = countByEmployment(time);
  const reviewCount = countByEmployment(reviews);
  const goalCount = countByEmployment(goals);
  const learningCount = countByEmployment(learning);

  const rows = team.map((item) => {
    const pendingLeave = leaveCount.get(item.id) ?? 0;
    const pendingTime = timeCount.get(item.id) ?? 0;
    const managerReviews = reviewCount.get(item.id) ?? 0;
    const goalsAtRisk = goalCount.get(item.id) ?? 0;
    const learningDue = learningCount.get(item.id) ?? 0;
    return {
      id: item.id,
      personId: item.person.id,
      employeeNumber: item.person.employeeNumber ?? "—",
      name: `${item.person.givenName} ${item.person.familyName}`,
      email: item.person.workEmail ?? "—",
      status: item.status,
      position: item.position?.title ?? "Unassigned",
      organization: item.position?.orgUnit.name ?? "Unassigned",
      criticalPosition: item.position?.critical ?? false,
      pendingLeave,
      pendingTime,
      managerReviews,
      goalsAtRisk,
      learningDue,
      attention: pendingLeave + pendingTime + managerReviews + goalsAtRisk + learningDue
    };
  });

  return {
    teamSize: team.length,
    decisions: leave.length + time.length + reviews.length,
    atRiskGoals: goals.length,
    learningAttention: learning.length,
    attentionPeople: rows.filter((item) => item.attention > 0).length,
    rows
  };
}
