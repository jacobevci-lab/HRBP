import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export async function getCaseWallCase(ctx: RequestContext, caseId: string) {
  return db.employeeCase.findFirst({
    where: {
      id: caseId,
      tenantId: ctx.tenantId,
      OR: [
        { ownerUserId: ctx.actorId },
        { assignments: { some: { user: { is: { tenantId: ctx.tenantId, subject: ctx.actorId, active: true } } } } }
      ]
    }
  });
}

export async function listCaseWallCases(ctx: RequestContext) {
  return db.employeeCase.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        { ownerUserId: ctx.actorId },
        { assignments: { some: { user: { is: { tenantId: ctx.tenantId, subject: ctx.actorId, active: true } } } } }
      ]
    },
    orderBy: { openedAt: "desc" },
    include: {
      subject: { select: { id: true, employeeNumber: true, givenName: true, familyName: true } },
      assignments: { select: { assignedAt: true, user: { select: { displayName: true, role: true, subject: true } } } }
    }
  });
}
