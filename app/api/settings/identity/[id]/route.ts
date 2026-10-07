import { ConnectionStatus, DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { validateIdentityProviderLive } from "@/lib/identity-provider-live-validation";
import { runtimeNumber } from "@/lib/runtime-env";
import { identityActivationIssues } from "@/lib/settings-connection-validation";

type LifecycleAction = "validate" | "activate" | "disable" | "reopen";

function actionValue(value: unknown): LifecycleAction | null {
  return value === "validate" || value === "activate" || value === "disable" || value === "reopen" ? value : null;
}

function validationMaxAgeMs() {
  const minutes = Math.min(10_080, Math.max(15, Math.floor(runtimeNumber("HRBP_IDENTITY_VALIDATION_MAX_AGE_MINUTES", 1440))));
  return minutes * 60_000;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const { id: rawId } = await params;
  const id = asIdentifier(rawId);
  if (!id) return Response.json({ error: "A valid identity provider id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const action = actionValue(body.action);
  if (!action) return Response.json({ error: "action must be validate, activate, disable or reopen." }, { status: 400 });

  const current = await db.identityProviderConnection.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!current) return Response.json({ error: "Identity provider was not found." }, { status: 404 });

  if (action === "validate") {
    if (current.status !== ConnectionStatus.DRAFT) return Response.json({ error: "Only DRAFT identity providers can be configuration-validated." }, { status: 409 });
    const issues = identityActivationIssues(current);
    if (issues.length) return Response.json({ error: `Identity provider configuration is incomplete. Missing: ${issues.join(", ")}.` }, { status: 409 });

    const live = await validateIdentityProviderLive(current);
    if (!live.ok) {
      return Response.json({
        error: "Identity provider live validation failed. Review the provider endpoint and validation requirements.",
        code: live.code
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }

    try {
      const data = await db.$transaction(async (tx) => {
        const validatedAt = new Date();
        const changed = await tx.identityProviderConnection.updateMany({
          where: {
            id,
            tenantId: ctx.tenantId,
            status: ConnectionStatus.DRAFT,
            updatedAt: current.updatedAt
          },
          data: { lastValidatedAt: validatedAt }
        });
        if (changed.count !== 1) throw new Error("STATE_CONFLICT");
        await appendAudit(tx, ctx, {
          action: "settings.identity-provider-live-validated",
          resourceType: "IdentityProviderConnection",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: `Identity-provider live validation succeeded: ${live.code}`
        });
        return tx.identityProviderConnection.findUnique({ where: { id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return Response.json({ data, validation: { code: live.code, evidence: live.evidence } }, {
        headers: { "cache-control": "no-store" }
      });
    } catch (error) {
      if (error instanceof Error && error.message === "STATE_CONFLICT") {
        return Response.json({ error: "Identity provider metadata changed while validation was running. Refresh and validate again." }, { status: 409 });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return Response.json({ error: "Identity provider metadata changed while validation was running. Refresh and validate again." }, { status: 409 });
      }
      throw error;
    }
  }

  if (action === "activate") {
    if (current.status === ConnectionStatus.ACTIVE) return Response.json({ data: current });
    if (current.status !== ConnectionStatus.DRAFT) {
      return Response.json({ error: "Only a validated DRAFT identity provider can be activated." }, { status: 409 });
    }
    const attestation = asText(body.attestation, 500);
    if (!attestation || attestation.length < 12) {
      return Response.json({ error: "Activation requires an attestation of at least 12 characters." }, { status: 400 });
    }
    const issues = identityActivationIssues(current);
    if (issues.length) return Response.json({ error: `Identity provider is not activation-ready. Missing: ${issues.join(", ")}.` }, { status: 409 });
    if (!current.lastValidatedAt) return Response.json({ error: "Validate the identity-provider configuration before activation." }, { status: 409 });
    if (Date.now() - current.lastValidatedAt.getTime() > validationMaxAgeMs()) {
      return Response.json({ error: "Identity-provider validation evidence is stale. Validate again before activation." }, { status: 409 });
    }

    const data = await db.$transaction(async (tx) => {
      const changed = await tx.identityProviderConnection.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          status: current.status,
          updatedAt: current.updatedAt,
          lastValidatedAt: current.lastValidatedAt
        },
        data: { status: ConnectionStatus.ACTIVE }
      });
      if (changed.count !== 1) throw new Error("STATE_CONFLICT");
      const updated = await tx.identityProviderConnection.findUnique({ where: { id } });
      if (!updated) throw new Error("STATE_CONFLICT");
      await appendAudit(tx, ctx, {
        action: "settings.identity-provider-activated",
        resourceType: "IdentityProviderConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: `Administrative activation attestation: ${attestation}`
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
      if (error instanceof Error && error.message === "STATE_CONFLICT") return "STATE_CONFLICT" as const;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return "STATE_CONFLICT" as const;
      return Promise.reject(error);
    });
    if (data === "STATE_CONFLICT") {
      return Response.json({ error: "Identity provider changed concurrently. Refresh and validate again before activation." }, { status: 409 });
    }
    return Response.json({ data });
  }

  if (action === "disable") {
    if (current.status === ConnectionStatus.DISABLED) return Response.json({ data: current });
    const reason = asText(body.reason, 500);
    if (!reason || reason.length < 8) return Response.json({ error: "Disabling requires a reason of at least 8 characters." }, { status: 400 });
    const data = await db.$transaction(async (tx) => {
      const updated = await tx.identityProviderConnection.update({ where: { id }, data: { status: ConnectionStatus.DISABLED } });
      await appendAudit(tx, ctx, {
        action: "settings.identity-provider-disabled",
        resourceType: "IdentityProviderConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: reason
      });
      return updated;
    });
    return Response.json({ data });
  }

  if (current.status !== ConnectionStatus.DISABLED && current.status !== ConnectionStatus.DEGRADED) {
    return Response.json({ error: "Only disabled or degraded identity providers can be reopened as draft." }, { status: 409 });
  }
  const reason = asText(body.reason, 500);
  if (!reason || reason.length < 8) return Response.json({ error: "Reopening requires a reason of at least 8 characters." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const updated = await tx.identityProviderConnection.update({ where: { id }, data: { status: ConnectionStatus.DRAFT, lastValidatedAt: null } });
    await appendAudit(tx, ctx, {
      action: "settings.identity-provider-reopened",
      resourceType: "IdentityProviderConnection",
      resourceId: id,
      classification: DataClassification.RESTRICTED,
      purpose: reason
    });
    return updated;
  });
  return Response.json({ data });
}
