import { DataClassification, Prisma } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  parseScimUserInput,
  provisioningSelect,
  readScimObject,
  scimAuthorized,
  scimEmailAllowed,
  scimError,
  scimJson,
  scimRuntimeConfig,
  scimUserProjection
} from "@/lib/scim";

export const dynamic = "force-dynamic";

function validId(value: string) {
  return value.length > 0 && value.length <= 191 && !/[\u0000-\u001f\u007f]/.test(value);
}

type MutableScim = {
  userName: unknown;
  displayName: unknown;
  externalId: unknown;
  active: unknown;
};

function patchValueObject(target: MutableScim, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const normalized = key.toLowerCase();
    if (!["username", "displayname", "externalid", "active"].includes(normalized)) continue;
    if (normalized === "username") target.userName = record[key];
    else if (normalized === "displayname") target.displayName = record[key];
    else if (normalized === "externalid") target.externalId = record[key];
    else if (normalized === "active") target.active = record[key];
  }
  return true;
}

function applyPatch(body: Record<string, unknown>, current: MutableScim) {
  const operations = body.Operations;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 20) return null;
  const next = { ...current };

  for (const raw of operations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const operation = raw as Record<string, unknown>;
    const op = typeof operation.op === "string" ? operation.op.trim().toLowerCase() : "";
    if (!["add", "replace", "remove"].includes(op)) return null;

    const path = typeof operation.path === "string" ? operation.path.trim().toLowerCase() : "";
    if (!path) {
      if (op === "remove" || !patchValueObject(next, operation.value)) return null;
      continue;
    }

    if (!["username", "displayname", "externalid", "active"].includes(path)) return null;
    if (op === "remove") {
      if (path !== "externalid") return null;
      next.externalId = null;
      continue;
    }

    if (path === "username") next.userName = operation.value;
    else if (path === "displayname") next.displayName = operation.value;
    else if (path === "externalid") next.externalId = operation.value;
    else if (path === "active") next.active = operation.value;
  }

  return next;
}

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
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

  const user = await db.userAccount.findFirst({
    where: { id, tenantId: config.tenantId, provisioningSource: "SCIM" },
    select: provisioningSelect()
  });
  if (!user) return scimError(404, "SCIM user was not found.");
  return scimJson(scimUserProjection(user, config.baseUrl));
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

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
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

  const current = await managedUser(config.tenantId, id);
  if (!current) return scimError(404, "SCIM user was not found.");

  const body = await readScimObject(request);
  if (!body) return scimError(400, "A valid SCIM PatchOp JSON object is required.", "invalidSyntax");

  const patched = applyPatch(body, {
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
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  const config = scimRuntimeConfig();
  const id = (await params).id;
  if (!validId(id)) return scimError(400, "A valid SCIM resource id is required.", "invalidValue");

  const result = await db.$transaction(async (tx) => {
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
