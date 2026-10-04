import { ConnectionStatus, DataClassification, IdentityProviderType, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { identityIssuer, identityMetadataUrl } from "@/lib/settings-connection-validation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid identity provider id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const name = asText(body.name, 120);
  const type = typeof body.type === "string" && Object.values(IdentityProviderType).includes(body.type as IdentityProviderType)
    ? body.type as IdentityProviderType
    : null;
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!name || !type || !expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return Response.json({ error: "name, valid type and expectedUpdatedAt are required." }, { status: 400 });
  }

  const issuer = identityIssuer(body.issuer, type);
  const metadataUrl = identityMetadataUrl(body.metadataUrl);
  const clientId = asOptionalText(body.clientId, 256);
  const directoryTenantId = asOptionalText(body.directoryTenantId, 191);
  const secretRef = asOptionalText(body.secretRef, 512);
  if (issuer === null) return Response.json({ error: type === IdentityProviderType.LDAP ? "issuer must be a valid LDAP(S) endpoint." : "issuer must be a valid HTTP(S) URL." }, { status: 400 });
  if (metadataUrl === null) return Response.json({ error: "metadataUrl must be a valid HTTP(S) URL." }, { status: 400 });
  if (clientId === null || directoryTenantId === null || secretRef === null) return Response.json({ error: "One or more identity provider fields are invalid." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const current = await tx.identityProviderConnection.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, status: true, updatedAt: true }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (current.status !== ConnectionStatus.DRAFT) throw new Error("NOT_DRAFT");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STATE_CONFLICT");

      const result = await tx.identityProviderConnection.updateMany({
        where: { id, tenantId: ctx.tenantId, status: ConnectionStatus.DRAFT, updatedAt: current.updatedAt },
        data: {
          name,
          type,
          issuer,
          metadataUrl,
          clientId,
          directoryTenantId,
          secretRef,
          scimEnabled: typeof body.scimEnabled === "boolean" ? body.scimEnabled : false,
          jitEnabled: typeof body.jitEnabled === "boolean" ? body.jitEnabled : false,
          mfaRequired: typeof body.mfaRequired === "boolean" ? body.mfaRequired : true,
          lastValidatedAt: null
        }
      });
      if (result.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: "settings.identity-provider-metadata-updated",
        resourceType: "IdentityProviderConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: "Updated DRAFT identity-provider metadata before governed activation"
      });

      return tx.identityProviderConnection.findUnique({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Identity provider was not found." }, { status: 404 });
    if (code === "NOT_DRAFT") return Response.json({ error: "Only DRAFT identity providers can be edited. Reopen the connection before changing metadata." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Identity provider metadata changed concurrently. Refresh and retry." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "An identity provider with this name already exists in the tenant." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Identity provider metadata changed concurrently. Refresh and retry." }, { status: 409 });
    throw error;
  }
}
