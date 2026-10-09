import { DataClassification, Prisma, ScimRoleMappingStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asDate, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import {
  isScimDirectoryAssignableRole,
  reconcileScimManagedRoles,
  SCIM_ROLE_MAPPING_AMBIGUOUS,
  SCIM_ROLE_MAPPING_MANUAL_CONFLICT
} from "@/lib/scim-role-mapping";

type Action = "activate" | "disable" | "reopen";

function actionValue(value: unknown): Action | null {
  return value === "activate" || value === "disable" || value === "reopen" ? value : null;
}

function conflictResponse(code: string) {
  if (code === SCIM_ROLE_MAPPING_AMBIGUOUS) {
    return Response.json({
      error: "Activation would give at least one SCIM-managed user conflicting application roles through multiple groups."
    }, { status: 409 });
  }
  if (code === SCIM_ROLE_MAPPING_MANUAL_CONFLICT) {
    return Response.json({
      error: "Activation would overwrite a manually governed non-employee role. Resolve that account before continuing."
    }, { status: 409 });
  }
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid mapping id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const action = actionValue(body.action);
  const expectedUpdatedAt = asDate(body.expectedUpdatedAt);
  if (!action || !expectedUpdatedAt) {
    return Response.json({ error: "action and expectedUpdatedAt are required." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const current = await tx.scimGroupRoleMapping.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          groupId: true,
          role: true,
          status: true,
          createdById: true,
          updatedAt: true,
          group: {
            select: {
              displayName: true,
              members: { select: { userId: true } }
            }
          }
        }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STATE_CONFLICT");
      if (!isScimDirectoryAssignableRole(current.role)) throw new Error("ROLE_NOT_ALLOWED");

      const memberIds = current.group.members.map((member) => member.userId);

      if (action === "activate") {
        if (current.status !== ScimRoleMappingStatus.DRAFT) throw new Error("INVALID_STATE");
        const attestation = asText(body.attestation, 500);
        if (!attestation || attestation.length < 12) throw new Error("ATTESTATION_REQUIRED");

        const updated = await tx.scimGroupRoleMapping.update({
          where: { id },
          data: {
            status: ScimRoleMappingStatus.ACTIVE,
            activatedById: ctx.actorId,
            activatedAt: new Date(),
            disabledById: null,
            disabledAt: null,
            attestation
          }
        });
        const reconciled = await reconcileScimManagedRoles(tx, ctx.tenantId, memberIds);
        await appendAudit(tx, ctx, {
          action: "settings.scim-role-mapping-activated",
          resourceType: "ScimGroupRoleMapping",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: `Activated ${current.group.displayName} → ${current.role}; reconciled ${reconciled.changed} SCIM-managed account(s)`
        });
        return { ...updated, reconciled };
      }

      if (action === "disable") {
        if (current.status !== ScimRoleMappingStatus.ACTIVE) throw new Error("INVALID_STATE");
        const reason = asText(body.reason, 500);
        if (!reason || reason.length < 8) throw new Error("REASON_REQUIRED");

        const updated = await tx.scimGroupRoleMapping.update({
          where: { id },
          data: {
            status: ScimRoleMappingStatus.DISABLED,
            disabledById: ctx.actorId,
            disabledAt: new Date()
          }
        });
        const reconciled = await reconcileScimManagedRoles(tx, ctx.tenantId, memberIds);
        await appendAudit(tx, ctx, {
          action: "settings.scim-role-mapping-disabled",
          resourceType: "ScimGroupRoleMapping",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: `${reason}; released/reconciled ${reconciled.changed} SCIM-managed account(s)`
        });
        return { ...updated, reconciled };
      }

      if (current.status !== ScimRoleMappingStatus.DISABLED) throw new Error("INVALID_STATE");
      const reason = asText(body.reason, 500);
      if (!reason || reason.length < 8) throw new Error("REASON_REQUIRED");
      const updated = await tx.scimGroupRoleMapping.update({
        where: { id },
        data: {
          status: ScimRoleMappingStatus.DRAFT,
          activatedById: null,
          activatedAt: null,
          disabledById: null,
          disabledAt: null,
          attestation: null
        }
      });
      await appendAudit(tx, ctx, {
        action: "settings.scim-role-mapping-reopened",
        resourceType: "ScimGroupRoleMapping",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: reason
      });
      return { ...updated, reconciled: { changed: 0, managed: 0, released: 0 } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    if (error instanceof Error) {
      const conflict = conflictResponse(error.message);
      if (conflict) return conflict;
      if (error.message === "NOT_FOUND") return Response.json({ error: "SCIM role mapping was not found." }, { status: 404 });
      if (error.message === "STATE_CONFLICT") return Response.json({ error: "The mapping changed since it was loaded. Refresh and retry." }, { status: 409 });
      if (error.message === "INVALID_STATE") return Response.json({ error: "The requested mapping lifecycle transition is not allowed." }, { status: 409 });
      if (error.message === "ROLE_NOT_ALLOWED") return Response.json({ error: "This mapping contains a role that is not directory-assignable." }, { status: 409 });
      if (error.message === "ATTESTATION_REQUIRED") return Response.json({ error: "Activation requires an attestation of at least 12 characters." }, { status: 400 });
      if (error.message === "REASON_REQUIRED") return Response.json({ error: "This action requires a reason of at least 8 characters." }, { status: 400 });
    }
    throw error;
  }
}
