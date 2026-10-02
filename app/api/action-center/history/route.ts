import { getRequestContext, unauthorized } from "@/lib/request-context";
import { db } from "@/lib/db";

const actionPrefixes = [
  "leave-request.",
  "time-entry.",
  "COMPENSATION_CHANGE_",
  "payroll-run.",
  "REQUISITION_STATUS_",
  "OFFER_STATUS_",
  "policy.",
  "workforce-scenario.",
  "workflow-definition.",
  "engagement.campaign-",
  "privacy.dsr-",
  "privacy-assessment.",
  "hr-service.",
  "ONBOARDING_TASK_",
  "benefit-enrollment.transition.",
  "learning-assignment.self-transition.",
  "performance-review.self-started",
  "ONBOARDING_HANDOFF_",
  "offboarding.task-",
  "employee-case.corrective-action-",
  "workflow.task-"
];

function daysFrom(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("days") ?? 30);
  return Number.isFinite(value) ? Math.min(90, Math.max(1, Math.floor(value))) : 30;
}

function decisionHref(resourceType: string, resourceId: string) {
  const id = encodeURIComponent(resourceId);
  if (resourceType === "LeaveRequest") return `/module/leave?request=${id}`;
  if (resourceType === "TimeEntry") return `/module/time-attendance?entry=${id}`;
  if (resourceType === "CompensationChange") return `/module/compensation?change=${id}`;
  if (resourceType === "PayrollRun") return `/module/payroll?run=${id}`;
  if (resourceType === "Requisition") return `/module/recruiting?requisition=${id}`;
  if (resourceType === "Offer") return `/module/recruiting?offer=${id}`;
  if (resourceType === "PolicyRecord") return `/module/policies?policy=${id}`;
  if (resourceType === "WorkforceScenario") return `/module/workforce-planning?scenario=${id}`;
  if (resourceType === "WorkflowDefinition") return `/module/workflows?definition=${id}`;
  if (resourceType === "SurveyCampaign") return `/module/engagement?campaign=${id}`;
  if (resourceType === "DataSubjectRequest") return `/module/privacy?dsr=${id}`;
  if (resourceType === "PrivacyRiskAssessment") return `/module/privacy?assessment=${id}`;
  if (resourceType === "HRServiceRequest") return `/module/hr-service?request=${id}`;
  if (resourceType === "OnboardingTask") return `/module/onboarding?task=${id}`;
  if (resourceType === "BenefitEnrollment") return `/module/benefits?enrollment=${id}`;
  if (resourceType === "LearningAssignment") return `/module/learning?assignment=${id}`;
  if (resourceType === "PerformanceReview") return `/module/performance?review=${id}`;
  if (resourceType === "OnboardingPlan") return `/module/onboarding?plan=${id}`;
  if (resourceType === "SeparationTask") return `/module/offboarding?task=${id}`;
  if (resourceType === "CaseAction") return `/module/employee-relations?action=${id}`;
  if (resourceType === "WorkflowTask") return `/module/workflows?task=${id}`;
  return null;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();

  const days = daysFrom(request);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.auditEvent.findMany({
    where: {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      occurredAt: { gte: since },
      OR: actionPrefixes.map((prefix) => ({ action: { startsWith: prefix } }))
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 80,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      classification: true,
      occurredAt: true
    }
  });

  return Response.json({
    data: {
      days,
      items: rows.map((row) => ({
        ...row,
        href: decisionHref(row.resourceType, row.resourceId)
      }))
    }
  }, { headers: { "cache-control": "no-store" } });
}
