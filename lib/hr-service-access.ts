import { PlatformRole, Prisma, PrismaClient } from "@prisma/client";
import { resolveEmploymentScope } from "@/lib/employment-scope";
import type { RequestContext } from "@/lib/request-context";

type ScopeClient = PrismaClient | Prisma.TransactionClient;

const selfServiceRoles = new Set<PlatformRole>([
  PlatformRole.EMPLOYEE,
  PlatformRole.MANAGER
]);

const serviceStaffRoles = new Set<PlatformRole>([
  PlatformRole.HRBP,
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TENANT_ADMIN
]);

const queueAdminRoles = new Set<PlatformRole>([
  PlatformRole.HR_OPERATIONS,
  PlatformRole.TENANT_ADMIN
]);

export function isHRServiceSelfServiceRole(role: PlatformRole) {
  return selfServiceRoles.has(role);
}

export function isHRServiceStaffRole(role: PlatformRole) {
  return serviceStaffRoles.has(role);
}

export function canManageHRServiceQueues(ctx: RequestContext) {
  return queueAdminRoles.has(ctx.role);
}

export async function visibleHRServiceQueueKeys(client: ScopeClient, ctx: RequestContext): Promise<string[] | null> {
  if (canManageHRServiceQueues(ctx)) return null;
  if (isHRServiceSelfServiceRole(ctx.role)) return [];
  const memberships = await client.hRServiceQueueMembership.findMany({
    where: { tenantId: ctx.tenantId, userId: ctx.actorId, queue: { is: { active: true } } },
    select: { queue: { select: { key: true } } }
  });
  return [...new Set(memberships.map((membership) => membership.queue.key))];
}

export async function canUseHRServiceQueue(client: ScopeClient, ctx: RequestContext, key: string) {
  const queue = await client.hRServiceQueue.findFirst({
    where: { tenantId: ctx.tenantId, key, active: true },
    select: { id: true, key: true, defaultSlaMinutes: true }
  });
  if (!queue) return null;
  if (canManageHRServiceQueues(ctx)) return queue;
  const membership = await client.hRServiceQueueMembership.findFirst({
    where: { tenantId: ctx.tenantId, queueId: queue.id, userId: ctx.actorId },
    select: { id: true }
  });
  return membership ? queue : null;
}

export async function hrServiceRequestWhere(client: ScopeClient, ctx: RequestContext): Promise<Prisma.HRServiceRequestWhereInput> {
  if (isHRServiceSelfServiceRole(ctx.role)) {
    return { tenantId: ctx.tenantId, requestorId: ctx.actorId };
  }

  const [scope, queueKeys] = await Promise.all([
    resolveEmploymentScope(client, ctx),
    visibleHRServiceQueueKeys(client, ctx)
  ]);
  if (scope === null) return { tenantId: ctx.tenantId };

  return {
    tenantId: ctx.tenantId,
    OR: [
      { requestorId: ctx.actorId },
      { assigneeId: ctx.actorId },
      ...(scope.length ? [{ subjectEmploymentId: { in: scope } }] : []),
      ...(queueKeys?.length ? [{ queue: { in: queueKeys } }] : [])
    ]
  };
}

export async function getAccessibleHRServiceRequest(client: ScopeClient, ctx: RequestContext, requestId: string) {
  const where = await hrServiceRequestWhere(client, ctx);
  return client.hRServiceRequest.findFirst({ where: { AND: [where, { id: requestId }] } });
}
