import { DataClassification, Prisma } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  applyScimGroupPatch,
  lockScimTenant,
  parseScimGroupInput,
  readScimObject,
  scimAccess,
  scimError,
  scimGroupProjection,
  scimJson,
  scimRuntimeConfig,
  validScimId
} from "@/lib/scim";

export const dynamic = "force-dynamic";

const groupSelect = {
  id: true,
  externalId: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
  members: {
    orderBy: { createdAt: "asc" as const },
    select: { user: { select: { id: true, displayName: true } } }
  }
} as const;

async function managedGroup(tenantId: string, id: string) {
  return db.scimGroup.findFirst({ where: { id, tenantId }, select: groupSelect });
}

async function replaceManagedGroup(input: {
  tenantId: string;
  id: string;
  displayName: string;
  externalId: string | null;
  members: string[];
  auditAction: string;
}) {
  return db.$transaction(async (tx) => {
    await lockScimTenant(tx, input.tenantId);
    const current = await tx.scimGroup.findFirst({
      where: { id: input.id, tenantId: input.tenantId },
      select: { id: true }
    });
    if (!current) return null;

    const memberIds = [...new Set(input.members)];
    const users = memberIds.length
      ? await tx.userAccount.findMany({
        where: {
          tenantId: input.tenantId,
          provisioningSource: "SCIM",
          id: { in: memberIds }
        },
        select: { id: true, displayName: true }
      })
      : [];
    if (users.length !== memberIds.length) throw new Error("SCIM_GROUP_MEMBER_NOT_FOUND");

    const group = await tx.scimGroup.update({
      where: { id: current.id },
      data: { displayName: input.displayName, externalId: input.externalId }
    });

    await tx.scimGroupMember.deleteMany({
      where: { tenantId: input.tenantId, groupId: current.id }
    });
    if (memberIds.length) {
      await tx.scimGroupMember.createMany({
        data: memberIds.map((userId) => ({
          tenantId: input.tenantId,
          groupId: current.id,
          userId
        })),
        skipDuplicates: true
      });
    }

    await appendSystemAudit(tx, input.tenantId, "system:scim-provisioner", {
      action: input.auditAction,
      resourceType: "ScimGroup",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: `SCIM group membership synchronized with ${memberIds.length} managed member(s)`
    });

    return { group, users };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function groupError(error: unknown) {
  if (error instanceof Error && error.message === "SCIM_GROUP_MEMBER_NOT_FOUND") {
    return scimError(400, "Every group member must reference a SCIM-managed user in this tenant.", "invalidValue");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return scimError(409, "A group with the supplied externalId already exists.", "uniqueness");
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM group resource id is required.", "invalidValue");

  const group = await managedGroup(config.tenantId, id);
  if (!group) return scimError(404, "SCIM group was not found.");
  return scimJson(scimGroupProjection(group, group.members.map((member) => member.user), config.baseUrl));
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM group resource id is required.", "invalidValue");

  const body = await readScimObject(request);
  if (!body) return scimError(400, "A valid SCIM Group JSON object is required.", "invalidSyntax");
  const input = parseScimGroupInput(body);
  if (!input) return scimError(400, "SCIM group attributes are invalid.", "invalidValue");

  try {
    const result = await replaceManagedGroup({
      tenantId: config.tenantId,
      id,
      ...input,
      auditAction: "identity.scim-group-replaced"
    });
    if (!result) return scimError(404, "SCIM group was not found.");
    return scimJson(scimGroupProjection(result.group, result.users, config.baseUrl));
  } catch (error) {
    const response = groupError(error);
    if (response) return response;
    throw error;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM group resource id is required.", "invalidValue");

  const current = await managedGroup(config.tenantId, id);
  if (!current) return scimError(404, "SCIM group was not found.");

  const body = await readScimObject(request);
  if (!body) return scimError(400, "A valid SCIM PatchOp JSON object is required.", "invalidSyntax");
  const patched = applyScimGroupPatch(body, {
    displayName: current.displayName,
    externalId: current.externalId,
    members: current.members.map((member) => member.user.id)
  });
  if (!patched) return scimError(400, "SCIM group patch contains an unsupported operation or attribute.", "invalidValue");
  const input = parseScimGroupInput(patched);
  if (!input) return scimError(400, "SCIM group patch produced invalid attributes.", "invalidValue");

  try {
    const result = await replaceManagedGroup({
      tenantId: config.tenantId,
      id,
      ...input,
      auditAction: "identity.scim-group-patched"
    });
    if (!result) return scimError(404, "SCIM group was not found.");
    return scimJson(scimGroupProjection(result.group, result.users, config.baseUrl));
  } catch (error) {
    const response = groupError(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM group resource id is required.", "invalidValue");

  const deleted = await db.$transaction(async (tx) => {
    await lockScimTenant(tx, config.tenantId);
    const current = await tx.scimGroup.findFirst({
      where: { id, tenantId: config.tenantId },
      select: { id: true }
    });
    if (!current) return null;

    await tx.scimGroup.delete({ where: { id: current.id } });
    await appendSystemAudit(tx, config.tenantId, "system:scim-provisioner", {
      action: "identity.scim-group-deprovisioned",
      resourceType: "ScimGroup",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: "SCIM group deprovisioning removed directory membership state"
    });
    return current.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!deleted) return scimError(404, "SCIM group was not found.");
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
