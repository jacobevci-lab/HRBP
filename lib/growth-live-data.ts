import {
  BenefitEnrollmentStatus,
  EmploymentStatus,
  GoalStatus,
  LearningAssignmentStatus,
  PerformanceBand,
  PotentialBand,
  ReviewCycleStatus,
  ReviewStatus,
  SuccessionReadiness
} from "@prisma/client";
import { withDb } from "@/lib/db";

function enumLabel(value: string) {
  return value.toLowerCase().split("_").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" }).format(value);
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

export async function getBenefitsGrowthData(tenantId: string) {
  return withDb(async (db) => {
    const [plans, activeEmployments] = await Promise.all([
      db.benefitPlan.findMany({
        where: { tenantId, active: true },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        take: 100,
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          provider: true,
          countryCode: true,
          currency: true,
          employerContribution: true,
          employeeContribution: true,
          enrollments: {
            where: { status: { in: [BenefitEnrollmentStatus.ACTIVE, BenefitEnrollmentStatus.PENDING] } },
            select: { status: true, employerContribution: true, employeeContribution: true }
          }
        }
      }),
      db.employment.count({ where: { tenantId, status: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.LEAVE] } } })
    ]);

    const rows = plans.map((plan) => {
      const active = plan.enrollments.filter((enrollment) => enrollment.status === BenefitEnrollmentStatus.ACTIVE);
      const pending = plan.enrollments.filter((enrollment) => enrollment.status === BenefitEnrollmentStatus.PENDING).length;
      const employerCost = active.reduce((sum, enrollment) => sum + Number(enrollment.employerContribution ?? plan.employerContribution ?? 0), 0);
      return {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        type: enumLabel(plan.type),
        provider: plan.provider ?? "—",
        country: plan.countryCode ?? "Global",
        enrolled: active.length,
        pending,
        coverage: percent(active.length, activeEmployments),
        currency: plan.currency ?? "—",
        employerCost
      };
    });

    const activeEnrollments = rows.reduce((sum, row) => sum + row.enrolled, 0);
    const pendingEnrollments = rows.reduce((sum, row) => sum + row.pending, 0);
    return { activeEmployments, activePlans: rows.length, activeEnrollments, pendingEnrollments, rows };
  });
}

export async function getPerformanceGrowthData(tenantId: string) {
  return withDb(async (db) => {
    const [cycles, reviews, goals] = await Promise.all([
      db.reviewCycle.findMany({ where: { tenantId }, orderBy: { endsAt: "desc" }, take: 20, select: { id: true, name: true, status: true, startsAt: true, endsAt: true } }),
      db.performanceReview.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" }, take: 500, select: { id: true, cycleId: true, employmentId: true, status: true, finalRating: true, updatedAt: true } }),
      db.goal.findMany({ where: { tenantId }, orderBy: { dueAt: "asc" }, take: 500, select: { id: true, employmentId: true, title: true, progress: true, status: true, dueAt: true } })
    ]);

    const activeCycle = cycles.find((cycle) => cycle.status === ReviewCycleStatus.OPEN || cycle.status === ReviewCycleStatus.CALIBRATION) ?? cycles[0] ?? null;
    const cycleReviews = activeCycle ? reviews.filter((review) => review.cycleId === activeCycle.id) : [];
    const employmentIds = [...new Set([...cycleReviews.map((review) => review.employmentId), ...goals.map((goal) => goal.employmentId)])];
    const employments = employmentIds.length ? await db.employment.findMany({
      where: { tenantId, id: { in: employmentIds } },
      select: { id: true, person: { select: { givenName: true, familyName: true } }, position: { select: { orgUnit: { select: { name: true } } } } }
    }) : [];
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));

    const orgMap = new Map<string, { people: Set<string>; finalized: number; calibration: number; atRiskGoals: number }>();
    for (const review of cycleReviews) {
      const employment = employmentMap.get(review.employmentId);
      const org = employment?.position?.orgUnit.name ?? "Unassigned";
      const current = orgMap.get(org) ?? { people: new Set<string>(), finalized: 0, calibration: 0, atRiskGoals: 0 };
      current.people.add(review.employmentId);
      if (review.status === ReviewStatus.FINALIZED) current.finalized += 1;
      if (review.status === ReviewStatus.CALIBRATION) current.calibration += 1;
      orgMap.set(org, current);
    }
    for (const goal of goals.filter((goal) => goal.status === GoalStatus.AT_RISK)) {
      const employment = employmentMap.get(goal.employmentId);
      const org = employment?.position?.orgUnit.name ?? "Unassigned";
      const current = orgMap.get(org) ?? { people: new Set<string>(), finalized: 0, calibration: 0, atRiskGoals: 0 };
      current.people.add(goal.employmentId);
      current.atRiskGoals += 1;
      orgMap.set(org, current);
    }

    const finalized = cycleReviews.filter((review) => review.status === ReviewStatus.FINALIZED).length;
    return {
      activeCycle: activeCycle ? { id: activeCycle.id, name: activeCycle.name, status: enumLabel(activeCycle.status), startsAt: formatDate(activeCycle.startsAt), endsAt: formatDate(activeCycle.endsAt) } : null,
      reviewCount: cycleReviews.length,
      finalized,
      completion: percent(finalized, cycleReviews.length),
      calibrationQueue: cycleReviews.filter((review) => review.status === ReviewStatus.CALIBRATION).length,
      goalsAtRisk: goals.filter((goal) => goal.status === GoalStatus.AT_RISK).length,
      orgRows: [...orgMap.entries()].map(([organization, stats]) => ({ organization, people: stats.people.size, complete: percent(stats.finalized, stats.people.size), atRiskGoals: stats.atRiskGoals, calibration: stats.calibration })).sort((a, b) => b.people - a.people),
      goals: goals.slice(0, 12).map((goal) => {
        const employment = employmentMap.get(goal.employmentId);
        return { id: goal.id, person: employment ? `${employment.person.givenName} ${employment.person.familyName}` : goal.employmentId, title: goal.title, progress: goal.progress, status: enumLabel(goal.status), dueAt: formatDate(goal.dueAt) };
      })
    };
  });
}

