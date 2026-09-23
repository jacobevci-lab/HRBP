import { PlatformRole, Prisma, PrismaClient } from "@prisma/client";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

const selfServiceRoles = new Set<PlatformRole>([
  PlatformRole.EMPLOYEE,
  PlatformRole.MANAGER
]);

export function isHRServiceSelfServiceRole(role: PlatformRole) {
  return selfServiceRoles.has(role);
}

export async function hrServiceRequestWhere(client: ScopeClient, ctx: RequestContext): Promise<Prisma.HRServiceRequestWhereInput> {
  if (isHRServiceSelfServiceRole(ctx.role)) {
    return { tenantId: ctx.tenantId, requestorId: ctx.actorId };
  }

  const scope = await resolveEmploymentScope(client, ctx);
  if (scope === null) return { tenantId: ctx.tenantId };

  return {
    tenantId: ctx.tenantId,
    OR: [
      { requestorId: ctx.actorId },
      { assigneeId: ctx.actorId },
      ...(scope.length ? [{ subjectEmploymentId: { in: scope } }] : [])
    ]
  };
}

export async function getAccessibleHRServiceRequest(client: ScopeClient, ctx: RequestContext, requestId: string) {
  const where = await hrServiceRequestWhere(client, ctx);
  return client.hRServiceRequest.findFirst({ where: { ...where, id: requestId } });
}
