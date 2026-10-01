import { ConnectionStatus, DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { optionalEndpoint } from "@/lib/settings-connection-validation";

function scopesValue(value: unknown): Prisma.InputJsonValue | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 100) return null;
  if (value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 191)) return null;
  return value.map((item) => String(item).trim()) as Prisma.InputJsonValue;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid integration id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const name = asText(body.name, 120);
  const systemType = asText(body.systemType, 120);
  const authType = asText(body.authType, 80);
  const baseUrl = optionalEndpoint(body.baseUrl, ["https:", "http:"]);
  const secretRef = asOptionalText(body.secretRef, 512);
  const scopes = scopesValue(body.scopes);
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!name || !systemType || !authType || !expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return Response.json({ error: "name, systemType, authType and expectedUpdatedAt are required." }, { status: 400 });
  }
  if (baseUrl === null) return Response.json({ error: "baseUrl must be a valid HTTP(S) URL." }, { status: 400 });
  if (secretRef === null || scopes === null) return Response.json({ error: "secretRef or scopes are invalid." }, { status: 400 });

  try {
    const data = await db.$transaction(async (tx) => {
      const current = await tx.integrationConnection.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, status: true, updatedAt: true }
      });
      if (!current) throw new Error("NOT_FOUND");
      if (current.status !== ConnectionStatus.DRAFT) throw new Error("NOT_DRAFT");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new Error("STATE_CONFLICT");

      const result = await tx.integrationConnection.updateMany({
        where: { id, tenantId: ctx.tenantId, status: ConnectionStatus.DRAFT, updatedAt: current.updatedAt },
        data: {
          name,
          systemType,
          baseUrl,
          authType,
          secretRef,
          ...(scopes === undefined ? {} : { scopes }),
          enabled: false,
          lastSyncAt: null,
          lastError: null
        }
      });
      if (result.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: "settings.integration-metadata-updated",
        resourceType: "IntegrationConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: "Updated DRAFT integration metadata before governed activation"
      });

      return tx.integrationConnection.findUnique({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return Response.json({ error: "Integration was not found." }, { status: 404 });
    if (code === "NOT_DRAFT") return Response.json({ error: "Only DRAFT integrations can be edited. Reopen the connection before changing metadata." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Integration metadata changed concurrently. Refresh and retry." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "An integration with this name already exists in the tenant." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "Integration metadata changed concurrently. Refresh and retry." }, { status: 409 });
    throw error;
  }
}