export async function getTalentGrowthData(tenantId: string) {
  return withDb(async (db) => {
    const assessments = await db.talentAssessment.findMany({ where: { tenantId }, orderBy: { assessedAt: "desc" }, take: 500, select: { id: true, employmentId: true, cycleLabel: true, performance: true, potential: true, criticalTalent: true, assessedAt: true } });
    const cycleLabel = assessments[0]?.cycleLabel ?? null;
    const rows = cycleLabel ? assessments.filter((row) => row.cycleLabel === cycleLabel) : [];
    const employmentIds = [...new Set(rows.map((row) => row.employmentId))];
    const employments = employmentIds.length ? await db.employment.findMany({ where: { tenantId, id: { in: employmentIds } }, select: { id: true, person: { select: { givenName: true, familyName: true } }, position: { select: { title: true, orgUnit: { select: { name: true } } } } } }) : [];
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));
    const potentials: PotentialBand[] = [PotentialBand.HIGH, PotentialBand.MODERATE, PotentialBand.LIMITED];
    const performances: PerformanceBand[] = [PerformanceBand.NEEDS_IMPROVEMENT, PerformanceBand.DEVELOPING, PerformanceBand.MEETS, PerformanceBand.EXCEEDS, PerformanceBand.OUTSTANDING];
    return {
      cycleLabel,
      reviewed: rows.length,
      highPotential: rows.filter((row) => row.potential === PotentialBand.HIGH).length,
      criticalTalent: rows.filter((row) => row.criticalTalent).length,
      matrix: potentials.map((potential) => ({ potential: enumLabel(potential), cells: performances.map((performance) => ({ performance: enumLabel(performance), count: rows.filter((row) => row.potential === potential && row.performance === performance).length })) })),
      rows: rows.slice(0, 15).map((row) => {
        const employment = employmentMap.get(row.employmentId);
        return { id: row.id, person: employment ? `${employment.person.givenName} ${employment.person.familyName}` : row.employmentId, position: employment?.position?.title ?? "Unassigned", organization: employment?.position?.orgUnit.name ?? "Unassigned", performance: enumLabel(row.performance), potential: enumLabel(row.potential), criticalTalent: row.criticalTalent, assessedAt: formatDate(row.assessedAt) };
      })
    };
  });
}

