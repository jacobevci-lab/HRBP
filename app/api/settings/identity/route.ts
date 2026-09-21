import { ConnectionStatus, DataClassification, IdentityProviderType } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();
  const data = await db.identityProviderConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, issuer: true, clientId: true, metadataUrl: true, directoryTenantId: true, scimEnabled: true, jitEnabled: true, mfaRequired: true, status: true, lastValidatedAt: true, createdAt: true, updatedAt: true, secretRef: true } });
  return Response.json({ data, secrets: { valuesReturned: false, referencesOnly: true } });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:write")) return forbidden();
  const body = await request.json() as { name?: string; type?: IdentityProviderType; issuer?: string; clientId?: string; metadataUrl?: string; directoryTenantId?: string; secretRef?: string; scimEnabled?: boolean; jitEnabled?: boolean; mfaRequired?: boolean };
  const name = body.name?.trim();
  if (!name || !body.type || !Object.values(IdentityProviderType).includes(body.type)) return Response.json({ error: "name and valid identity provider type are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const connection = await tx.identityProviderConnection.create({ data: { tenantId: ctx.tenantId, name, type: body.type!, issuer: body.issuer, clientId: body.clientId, metadataUrl: body.metadataUrl, directoryTenantId: body.directoryTenantId, secretRef: body.secretRef, scimEnabled: Boolean(body.scimEnabled), jitEnabled: Boolean(body.jitEnabled), mfaRequired: body.mfaRequired ?? true, status: ConnectionStatus.DRAFT } });
    await appendAudit(tx, ctx, { action: "settings.identity-provider-created", resourceType: "IdentityProviderConnection", resourceId: connection.id, classification: DataClassification.RESTRICTED });
    return connection;
  });
  return Response.json({ data }, { status: 201 });
}
