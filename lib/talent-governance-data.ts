import { withDb } from "@/lib/db";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

export type TalentGovernanceRow = {
  id: string;
  employmentId: string;
  person: string;
  employeeNumber: string;
  position: string;
  organization: string;
  cycleLabel: string;
  performance: string;
  potential: string;
  criticalTalent: boolean;
  notes: string | null;
  assessor: string;
  assessedAt: string;
};

export type TalentGovernanceData = {
  cycleLabels: string[];
  rows: TalentGovernanceRow[];
};

export async function getTalentGovernanceData(ctx: RequestContext): Promise<TalentGovernanceData> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const assessments = await db.talentAssessment.findMany({
      where: { tenantId: ctx.tenantId, ...employmentIdFilter(scope) },
      orderBy: [{ assessedAt: "desc" }, { cycleLabel: "desc" }],
      take: 400,
      select: {
        id: true,
        employmentId: true,
        cycleLabel: true,
        performance: true,
        potential: true,
        criticalTalent: true,
        notes: true,
        assessedById: true,
        assessedAt: true
      }
    });

    const employmentIds = [...new Set(assessments.map((row) => row.employmentId))];
    const assessorIds = [...new Set(assessments.map((row) => row.assessedById))];
    const [employments, assessors] = await Promise.all([
      employmentIds.length ? db.employment.findMany({
        where: { tenantId: ctx.tenantId, id: { in: employmentIds } },
        select: {
          id: true,
          person: { select: { givenName: true, familyName: true, employeeNumber: true } },
          position: { select: { title: true, orgUnit: { select: { name: true } } } }
        }
      }) : [],
      assessorIds.length ? db.userAccount.findMany({
        where: { tenantId: ctx.tenantId, id: { in: assessorIds } },
        select: { id: true, displayName: true, email: true }
      }) : []
    ]);

    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));
    const assessorMap = new Map(assessors.map((assessor) => [assessor.id, assessor]));
    return {
      cycleLabels: [...new Set(assessments.map((row) => row.cycleLabel))],
      rows: assessments.map((row) => {
        const employment = employmentMap.get(row.employmentId);
        const assessor = assessorMap.get(row.assessedById);
        return {
          id: row.id,
          employmentId: row.employmentId,
          person: employment ? `${employment.person.givenName} ${employment.person.familyName}` : row.employmentId,
          employeeNumber: employment?.person.employeeNumber ?? "—",
          position: employment?.position?.title ?? "Unassigned",
          organization: employment?.position?.orgUnit.name ?? "Unassigned",
          cycleLabel: row.cycleLabel,
          performance: row.performance,
          potential: row.potential,
          criticalTalent: row.criticalTalent,
          notes: row.notes,
          assessor: assessor?.displayName ?? assessor?.email ?? row.assessedById,
          assessedAt: row.assessedAt.toISOString()
        };
      })
    };
  });
}
