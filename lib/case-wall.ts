import { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

type CaseWallClient = PrismaClient | Prisma.TransactionClient;

export async function getCaseWallCase(ctx: RequestContext, caseId: string, client: CaseWallClient = db) {
  return client.employeeCase.findFirst({
    where: {
      id: caseId,
      tenantId: ctx.tenantId,
      OR: [
        { ownerUserId: ctx.actorId },
        { assignments: { some: { user: { is: { id: ctx.actorId, tenantId: ctx.tenantId, active: true } } } } }
      ]
    }
  });
}

export async function listCaseWallCases(ctx: RequestContext, client: CaseWallClient = db) {
  return client.employeeCase.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        { ownerUserId: ctx.actorId },
        { assignments: { some: { user: { is: { id: ctx.actorId, tenantId: ctx.tenantId, active: true } } } } }
      ]
    },
    orderBy: { openedAt: "desc" },
    include: {
      subject: { select: { id: true, employeeNumber: true, givenName: true, familyName: true } },
      assignments: { select: { assignedAt: true, user: { select: { displayName: true, role: true, subject: true } } } }
    }
  });
}
