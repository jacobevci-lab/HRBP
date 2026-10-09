import { DataClassification, Prisma } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  SCIM_LIST_SCHEMA,
  lockScimTenant,
  parsePagination,
  parseScimGroupFilter,
  parseScimGroupInput,
  readScimObject,
  scimAccess,
  scimError,
  scimGroupProjection,
  scimJson,
  scimRuntimeConfig
} from "@/lib/scim";
import {
  reconcileScimManagedRoles,
  SCIM_ROLE_MAPPING_AMBIGUOUS,
  SCIM_ROLE_MAPPING_MANUAL_CONFLICT
} from "@/lib/scim-role-mapping";

export const dynamic = "force-dynamic";

function groupWhere(tenantId: string, filter: ReturnType<typeof parseScimGroupFilter>) {
  const base = { tenantId } as const;
  if (!filter || filter.kind === "none") return base;
  if (filter.kind === "displayName") {
    return { ...base, displayName: { equals: filter.value, mode: "insensitive" as const } };
  }
  return { ...base, externalId: filter.value };
}

function groupSelect() {
  return {
    id: true,
    externalId: true,
    displayName: true,
    createdAt: true,
    updatedAt: true,
    members: {
      orderBy: { createdAt: "asc" as const },
      select: {
        user: { select: { id: true, displayName: true } }
      }
    }
  } as const;
}

export async function GET(request: Request) {
  const denied = await scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const url = new URL(request.url);
  const filter = parseScimGroupFilter(url.searchParams.get("filter"));
  if (!filter) return scimError(400, "Only displayName eq and externalId eq group filters are supported.", "invalidFilter");
  const pagination = parsePagination(url);
  if (!pagination) return scimError(400, "startIndex/count are invalid.", "invalidValue");

  const where = groupWhere(config.tenantId, filter);
  const [totalResults, groups] = await Promise.all([
    db.scimGroup.count({ where }),
    pagination.count === 0
      ? Promise.resolve([])
      : db.scimGroup.findMany({
        where,
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        skip: pagination.startIndex - 1,
        take: pagination.count,
        select: groupSelect()
      })
  ]);

  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex: pagination.startIndex,
    itemsPerPage: groups.length,
    Resources: groups.map((group) =>
      scimGroupProjection(group, group.members.map((member) => member.user), config.baseUrl)
    )
  });
}

export async function POST(request: Request) {
  const denied = await scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const body = await readScimObject(request);
  if (!body) return scimError(400, "A valid SCIM Group JSON object is required.", "invalidSyntax");
  const input = parseScimGroupInput(body);
  if (!input) return scimError(400, "displayName, externalId or members are invalid.", "invalidValue");

  try {
    const result = await db.$transaction(async (tx) => {
      await lockScimTenant(tx, config.tenantId);
      const tenant = await tx.tenant.findUnique({ where: { id: config.tenantId }, select: { id: true } });
      if (!tenant) throw new Error("SCIM_TENANT_NOT_FOUND");

      const uniqueMemberIds = [...new Set(input.members)];
      const users = uniqueMemberIds.length
        ? await tx.userAccount.findMany({
          where: {
            tenantId: config.tenantId,
            provisioningSource: "SCIM",
            id: { in: uniqueMemberIds }
          },
          select: { id: true, displayName: true }
        })
        : [];
      if (users.length !== uniqueMemberIds.length) throw new Error("SCIM_GROUP_MEMBER_NOT_FOUND");

      const existing = input.externalId
        ? await tx.scimGroup.findFirst({
          where: { tenantId: config.tenantId, externalId: input.externalId },
          select: {
            id: true,
            members: { select: { userId: true } }
          }
        })
        : null;

      const group = existing
        ? await tx.scimGroup.update({
          where: { id: existing.id },
          data: { displayName: input.displayName, externalId: input.externalId }
        })
        : await tx.scimGroup.create({
          data: {
            tenantId: config.tenantId,
            displayName: input.displayName,
            externalId: input.externalId
          }
        });

      if (existing) await tx.scimGroupMember.deleteMany({ where: { tenantId: config.tenantId, groupId: group.id } });
      if (uniqueMemberIds.length) {
        await tx.scimGroupMember.createMany({
          data: uniqueMemberIds.map((userId) => ({
            tenantId: config.tenantId,
            groupId: group.id,
            userId
          })),
          skipDuplicates: true
        });
      }

      await appendSystemAudit(tx, config.tenantId, "system:scim-provisioner", {
        action: existing ? "identity.scim-group-updated" : "identity.scim-group-provisioned",
        resourceType: "ScimGroup",
        resourceId: group.id,
        classification: DataClassification.RESTRICTED,
        purpose: `SCIM group synchronized with ${uniqueMemberIds.length} managed member(s)`
      });

      const affectedUserIds = [...new Set([
        ...(existing?.members.map((member) => member.userId) ?? []),
        ...uniqueMemberIds
      ])];
      const reconciled = await reconcileScimManagedRoles(tx, config.tenantId, affectedUserIds);
      if (reconciled.changed) {
        await appendSystemAudit(tx, config.tenantId, "system:scim-provisioner", {
          action: "identity.scim-group-role-reconciled",
          resourceType: "ScimGroup",
          resourceId: group.id,
          classification: DataClassification.RESTRICTED,
          purpose: `Directory group synchronization reconciled ${reconciled.changed} application role assignment(s)`
        });
      }

      return { group, users, created: !existing };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const location = config.baseUrl
      ? new URL("/api/scim/v2/Groups/" + encodeURIComponent(result.group.id), config.baseUrl).toString()
      : undefined;
    return scimJson(
      scimGroupProjection(result.group, result.users, config.baseUrl),
      result.created ? 201 : 200,
      location ? { location } : undefined
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SCIM_TENANT_NOT_FOUND") {
      return scimError(503, "The configured SCIM tenant does not exist.");
    }
    if (error instanceof Error && error.message === "SCIM_GROUP_MEMBER_NOT_FOUND") {
      return scimError(400, "Every group member must reference a SCIM-managed user in this tenant.", "invalidValue");
    }
    if (error instanceof Error && error.message === SCIM_ROLE_MAPPING_AMBIGUOUS) {
      return scimError(409, "Group membership would give a user conflicting application roles through multiple governed mappings.", "uniqueness");
    }
    if (error instanceof Error && error.message === SCIM_ROLE_MAPPING_MANUAL_CONFLICT) {
      return scimError(409, "Group membership would overwrite a manually governed application role.", "mutability");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return scimError(409, "A group with the supplied externalId already exists.", "uniqueness");
    }
    throw error;
  }
}
