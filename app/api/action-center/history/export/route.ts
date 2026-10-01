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
  "workflow.task-"
];

function daysFrom(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("days") ?? 30);
  return Number.isFinite(value) ? Math.min(90, Math.max(1, Math.floor(value))) : 30;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
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
    take: 500,
    select: {
      occurredAt: true,
      action: true,
      resourceType: true,
      resourceId: true,
      classification: true
    }
  });

  const lines = [
    ["occurredAt", "action", "resourceType", "resourceId", "classification"].map(csvCell).join(","),
    ...rows.map((row) => [
      row.occurredAt.toISOString(),
      row.action,
      row.resourceType,
      row.resourceId,
      row.classification
    ].map(csvCell).join(","))
  ];

  const date = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="hrbp-my-decision-evidence-${date}.csv"`,
      "cache-control": "no-store"
    }
  });
}
