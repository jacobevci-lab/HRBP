import { ConnectionStatus, DataClassification, IdentityProviderType, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function optionalHttpUrl(value: unknown, maxLength = 1024): string | null | undefined {
  const parsed = asOptionalText(value, maxLength);
  if (parsed === undefined || parsed === null) return parsed;
  try {
    const url = new URL(parsed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();
  const data = await db.identityProviderConnection.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, type: true, issuer: true, clientId: true, metadataUrl: true,
      directoryTenantId: true, scimEnabled: true, jitEnabled: true, mfaRequired: true,
      status: true, lastValidatedAt: true, createdAt: true, updatedAt: true, secretRef: true
    }
  });
  return Response.json({ data, secrets: { valuesReturned: false, referencesOnly: true } }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const name = asText(body.name, 120);
  const type = typeof body.type === "string" && Object.values(IdentityProviderType).includes(body.type as IdentityProviderType)
    ? body.type as IdentityProviderType
    : null;
  if (!name || !type) return Response.json({ error: "name and valid identity provider type are required." }, { status: 400 });

  const issuer = optionalHttpUrl(body.issuer);
  const metadataUrl = optionalHttpUrl(body.metadataUrl);
  const clientId = asOptionalText(body.clientId, 256);
  const directoryTenantId = asOptionalText(body.directoryTenantId, 191);
  const secretRef = asOptionalText(body.secretRef, 512);
  if (issuer === null) return Response.json({ error: "issuer must be a valid HTTP(S) URL." }, { status: 400 });
  if (metadataUrl === null) return Response.json({ error: "metadataUrl must be a valid HTTP(S) URL." }, { status: 400 });
  if (clientId === null || directoryTenantId === null || secretRef === null) return Response.json({ error: "One or more identity provider fields are invalid." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const connection = await tx.identityProviderConnection.create({
        data: {
          tenantId: ctx.tenantId,
          name,
          type,
          issuer,
          clientId,
          metadataUrl,
          directoryTenantId,
          secretRef,
          scimEnabled: typeof body.scimEnabled === "boolean" ? body.scimEnabled : false,
          jitEnabled: typeof body.jitEnabled === "boolean" ? body.jitEnabled : false,
          mfaRequired: typeof body.mfaRequired === "boolean" ? body.mfaRequired : true,
          status: ConnectionStatus.DRAFT
        }
      });
      await appendAudit(tx, ctx, {
        action: "settings.identity-provider-created",
        resourceType: "IdentityProviderConnection",
        resourceId: connection.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Identity provider ${type} registered as DRAFT`
      });
      return connection;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "An identity provider with this name already exists in the tenant." }, { status: 409 });
    }
    throw error;
  }
}
