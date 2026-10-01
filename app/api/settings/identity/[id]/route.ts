import { ConnectionStatus, DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { identityActivationIssues } from "@/lib/settings-connection-validation";

type LifecycleAction = "validate" | "activate" | "disable" | "reopen";

function actionValue(value: unknown): LifecycleAction | null {
  return value === "validate" || value === "activate" || value === "disable" || value === "reopen" ? value : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
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
    const data = await db.$transaction(async (tx) => {
      const updated = await tx.identityProviderConnection.update({ where: { id }, data: { lastValidatedAt: new Date() } });
      await appendAudit(tx, ctx, {
        action: "settings.identity-provider-config-validated",
        resourceType: "IdentityProviderConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: "Identity-provider configuration metadata validated before governed activation"
      });
      return updated;
    });
    return Response.json({ data });
  }

  if (action === "activate") {
    if (current.status === ConnectionStatus.ACTIVE) return Response.json({ data: current });
    const attestation = asText(body.attestation, 500);
    if (!attestation || attestation.length < 12) {
      return Response.json({ error: "Activation requires an attestation of at least 12 characters." }, { status: 400 });
    }
    const issues = identityActivationIssues(current);
    if (issues.length) return Response.json({ error: `Identity provider is not activation-ready. Missing: ${issues.join(", ")}.` }, { status: 409 });
    if (!current.lastValidatedAt) return Response.json({ error: "Validate the identity-provider configuration before activation." }, { status: 409 });

    const data = await db.$transaction(async (tx) => {
      const updated = await tx.identityProviderConnection.update({
        where: { id },
        data: { status: ConnectionStatus.ACTIVE }
      });
      await appendAudit(tx, ctx, {
        action: "settings.identity-provider-activated",
        resourceType: "IdentityProviderConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: `Administrative activation attestation: ${attestation}`
      });
      return updated;
    });
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
