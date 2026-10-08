import { DataClassification, Prisma } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  applyScimPatch,
  lockScimTenant,
  parseScimUserInput,
  provisioningSelect,
  readScimObject,
  scimAccess,
  scimEmailAllowed,
  scimError,
  scimJson,
  scimRuntimeConfig,
  scimUserProjection,
  validScimId
} from "@/lib/scim";

export const dynamic = "force-dynamic";

async function managedUser(tenantId: string, id: string) {
  return db.userAccount.findFirst({
    where: { id, tenantId, provisioningSource: "SCIM" }
  });
}

async function updateManagedUser(input: {
  tenantId: string;
  id: string;
  userName: string;
  displayName: string;
  externalId: string | null;
  active: boolean;
  auditAction: string;
}) {
  return db.$transaction(async (tx) => {
    await lockScimTenant(tx, input.tenantId);
    const current = await tx.userAccount.findFirst({
      where: { id: input.id, tenantId: input.tenantId, provisioningSource: "SCIM" }
    });
    if (!current) return null;

    const emailConflict = await tx.userAccount.findFirst({
      where: {
        tenantId: input.tenantId,
        id: { not: current.id },
        email: { equals: input.userName, mode: "insensitive" }
      },
      select: { id: true }
    });
    if (emailConflict) throw new Error("SCIM_EMAIL_CONFLICT");

    const externalConflict = input.externalId
      ? await tx.userAccount.findFirst({
        where: {
          tenantId: input.tenantId,
          id: { not: current.id },
          provisioningSource: "SCIM",
          provisioningExternalId: input.externalId
        },
        select: { id: true }
      })
      : null;
    if (externalConflict) throw new Error("SCIM_EXTERNAL_ID_CONFLICT");

    const now = new Date();
    const deactivate = current.active && !input.active;
    const user = await tx.userAccount.update({
      where: { id: current.id },
      data: {
        email: input.userName,
        displayName: input.displayName,
        active: input.active,
        provisioningExternalId: input.externalId,
        provisioningUpdatedAt: now,
        ...(deactivate ? {
          sessionVersion: { increment: 1 },
          sessionsRevokedAt: now
        } : {})
      },
      select: provisioningSelect()
    });

    await appendSystemAudit(tx, input.tenantId, "system:scim-provisioner", {
      action: input.auditAction,
      resourceType: "UserAccount",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: deactivate
        ? "SCIM update disabled the account and revoked active application sessions"
        : "SCIM synchronized tenant user identity attributes"
    });

    return user;
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

  const user = await db.userAccount.findFirst({
    where: { id, tenantId: config.tenantId, provisioningSource: "SCIM" },
    select: provisioningSelect()
  });
  if (!user) return scimError(404, "SCIM user was not found.");
  return scimJson(scimUserProjection(user, config.baseUrl));
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

  const body = await readScimObject(request);
  if (!body) return scimError(400, "A valid SCIM User JSON object is required.", "invalidSyntax");
  const input = parseScimUserInput(body);
  if (!input) return scimError(400, "SCIM user attributes are invalid.", "invalidValue");
  if (!scimEmailAllowed(input.userName, config.allowedDomains)) {
    return scimError(400, "userName must belong to an allowed tenant email domain.", "invalidValue");
  }

  try {
    const user = await updateManagedUser({
      tenantId: config.tenantId,
      id,
      ...input,
      auditAction: "identity.scim-user-replaced"
    });
    if (!user) return scimError(404, "SCIM user was not found.");
    return scimJson(scimUserProjection(user, config.baseUrl));
  } catch (error) {
    if (error instanceof Error && ["SCIM_EMAIL_CONFLICT", "SCIM_EXTERNAL_ID_CONFLICT"].includes(error.message)) {
      return scimError(409, "The supplied SCIM identity conflicts with another tenant account.", "uniqueness");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return scimError(409, "The supplied SCIM identity conflicts with another tenant account.", "uniqueness");
    }
    throw error;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

  const current = await managedUser(config.tenantId, id);
  if (!current) return scimError(404, "SCIM user was not found.");

  const body = await readScimObject(request);
  if (!body) return scimError(400, "A valid SCIM PatchOp JSON object is required.", "invalidSyntax");

  const patched = applyScimPatch(body, {
    userName: current.email,
    displayName: current.displayName,
    externalId: current.provisioningExternalId,
    active: current.active
  });
  if (!patched) return scimError(400, "SCIM patch contains an unsupported operation or attribute.", "invalidValue");

  const input = parseScimUserInput(patched, current);
  if (!input) return scimError(400, "SCIM patch produced invalid user attributes.", "invalidValue");
  if (!scimEmailAllowed(input.userName, config.allowedDomains)) {
    return scimError(400, "userName must belong to an allowed tenant email domain.", "invalidValue");
  }

  try {
    const user = await updateManagedUser({
      tenantId: config.tenantId,
      id,
      ...input,
      auditAction: "identity.scim-user-patched"
    });
    if (!user) return scimError(404, "SCIM user was not found.");
    return scimJson(scimUserProjection(user, config.baseUrl));
  } catch (error) {
    if (error instanceof Error && ["SCIM_EMAIL_CONFLICT", "SCIM_EXTERNAL_ID_CONFLICT"].includes(error.message)) {
      return scimError(409, "The supplied SCIM identity conflicts with another tenant account.", "uniqueness");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return scimError(409, "The supplied SCIM identity conflicts with another tenant account.", "uniqueness");
    }
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validScimId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

  const result = await db.$transaction(async (tx) => {
    await lockScimTenant(tx, config.tenantId);
    const current = await tx.userAccount.findFirst({
      where: { id, tenantId: config.tenantId, provisioningSource: "SCIM" }
    });
    if (!current) return null;

    const now = new Date();
    if (current.active) {
      await tx.userAccount.update({
        where: { id: current.id },
        data: {
          active: false,
          sessionVersion: { increment: 1 },
          sessionsRevokedAt: now,
          provisioningUpdatedAt: now
        }
      });
    } else {
      await tx.userAccount.update({
        where: { id: current.id },
        data: { provisioningUpdatedAt: now }
      });
    }

    await appendSystemAudit(tx, config.tenantId, "system:scim-provisioner", {
      action: "identity.scim-user-deprovisioned",
      resourceType: "UserAccount",
      resourceId: current.id,
      classification: DataClassification.RESTRICTED,
      purpose: "SCIM deprovisioning disabled the account and revoked application sessions"
    });
    return current.id;
  });

  if (!result) return scimError(404, "SCIM user was not found.");
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
