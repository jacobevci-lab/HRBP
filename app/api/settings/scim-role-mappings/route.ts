import { DataClassification, Prisma, ScimRoleMappingStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { isScimDirectoryAssignableRole, scimDirectoryAssignableRoles } from "@/lib/scim-role-mapping";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();

  const [mappings, groups] = await Promise.all([
    db.scimGroupRoleMapping.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        groupId: true,
        role: true,
        status: true,
        createdById: true,
        activatedById: true,
        activatedAt: true,
        disabledById: true,
        disabledAt: true,
        attestation: true,
        createdAt: true,
        updatedAt: true,
        group: {
          select: {
            displayName: true,
            externalId: true,
            _count: { select: { members: true } }
          }
        }
      }
    }),
    db.scimGroup.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        displayName: true,
        externalId: true,
        _count: { select: { members: true } }
      },
      take: 500
    })
  ]);

  return Response.json({
    data: mappings,
    options: {
      groups,
      roles: [...scimDirectoryAssignableRoles]
    },
    permissions: { write: can(ctx, "settings:write") }
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const groupId = asIdentifier(body.groupId);
  const role = isScimDirectoryAssignableRole(body.role) ? body.role : null;
  if (!groupId || !role) {
    return Response.json({ error: "groupId and an allowed workforce role are required." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      const group = await tx.scimGroup.findFirst({
        where: { id: groupId, tenantId: ctx.tenantId },
        select: { id: true, displayName: true }
      });
      if (!group) throw new Error("GROUP_NOT_FOUND");

      const mapping = await tx.scimGroupRoleMapping.create({
        data: {
          tenantId: ctx.tenantId,
          groupId,
          role,
          status: ScimRoleMappingStatus.DRAFT,
          createdById: ctx.actorId
        }
      });

      await appendAudit(tx, ctx, {
        action: "settings.scim-role-mapping-created",
        resourceType: "ScimGroupRoleMapping",
        resourceId: mapping.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Draft directory role mapping created for ${group.displayName} → ${role}`
      });
      return mapping;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "GROUP_NOT_FOUND") {
      return Response.json({ error: "SCIM group was not found in this tenant." }, { status: 404 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "This SCIM group already has a governed role mapping." }, { status: 409 });
    }
    throw error;
  }
}
