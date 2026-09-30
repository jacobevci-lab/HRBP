import { PolicyAssignmentStatus, PolicyExceptionStatus, PolicyStatus } from "@prisma/client";
import { can } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import type { RequestContext } from "@/lib/request-context";

export type PolicyLifecycleFocus = {
  policyId?: string;
  exceptionId?: string;
};

export type PolicyLifecycleFocusData =
  | {
      available: true;
      kind: "review";
      policy: { id: string; code: string; title: string; version: string; status: string; ownerId: string };
    }
  | {
      available: true;
      kind: "exception";
      policy: { id: string; code: string; title: string; version: string; status: string; ownerId: string };
      exception: { id: string; requestedById: string; status: string; expiresAt: string | null; createdAt: string };
    }
  | {
      available: true;
      kind: "acknowledgement";
      policy: { id: string; code: string; title: string; version: string; status: string; ownerId: string };
      assignment: { id: string; status: string; dueAt: string | null; assignedAt: string };
    }
  | { available: false };

export async function getPolicyLifecycleFocusData(ctx: RequestContext, focus: PolicyLifecycleFocus): Promise<PolicyLifecycleFocusData> {
  if (!can(ctx, "policies:read")) return { available: false };
  const policyId = focus.policyId ? asIdentifier(focus.policyId) : undefined;
  const exceptionId = focus.exceptionId ? asIdentifier(focus.exceptionId) : undefined;
  if (!policyId) return { available: false };
  if (focus.exceptionId && !exceptionId) return { available: false };

  if (exceptionId) {
    if (!can(ctx, "policies:approve")) return { available: false };
    const exception = await db.policyException.findFirst({
      where: {
        id: exceptionId,
        tenantId: ctx.tenantId,
        policyId,
        status: PolicyExceptionStatus.REQUESTED,
        requestedById: { not: ctx.actorId }
      },
      select: {
        id: true,
        requestedById: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        policy: { select: { id: true, code: true, title: true, version: true, status: true, ownerId: true } }
      }
    });
    if (!exception) return { available: false };
    return {
      available: true,
      kind: "exception",
      policy: { ...exception.policy, status: exception.policy.status.toString() },
      exception: {
        id: exception.id,
        requestedById: exception.requestedById,
        status: exception.status.toString(),
        expiresAt: exception.expiresAt?.toISOString() ?? null,
        createdAt: exception.createdAt.toISOString()
      }
    };
  }

  if (can(ctx, "policies:approve")) {
    const policy = await db.policyRecord.findFirst({
      where: {
        id: policyId,
        tenantId: ctx.tenantId,
        status: PolicyStatus.REVIEW,
        ownerId: { not: ctx.actorId }
      },
      select: { id: true, code: true, title: true, version: true, status: true, ownerId: true }
    });
    if (policy) {
      return {
        available: true,
        kind: "review",
        policy: { ...policy, status: policy.status.toString() }
      };
    }
  }

  if (can(ctx, "policies:acknowledge") && ctx.employmentId) {
    const now = new Date();
    const assignment = await db.policyAssignment.findFirst({
      where: {
        tenantId: ctx.tenantId,
        policyId,
        employmentId: ctx.employmentId,
        status: { in: [PolicyAssignmentStatus.PENDING, PolicyAssignmentStatus.OVERDUE] },
        policy: {
          status: PolicyStatus.PUBLISHED,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
        }
      },
      select: {
        id: true,
        status: true,
        dueAt: true,
        assignedAt: true,
        policy: { select: { id: true, code: true, title: true, version: true, status: true, ownerId: true } }
      }
    });
    if (assignment) {
      return {
        available: true,
        kind: "acknowledgement",
        policy: { ...assignment.policy, status: assignment.policy.status.toString() },
        assignment: {
          id: assignment.id,
          status: assignment.status.toString(),
          dueAt: assignment.dueAt?.toISOString() ?? null,
          assignedAt: assignment.assignedAt.toISOString()
        }
      };
    }
  }

  return { available: false };
}
