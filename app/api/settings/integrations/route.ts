import { ConnectionStatus, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();
  const data = await db.integrationConnection.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true, systemType: true, baseUrl: true, authType: true, secretRef: true, scopes: true, enabled: true, status: true, lastSyncAt: true, lastError: true, createdAt: true, updatedAt: true } });
  return Response.json({ data, secrets: { valuesReturned: false, referencesOnly: true } });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:write")) return forbidden();
  const body = await request.json() as { name?: string; systemType?: string; baseUrl?: string; authType?: string; secretRef?: string; scopes?: unknown; enabled?: boolean };
  const name = body.name?.trim(), systemType = body.systemType?.trim(), authType = body.authType?.trim();
  if (!name || !systemType || !authType) return Response.json({ error: "name, systemType and authType are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const connection = await tx.integrationConnection.create({ data: { tenantId: ctx.tenantId, name, systemType, baseUrl: body.baseUrl, authType, secretRef: body.secretRef, scopes: body.scopes as never, enabled: Boolean(body.enabled), status: ConnectionStatus.DRAFT, createdById: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "settings.integration-created", resourceType: "IntegrationConnection", resourceId: connection.id, classification: DataClassification.RESTRICTED });
    return connection;
  });
  return Response.json({ data }, { status: 201 });
}
