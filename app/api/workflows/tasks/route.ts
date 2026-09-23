import { WorkflowInstanceStatus, WorkflowTaskStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();

  const scopes: Array<Record<string, unknown>> = [
    { assigneeId: ctx.actorId },
    { assigneeId: null, assigneeRole: ctx.role }
  ];
  if (can(ctx, "workflows:run")) scopes.push({ assigneeId: null, assigneeRole: null });

  const rows = await db.workflowTask.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: [WorkflowTaskStatus.READY, WorkflowTaskStatus.IN_PROGRESS] },
      instance: { status: { in: [WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.WAITING] } },
      OR: scopes
    },
    take: 200,
    select: {
      id: true,
      stepKey: true,
      name: true,
      assigneeId: true,
      assigneeRole: true,
      status: true,
      dueAt: true,
      startedAt: true,
      instance: {
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          status: true,
          startedAt: true,
          definition: { select: { key: true, name: true, version: true } }
        }
      }
    }
  });

  rows.sort((left, right) => {
    const leftDue = left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDue = right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return (left.startedAt?.getTime() ?? left.instance.startedAt.getTime()) - (right.startedAt?.getTime() ?? right.instance.startedAt.getTime());
  });

  const now = Date.now();
  const dueSoonCutoff = now + 24 * 60 * 60 * 1000;
  const overdue = rows.filter((row) => row.dueAt && row.dueAt.getTime() < now).length;
  const dueSoon = rows.filter((row) => row.dueAt && row.dueAt.getTime() >= now && row.dueAt.getTime() <= dueSoonCutoff).length;

  return Response.json({
    data: {
      items: rows,
      summary: { total: rows.length, overdue, dueSoon },
      generatedAt: new Date(now).toISOString()
    }
  }, { headers: { "cache-control": "no-store" } });
}
