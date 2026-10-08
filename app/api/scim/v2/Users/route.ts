import { DataClassification, PlatformRole, Prisma } from "@prisma/client";
import { appendSystemAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  SCIM_LIST_SCHEMA,
  defaultScimRole,
  lockScimTenant,
  parsePagination,
  parseScimFilter,
  parseScimUserInput,
  provisioningSelect,
  readScimObject,
  scimAccess,
  scimEmailAllowed,
  scimError,
  scimJson,
  scimRuntimeConfig,
  scimSubject,
  scimUserProjection
} from "@/lib/scim";

export const dynamic = "force-dynamic";

function provisioningWhere(tenantId: string, filter: ReturnType<typeof parseScimFilter>) {
  const base = { tenantId, provisioningSource: "SCIM" } as const;
  if (!filter || filter.kind === "none") return base;
  if (filter.kind === "userName") {
    return { ...base, email: { equals: filter.value, mode: "insensitive" as const } };
  }
  return { ...base, provisioningExternalId: filter.value };
}

export async function GET(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const url = new URL(request.url);
  const filter = parseScimFilter(url.searchParams.get("filter"));
  if (!filter) return scimError(400, "Only userName eq and externalId eq filters are supported.", "invalidFilter");
  const pagination = parsePagination(url);
  if (!pagination) return scimError(400, "startIndex/count are invalid.", "invalidValue");

  const where = provisioningWhere(config.tenantId, filter);
  const [totalResults, resources] = await Promise.all([
    db.userAccount.count({ where }),
    pagination.count === 0
      ? Promise.resolve([])
      : db.userAccount.findMany({
        where,
        orderBy: [{ email: "asc" }, { id: "asc" }],
        skip: pagination.startIndex - 1,
        take: pagination.count,
        select: provisioningSelect()
      })
  ]);

  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex: pagination.startIndex,
    itemsPerPage: resources.length,
    Resources: resources.map((user) => scimUserProjection(user, config.baseUrl))
  });
}

export async function POST(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  const body = await readScimObject(request);
  if (!body) return scimError(400, "A valid SCIM User JSON object is required.", "invalidSyntax");

  const input = parseScimUserInput(body);
  if (!input) return scimError(400, "userName, displayName/externalId and active values are invalid.", "invalidValue");
  if (!scimEmailAllowed(input.userName, config.allowedDomains)) {
    return scimError(400, "userName must belong to an allowed tenant email domain.", "invalidValue");
  }

  try {
    const result = await db.$transaction(async (tx) => {
      await lockScimTenant(tx, config.tenantId);
      const tenant = await tx.tenant.findUnique({ where: { id: config.tenantId }, select: { id: true } });
      if (!tenant) throw new Error("SCIM_TENANT_NOT_FOUND");

      const [externalMatch, emailMatches] = await Promise.all([
        input.externalId
          ? tx.userAccount.findFirst({
            where: {
              tenantId: config.tenantId,
              provisioningSource: "SCIM",
              provisioningExternalId: input.externalId
            }
          })
          : Promise.resolve(null),
        tx.userAccount.findMany({
          where: {
            tenantId: config.tenantId,
            email: { equals: input.userName, mode: "insensitive" }
          },
          orderBy: { id: "asc" },
          take: 2
        })
      ]);

      if (emailMatches.length > 1) throw new Error("SCIM_IDENTITY_CONFLICT");
      const emailMatch = emailMatches[0] ?? null;
      if (externalMatch && emailMatch && externalMatch.id !== emailMatch.id) {
        throw new Error("SCIM_IDENTITY_CONFLICT");
      }
      const existing = externalMatch ?? emailMatch;

      if (existing?.provisioningSource && existing.provisioningSource !== "SCIM") {
        throw new Error("SCIM_OWNERSHIP_CONFLICT");
      }
      if (existing && !existing.provisioningSource &&
          (!config.allowUnmanagedAdoption ||
           existing.role !== PlatformRole.EMPLOYEE ||
           existing.localAuthEnabled ||
           Boolean(existing.localPasswordHash))) {
        throw new Error("SCIM_OWNERSHIP_CONFLICT");
      }
      if (existing?.provisioningSource === "SCIM" &&
          existing.provisioningExternalId &&
          input.externalId &&
          existing.provisioningExternalId !== input.externalId) {
        throw new Error("SCIM_EXTERNAL_ID_CONFLICT");
      }

      const now = new Date();
      let user;
      if (existing) {
        const deactivate = existing.active && !input.active;
        user = await tx.userAccount.update({
          where: { id: existing.id },
          data: {
            email: input.userName,
            displayName: input.displayName,
            active: input.active,
            provisioningSource: "SCIM",
            provisioningExternalId: input.externalId ?? existing.provisioningExternalId,
            provisionedAt: existing.provisionedAt ?? now,
            provisioningUpdatedAt: now,
            ...(deactivate ? {
              sessionVersion: { increment: 1 },
              sessionsRevokedAt: now
            } : {})
          },
          select: provisioningSelect()
        });
      } else {
        user = await tx.userAccount.create({
          data: {
            tenantId: config.tenantId,
            subject: scimSubject(input.externalId, input.userName),
            displayName: input.displayName,
            email: input.userName,
            role: defaultScimRole(),
            active: input.active,
            provisioningSource: "SCIM",
            provisioningExternalId: input.externalId,
            provisionedAt: now,
            provisioningUpdatedAt: now
          },
          select: provisioningSelect()
        });
      }

      await appendSystemAudit(tx, config.tenantId, "system:scim-provisioner", {
        action: existing
          ? existing.provisioningSource === "SCIM"
            ? "identity.scim-user-updated"
            : "identity.scim-user-adopted"
          : "identity.scim-user-provisioned",
        resourceType: "UserAccount",
        resourceId: user.id,
        classification: DataClassification.RESTRICTED,
        purpose: input.active
          ? "SCIM user provisioning synchronized an active account"
          : "SCIM user provisioning synchronized a disabled account and revoked application sessions"
      });
      return { user, created: !existing };
    });

    const location = config.baseUrl
      ? new URL("/api/scim/v2/Users/" + encodeURIComponent(result.user.id), config.baseUrl).toString()
      : undefined;
    return scimJson(
      scimUserProjection(result.user, config.baseUrl),
      result.created ? 201 : 200,
      location ? { location } : undefined
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SCIM_TENANT_NOT_FOUND") {
      return scimError(503, "The configured SCIM tenant does not exist.");
    }
    if (error instanceof Error && ["SCIM_OWNERSHIP_CONFLICT", "SCIM_EXTERNAL_ID_CONFLICT", "SCIM_IDENTITY_CONFLICT"].includes(error.message)) {
      return scimError(409, "The requested user identity conflicts with an existing provisioning owner.", "uniqueness");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return scimError(409, "A user with the supplied SCIM identity already exists.", "uniqueness");
    }
    throw error;
  }
}
