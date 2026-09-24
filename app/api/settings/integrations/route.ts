import { ConnectionStatus, DataClassification, Prisma } from "@prisma/client";
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

function scopesValue(value: unknown): Prisma.InputJsonValue | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > 20_000) return null;
    return value as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();
  const data = await db.integrationConnection.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, systemType: true, baseUrl: true, authType: true, secretRef: true,
      scopes: true, enabled: true, status: true, lastSyncAt: true, lastError: true,
      createdAt: true, updatedAt: true
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
  const systemType = asText(body.systemType, 120);
  const authType = asText(body.authType, 80);
  const baseUrl = optionalHttpUrl(body.baseUrl);
  const secretRef = asOptionalText(body.secretRef, 512);
  const scopes = scopesValue(body.scopes);
  if (!name || !systemType || !authType) return Response.json({ error: "name, systemType and authType are required." }, { status: 400 });
  if (baseUrl === null) return Response.json({ error: "baseUrl must be a valid HTTP(S) URL." }, { status: 400 });
  if (secretRef === null || scopes === null) return Response.json({ error: "secretRef or scopes are invalid." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const connection = await tx.integrationConnection.create({
        data: {
          tenantId: ctx.tenantId,
          name,
          systemType,
          baseUrl,
          authType,
          secretRef,
          ...(scopes === undefined ? {} : { scopes }),
          enabled: typeof body.enabled === "boolean" ? body.enabled : false,
          status: ConnectionStatus.DRAFT,
          createdById: ctx.actorId
        }
      });
      await appendAudit(tx, ctx, {
        action: "settings.integration-created",
        resourceType: "IntegrationConnection",
        resourceId: connection.id,
        classification: DataClassification.RESTRICTED,
        purpose: `Integration ${systemType} registered as DRAFT`
      });
      return connection;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "An integration with this name already exists in the tenant." }, { status: 409 });
    }
    throw error;
  }
}
