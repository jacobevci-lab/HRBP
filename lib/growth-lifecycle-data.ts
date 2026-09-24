import { BenefitEnrollmentStatus, LearningAssignmentStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type BenefitEnrollmentOperation = {
  id: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  plan: string;
  planCode: string;
  status: string;
  coverageTier: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type LearningAssignmentOperation = {
  id: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  course: string;
  courseCode: string;
  mandatory: boolean;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  score: string | null;
};

async function employmentNames(ctx: RequestContext, ids: string[]) {
  if (!ids.length) return new Map<string, { person: string; employeeNumber: string }>();
  return withDb(async (db) => {
    const rows = await db.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ids } },
      select: { id: true, person: { select: { givenName: true, familyName: true, employeeNumber: true } } }
    });
    return new Map(rows.map((employment) => [employment.id, {
      person: `${employment.person.givenName} ${employment.person.familyName}`,
      employeeNumber: employment.person.employeeNumber ?? "—"
    }]));
  });
}

export async function getBenefitEnrollmentOperationsData(ctx: RequestContext): Promise<BenefitEnrollmentOperation[]> {
  const rows = await withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    return db.benefitEnrollment.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: [BenefitEnrollmentStatus.PENDING, BenefitEnrollmentStatus.ACTIVE, BenefitEnrollmentStatus.SUSPENDED] },
        ...employmentIdFilter(scope)
      },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: 150,
      select: {
        id: true,
        employmentId: true,
        status: true,
        coverageTier: true,
        effectiveFrom: true,
        effectiveTo: true,
        benefitPlan: { select: { code: true, name: true } }
      }
    });
  });
  const names = await employmentNames(ctx, [...new Set(rows.map((row) => row.employmentId))]);
  return rows.map((row) => ({
    id: row.id,
    employmentId: row.employmentId,
    person: names.get(row.employmentId)?.person ?? row.employmentId,
    employeeNumber: names.get(row.employmentId)?.employeeNumber ?? "—",
    plan: row.benefitPlan.name,
    planCode: row.benefitPlan.code,
    status: row.status,
    coverageTier: row.coverageTier ?? "—",
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null
  }));
}

export async function getLearningAssignmentOperationsData(ctx: RequestContext): Promise<LearningAssignmentOperation[]> {
  const rows = await withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    return db.learningAssignment.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: [LearningAssignmentStatus.ASSIGNED, LearningAssignmentStatus.IN_PROGRESS, LearningAssignmentStatus.OVERDUE] },
        ...employmentIdFilter(scope)
      },
      orderBy: [{ dueAt: "asc" }, { assignedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        employmentId: true,
        status: true,
        dueAt: true,
        completedAt: true,
        score: true,
        course: { select: { code: true, title: true, mandatory: true } }
      }
    });
  });
  const names = await employmentNames(ctx, [...new Set(rows.map((row) => row.employmentId))]);
  return rows.map((row) => ({
    id: row.id,
    employmentId: row.employmentId,
    person: names.get(row.employmentId)?.person ?? row.employmentId,
    employeeNumber: names.get(row.employmentId)?.employeeNumber ?? "—",
    course: row.course.title,
    courseCode: row.course.code,
    mandatory: row.course.mandatory,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    score: row.score?.toString() ?? null
  }));
}