export async function getSuccessionGrowthData(tenantId: string) {
  return withDb(async (db) => {
    const plans = await db.successionPlan.findMany({ where: { tenantId, active: true }, orderBy: { reviewDueAt: "asc" }, take: 200, select: { id: true, positionId: true, name: true, reviewDueAt: true, candidates: { select: { employmentId: true, readiness: true, rank: true } } } });
    const positionIds = [...new Set(plans.map((plan) => plan.positionId))];
    const positions = positionIds.length ? await db.position.findMany({ where: { tenantId, id: { in: positionIds } }, select: { id: true, positionCode: true, title: true, critical: true, orgUnit: { select: { name: true } } } }) : [];
    const positionMap = new Map(positions.map((position) => [position.id, position]));
    const allCandidates = plans.flatMap((plan) => plan.candidates);
    return {
      criticalPositions: positions.filter((position) => position.critical).length,
      plans: plans.length,
      covered: plans.filter((plan) => plan.candidates.length > 0).length,
      readyNow: allCandidates.filter((candidate) => candidate.readiness === SuccessionReadiness.READY_NOW).length,
      gaps: plans.filter((plan) => plan.candidates.length === 0).length,
      readiness: Object.values(SuccessionReadiness).map((value) => ({ label: enumLabel(value), count: allCandidates.filter((candidate) => candidate.readiness === value).length })),
      rows: plans.map((plan) => {
        const position = positionMap.get(plan.positionId);
        return { id: plan.id, position: position?.title ?? plan.name ?? plan.positionId, positionCode: position?.positionCode ?? "—", organization: position?.orgUnit.name ?? "Unassigned", critical: position?.critical ?? false, candidates: plan.candidates.length, readyNow: plan.candidates.filter((candidate) => candidate.readiness === SuccessionReadiness.READY_NOW).length, reviewDueAt: formatDate(plan.reviewDueAt) };
      })
    };
  });
}

export async function getLearningGrowthData(tenantId: string) {
  return withDb(async (db) => {
    const [courses, skills] = await Promise.all([
      db.learningCourse.findMany({ where: { tenantId, active: true }, orderBy: [{ mandatory: "desc" }, { title: "asc" }], take: 200, select: { id: true, code: true, title: true, provider: true, mandatory: true, assignments: { select: { status: true, dueAt: true } } } }),
      db.skill.findMany({ where: { tenantId, active: true }, orderBy: [{ critical: "desc" }, { name: "asc" }], take: 300, select: { id: true, code: true, name: true, category: true, critical: true, employments: { select: { proficiency: true } } } })
    ]);
    const today = new Date();
    const due30 = new Date(today); due30.setDate(due30.getDate() + 30);
    const assignments = courses.flatMap((course) => course.assignments);
    const mandatoryAssignments = courses.filter((course) => course.mandatory).flatMap((course) => course.assignments);
    const completedMandatory = mandatoryAssignments.filter((assignment) => assignment.status === LearningAssignmentStatus.COMPLETED || assignment.status === LearningAssignmentStatus.WAIVED).length;
    return {
      compliance: percent(completedMandatory, mandatoryAssignments.length),
      skillCount: skills.length,
      criticalSkills: skills.filter((skill) => skill.critical).length,
      overdue: assignments.filter((assignment) => assignment.status === LearningAssignmentStatus.OVERDUE).length,
      due30: assignments.filter((assignment) => assignment.dueAt && assignment.dueAt >= today && assignment.dueAt <= due30 && assignment.status !== LearningAssignmentStatus.COMPLETED && assignment.status !== LearningAssignmentStatus.WAIVED).length,
      courses: courses.map((course) => {
        const completed = course.assignments.filter((assignment) => assignment.status === LearningAssignmentStatus.COMPLETED || assignment.status === LearningAssignmentStatus.WAIVED).length;
        const dueDates = course.assignments.map((assignment) => assignment.dueAt).filter((value): value is Date => Boolean(value));
        return { id: course.id, code: course.code, title: course.title, provider: course.provider ?? "Internal", requirement: course.mandatory ? "Mandatory" : "Optional", assigned: course.assignments.length, completed, rate: percent(completed, course.assignments.length), dueAt: dueDates.length ? formatDate(new Date(Math.min(...dueDates.map((date) => date.getTime())))) : "—" };
      }),
      skills: skills.slice(0, 15).map((skill) => ({ id: skill.id, code: skill.code, name: skill.name, category: skill.category ?? "General", critical: skill.critical, assessed: skill.employments.length }))
    };
  });
}
