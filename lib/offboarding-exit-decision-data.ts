import { SeparationStatus } from "@prisma/client";
import { withDb } from "@/lib/db";
import { employmentIdFilter, employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

const OPEN_STATUSES: SeparationStatus[] = [SeparationStatus.DRAFT, SeparationStatus.NOTICE_PERIOD, SeparationStatus.CLEARANCE, SeparationStatus.FINAL_PAY_REVIEW, SeparationStatus.READY_TO_CLOSE];

function stringReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 10);
}

export type OffboardingExitDecisionRow = {
  processId: string;
  employmentId: string;
  employee: string;
  employeeNumber: string;
  lastWorkingDateIso: string;
  rehireEligible: boolean | null;
  rehireDecisionReason: string | null;
  rehireDecisionById: string | null;
  rehireDecisionAt: string | null;
  exitInterview: null | {
    id: string;
    interviewerId: string;
    conductedAt: string;
    reasons: string[];
    comments: string | null;
    wouldRecommend: boolean | null;
  };
};

export async function getOffboardingExitDecisionData(ctx: RequestContext): Promise<OffboardingExitDecisionRow[]> {
  return withDb(async (db) => {
    const scope = await resolveEmploymentScope(db, ctx);
    const processes = await db.separationProcess.findMany({
      where: { tenantId: ctx.tenantId, status: { in: OPEN_STATUSES }, ...employmentIdFilter(scope) },
      orderBy: [{ lastWorkingDate: "asc" }, { updatedAt: "desc" }],
      take: 150,
      select: {
        id: true,
        employmentId: true,
        lastWorkingDate: true,
        rehireEligible: true,
        rehireDecisionReason: true,
        rehireDecisionById: true,
        rehireDecisionAt: true,
        exitInterview: { select: { id: true, interviewerId: true, conductedAt: true, reasons: true, comments: true, wouldRecommend: true } }
      }
    });
    const employmentIds = [...new Set(processes.map((process) => process.employmentId))];
    const employments = employmentIds.length ? await db.employment.findMany({
      where: { tenantId: ctx.tenantId, id: { in: employmentIds }, ...employmentPrimaryKeyFilter(scope) },
      select: { id: true, person: { select: { employeeNumber: true, givenName: true, familyName: true } } }
    }) : [];
    const employmentMap = new Map(employments.map((employment) => [employment.id, employment]));
    return processes.map((process) => {
      const employment = employmentMap.get(process.employmentId);
      return {
        processId: process.id,
        employmentId: process.employmentId,
        employee: employment ? `${employment.person.givenName} ${employment.person.familyName}` : "Employment record",
        employeeNumber: employment?.person.employeeNumber ?? "—",
        lastWorkingDateIso: process.lastWorkingDate.toISOString(),
        rehireEligible: process.rehireEligible,
        rehireDecisionReason: process.rehireDecisionReason,
        rehireDecisionById: process.rehireDecisionById,
        rehireDecisionAt: process.rehireDecisionAt?.toISOString() ?? null,
        exitInterview: process.exitInterview ? {
          id: process.exitInterview.id,
          interviewerId: process.exitInterview.interviewerId,
          conductedAt: process.exitInterview.conductedAt.toISOString(),
          reasons: stringReasons(process.exitInterview.reasons),
          comments: process.exitInterview.comments,
          wouldRecommend: process.exitInterview.wouldRecommend
        } : null
      };
    });
  });
}
