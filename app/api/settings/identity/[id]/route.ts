import { ConnectionStatus, DataClassification, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { getOidcConfig } from "@/lib/auth-config";
import { db } from "@/lib/db";
import { lockIdentityProviderTenant } from "@/lib/identity-provider-lifecycle";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { oidcValidationCurrent, probeOidcDiscovery } from "@/lib/oidc";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { identityActivationIssues } from "@/lib/settings-connection-validation";
import {
  identityRuntimeActivationIssues,
  isOidcRuntimeProvider,
  oidcRuntimeProviderTypes
} from "@/lib/runtime-identity-provider";

type LifecycleAction = "validate" | "activate" | "disable" | "reopen";
type LifecycleCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "STATE_CONFLICT"
  | "CONFIG_INCOMPLETE"
  | "VALIDATION_REQUIRED"
  | "VALIDATION_EXPIRED"
  | "LIVE_VALIDATION_FAILED"
  | "RUNTIME_NOT_READY"
  | "OIDC_CONFLICT";

class IdentityLifecycleError extends Error {
  constructor(public readonly code: LifecycleCode, public readonly detail?: string) {
    super(code);
  }
}

function actionValue(value: unknown): LifecycleAction | null {
  return value === "validate" || value === "activate" || value === "disable" || value === "reopen" ? value : null;
}

function lifecycleErrorResponse(error: unknown) {
  if (error instanceof IdentityLifecycleError) {
    if (error.code === "NOT_FOUND") {
      return Response.json({ error: "Identity provider was not found." }, { status: 404 });
    }
    if (error.code === "STATE_CONFLICT") {
      return Response.json({ error: "Identity provider state changed concurrently. Refresh and retry." }, { status: 409 });
    }
    if (error.code === "CONFIG_INCOMPLETE") {
      return Response.json({ error: `Identity provider configuration is incomplete. Missing: ${error.detail ?? "required metadata"}.` }, { status: 409 });
    }
    if (error.code === "VALIDATION_REQUIRED") {
      return Response.json({ error: "Validate the identity-provider configuration before activation." }, { status: 409 });
    }
    if (error.code === "VALIDATION_EXPIRED") {
      return Response.json({ error: "OIDC live validation evidence is older than 24 hours. Revalidate the provider before activation." }, { status: 409 });
    }
    if (error.code === "LIVE_VALIDATION_FAILED") {
      return Response.json({ error: `OIDC live validation failed. ${error.detail ?? "Provider discovery is unavailable or invalid."}` }, { status: 409 });
    }
    if (error.code === "RUNTIME_NOT_READY") {
      return Response.json({
        error: `Identity provider cannot be activated against the current login runtime. Missing, mismatched or unsupported: ${error.detail ?? "runtime policy"}.`
      }, { status: 409 });
    }
    if (error.code === "OIDC_CONFLICT") {
      return Response.json({
        error: `Only one runtime OIDC-family identity provider can be active. Disable ${error.detail ?? "the active provider"} before activating this connection.`
      }, { status: 409 });
    }
    return Response.json({ error: error.detail ?? "The requested identity-provider lifecycle transition is not allowed." }, { status: 409 });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return Response.json({ error: "Identity provider state changed concurrently. Refresh and retry." }, { status: 409 });
  }
  return null;
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

  if (action === "validate") {
    try {
      const snapshot = await db.identityProviderConnection.findFirst({
        where: { id, tenantId: ctx.tenantId }
      });
      if (!snapshot) throw new IdentityLifecycleError("NOT_FOUND");
      if (snapshot.status !== ConnectionStatus.DRAFT) {
        throw new IdentityLifecycleError("INVALID_STATE", "Only DRAFT identity providers can be configuration-validated.");
      }

      const issues = identityActivationIssues(snapshot);
      if (issues.length) throw new IdentityLifecycleError("CONFIG_INCOMPLETE", issues.join(", "));

      let liveValidationDetail: string | null = null;
      if (isOidcRuntimeProvider(snapshot.type)) {
        const runtimeIssues = identityRuntimeActivationIssues(snapshot);
        if (runtimeIssues.length) throw new IdentityLifecycleError("RUNTIME_NOT_READY", runtimeIssues.join(", "));
        const runtime = getOidcConfig();
        if (!runtime) throw new IdentityLifecycleError("RUNTIME_NOT_READY", "runtime OIDC configuration");

        try {
          const metadata = await probeOidcDiscovery(runtime.issuer);
          liveValidationDetail = `Live OIDC discovery validated issuer and secure endpoints for ${metadata.issuer}`;
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 240) : "Provider discovery is unavailable or invalid.";
          console.error("[HRBP] OIDC live validation failed.", error);
          await db.$transaction(async (tx) => {
            await appendAudit(tx, ctx, {
              action: "settings.identity-provider-live-validation-failed",
              resourceType: "IdentityProviderConnection",
              resourceId: id,
              classification: DataClassification.RESTRICTED,
              purpose: reason
            });
          });
          throw new IdentityLifecycleError("LIVE_VALIDATION_FAILED", reason);
        }
      }

      const data = await db.$transaction(async (tx) => {
        await lockIdentityProviderTenant(tx, ctx.tenantId);
        const current = await tx.identityProviderConnection.findFirst({
          where: { id, tenantId: ctx.tenantId }
        });
        if (!current) throw new IdentityLifecycleError("NOT_FOUND");
        if (current.status !== ConnectionStatus.DRAFT) {
          throw new IdentityLifecycleError("INVALID_STATE", "Only DRAFT identity providers can be configuration-validated.");
        }
        if (current.updatedAt.getTime() !== snapshot.updatedAt.getTime()) {
          throw new IdentityLifecycleError("STATE_CONFLICT");
        }

        const currentIssues = identityActivationIssues(current);
        if (currentIssues.length) throw new IdentityLifecycleError("CONFIG_INCOMPLETE", currentIssues.join(", "));
        if (isOidcRuntimeProvider(current.type)) {
          const runtimeIssues = identityRuntimeActivationIssues(current);
          if (runtimeIssues.length) throw new IdentityLifecycleError("RUNTIME_NOT_READY", runtimeIssues.join(", "));
        }

        const result = await tx.identityProviderConnection.updateMany({
          where: {
            id,
            tenantId: ctx.tenantId,
            status: ConnectionStatus.DRAFT,
            updatedAt: current.updatedAt
          },
          data: { lastValidatedAt: new Date() }
        });
        if (result.count !== 1) throw new IdentityLifecycleError("STATE_CONFLICT");

        await appendAudit(tx, ctx, {
          action: isOidcRuntimeProvider(current.type)
            ? "settings.identity-provider-live-validated"
            : "settings.identity-provider-config-validated",
          resourceType: "IdentityProviderConnection",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: liveValidationDetail ?? "Identity-provider configuration metadata validated before governed activation"
        });
        return tx.identityProviderConnection.findUnique({ where: { id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return Response.json({ data });
    } catch (error) {
      const response = lifecycleErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }

  if (action === "activate") {
    const attestation = asText(body.attestation, 500);
    if (!attestation || attestation.length < 12) {
      return Response.json({ error: "Activation requires an attestation of at least 12 characters." }, { status: 400 });
    }

    try {
      const data = await db.$transaction(async (tx) => {
        await lockIdentityProviderTenant(tx, ctx.tenantId);
        const current = await tx.identityProviderConnection.findFirst({
          where: { id, tenantId: ctx.tenantId }
        });
        if (!current) throw new IdentityLifecycleError("NOT_FOUND");
        if (current.status === ConnectionStatus.ACTIVE) return current;
        if (current.status !== ConnectionStatus.DRAFT) {
          throw new IdentityLifecycleError("INVALID_STATE", "Only DRAFT identity providers can be activated. Reopen and validate the connection first.");
        }

        const issues = identityActivationIssues(current);
        if (issues.length) throw new IdentityLifecycleError("CONFIG_INCOMPLETE", issues.join(", "));
        if (!current.lastValidatedAt) throw new IdentityLifecycleError("VALIDATION_REQUIRED");
        if (isOidcRuntimeProvider(current.type) && !oidcValidationCurrent(current.lastValidatedAt)) {
          throw new IdentityLifecycleError("VALIDATION_EXPIRED");
        }

        const runtimeIssues = identityRuntimeActivationIssues(current);
        if (runtimeIssues.length) throw new IdentityLifecycleError("RUNTIME_NOT_READY", runtimeIssues.join(", "));

        if (isOidcRuntimeProvider(current.type)) {
          const conflictingProvider = await tx.identityProviderConnection.findFirst({
            where: {
              tenantId: ctx.tenantId,
              id: { not: id },
              status: ConnectionStatus.ACTIVE,
              type: { in: [...oidcRuntimeProviderTypes] }
            },
            select: { id: true, name: true }
          });
          if (conflictingProvider) throw new IdentityLifecycleError("OIDC_CONFLICT", conflictingProvider.name);
        }

        const result = await tx.identityProviderConnection.updateMany({
          where: {
            id,
            tenantId: ctx.tenantId,
            status: ConnectionStatus.DRAFT,
            updatedAt: current.updatedAt
          },
          data: { status: ConnectionStatus.ACTIVE }
        });
        if (result.count !== 1) throw new IdentityLifecycleError("STATE_CONFLICT");

        await appendAudit(tx, ctx, {
          action: "settings.identity-provider-activated",
          resourceType: "IdentityProviderConnection",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: `Administrative activation attestation: ${attestation}`
        });

        return tx.identityProviderConnection.findUnique({ where: { id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return Response.json({ data });
    } catch (error) {
      const response = lifecycleErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }

  if (action === "disable") {
    const reason = asText(body.reason, 500);
    if (!reason || reason.length < 8) {
      return Response.json({ error: "Disabling requires a reason of at least 8 characters." }, { status: 400 });
    }

    try {
      const data = await db.$transaction(async (tx) => {
        await lockIdentityProviderTenant(tx, ctx.tenantId);
        const current = await tx.identityProviderConnection.findFirst({
          where: { id, tenantId: ctx.tenantId }
        });
        if (!current) throw new IdentityLifecycleError("NOT_FOUND");
        if (current.status === ConnectionStatus.DISABLED) return current;
        if (current.status !== ConnectionStatus.ACTIVE && current.status !== ConnectionStatus.DEGRADED) {
          throw new IdentityLifecycleError("INVALID_STATE", "Only ACTIVE or DEGRADED identity providers can be disabled.");
        }

        const result = await tx.identityProviderConnection.updateMany({
          where: {
            id,
            tenantId: ctx.tenantId,
            status: current.status,
            updatedAt: current.updatedAt
          },
          data: { status: ConnectionStatus.DISABLED }
        });
        if (result.count !== 1) throw new IdentityLifecycleError("STATE_CONFLICT");

        await appendAudit(tx, ctx, {
          action: "settings.identity-provider-disabled",
          resourceType: "IdentityProviderConnection",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: reason
        });
        return tx.identityProviderConnection.findUnique({ where: { id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return Response.json({ data });
    } catch (error) {
      const response = lifecycleErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }

  const reason = asText(body.reason, 500);
  if (!reason || reason.length < 8) {
    return Response.json({ error: "Reopening requires a reason of at least 8 characters." }, { status: 400 });
  }

  try {
    const data = await db.$transaction(async (tx) => {
      await lockIdentityProviderTenant(tx, ctx.tenantId);
      const current = await tx.identityProviderConnection.findFirst({
        where: { id, tenantId: ctx.tenantId }
      });
      if (!current) throw new IdentityLifecycleError("NOT_FOUND");
      if (current.status !== ConnectionStatus.DISABLED && current.status !== ConnectionStatus.DEGRADED) {
        throw new IdentityLifecycleError("INVALID_STATE", "Only disabled or degraded identity providers can be reopened as draft.");
      }

      const result = await tx.identityProviderConnection.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          status: current.status,
          updatedAt: current.updatedAt
        },
        data: { status: ConnectionStatus.DRAFT, lastValidatedAt: null }
      });
      if (result.count !== 1) throw new IdentityLifecycleError("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: "settings.identity-provider-reopened",
        resourceType: "IdentityProviderConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: reason
      });
      return tx.identityProviderConnection.findUnique({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return Response.json({ data });
  } catch (error) {
    const response = lifecycleErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
