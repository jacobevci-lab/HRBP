import { Prisma } from "@prisma/client";
import { can } from "@/lib/authorization";
import type { RequestContext } from "@/lib/request-context";

export function hasTenantRecruitingVisibility(ctx: RequestContext) {
  return can(ctx, "recruiting:write");
}

export function recruitingRequisitionReadFilter(ctx: RequestContext): Prisma.RequisitionWhereInput {
  return hasTenantRecruitingVisibility(ctx)
    ? { tenantId: ctx.tenantId }
    : { tenantId: ctx.tenantId, hiringManagerId: ctx.actorId };
}

export function recruitingApplicationReadFilter(ctx: RequestContext): Prisma.ApplicationWhereInput {
  return hasTenantRecruitingVisibility(ctx)
    ? { tenantId: ctx.tenantId }
    : { tenantId: ctx.tenantId, requisition: { hiringManagerId: ctx.actorId } };
}

export function recruitingCandidateReadFilter(ctx: RequestContext): Prisma.CandidateWhereInput {
  return hasTenantRecruitingVisibility(ctx)
    ? { tenantId: ctx.tenantId }
    : {
        tenantId: ctx.tenantId,
        applications: { some: { requisition: { hiringManagerId: ctx.actorId } } }
      };
}

export function recruitingApplicationRelationFilter(ctx: RequestContext): Prisma.ApplicationWhereInput {
  return hasTenantRecruitingVisibility(ctx) ? {} : { requisition: { hiringManagerId: ctx.actorId } };
}

export function canAccessRecruitingRequisition(ctx: RequestContext, requisition: { hiringManagerId: string | null }) {
  return hasTenantRecruitingVisibility(ctx) || requisition.hiringManagerId === ctx.actorId;
}
