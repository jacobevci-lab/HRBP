import { ConnectionStatus, DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { integrationValidationCurrent, parseIntegrationProbeOrigins, probeIntegrationEndpoint } from "@/lib/integration-live-validation.mjs";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";
import { runtimeBoolean, runtimeNumber, runtimeString } from "@/lib/runtime-env";
import { integrationActivationIssues } from "@/lib/settings-connection-validation";

type LifecycleAction = "validate" | "activate" | "disable" | "reopen";

function actionValue(value: unknown): LifecycleAction | null {
  return value === "validate" || value === "activate" || value === "disable" || value === "reopen" ? value : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const { id: rawId } = await params;
  const id = asIdentifier(rawId);
  if (!id) return Response.json({ error: "A valid integration id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const action = actionValue(body.action);
  if (!action) return Response.json({ error: "action must be validate, activate, disable or reopen." }, { status: 400 });

  const current = await db.integrationConnection.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!current) return Response.json({ error: "Integration was not found." }, { status: 404 });

  if (action === "validate") {
    if (current.status !== ConnectionStatus.DRAFT) return Response.json({ error: "Only DRAFT integrations can be configuration-validated." }, { status: 409 });
    const issues = integrationActivationIssues(current);
    if (issues.length) return Response.json({ error: `Integration configuration is incomplete. Missing: ${issues.join(", ")}.` }, { status: 409 });

    const allowHttp = runtimeBoolean("HRBP_INTEGRATION_PROBE_ALLOW_HTTP", false);
    const allowedOrigins = parseIntegrationProbeOrigins(
      runtimeString("HRBP_INTEGRATION_PROBE_ALLOWED_ORIGINS") ?? "",
      allowHttp
    );
    if (!allowedOrigins || !allowedOrigins.length) {
      return Response.json({ error: "Live integration validation is not configured with an approved endpoint origin." }, { status: 409 });
    }

    const probe = await probeIntegrationEndpoint({
      baseUrl: current.baseUrl ?? "",
      allowedOrigins,
      allowHttp,
      timeoutMs: runtimeNumber("HRBP_INTEGRATION_PROBE_TIMEOUT_MS", 5000)
    });

    if (!probe.ok) {
      const code = probe.reason === "TARGET_NOT_ALLOWED" ? "TARGET_NOT_ALLOWED" : "TRANSPORT_UNAVAILABLE";
      await db.$transaction(async (tx) => {
        await tx.integrationConnection.update({
          where: { id },
          data: { lastValidatedAt: null, lastError: code }
        });
        await appendAudit(tx, ctx, {
          action: "settings.integration-validation-failed",
          resourceType: "IntegrationConnection",
          resourceId: id,
          classification: DataClassification.RESTRICTED,
          purpose: `Allowlisted live endpoint validation failed: ${code}`
        });
      });
      return Response.json(
        { error: probe.reason === "TARGET_NOT_ALLOWED"
          ? "Integration endpoint is not in the approved live-validation origin allowlist."
          : "Integration endpoint transport could not be validated." },
        { status: probe.reason === "TARGET_NOT_ALLOWED" ? 409 : 502 }
      );
    }

    const data = await db.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.update({
        where: { id },
        data: { lastValidatedAt: new Date(), lastError: null }
      });
      await appendAudit(tx, ctx, {
        action: "settings.integration-config-validated",
        resourceType: "IntegrationConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: `Allowlisted live endpoint transport validated before governed activation (HTTP ${probe.status})`
      });
      return updated;
    });
    return Response.json({
      data,
      validation: { transportReachable: true, httpStatus: probe.status, durationMs: probe.durationMs }
    });
  }

  if (action === "activate") {
    if (current.status === ConnectionStatus.ACTIVE && current.enabled) return Response.json({ data: current });
    const attestation = asText(body.attestation, 500);
    if (!attestation || attestation.length < 12) {
      return Response.json({ error: "Activation requires an attestation of at least 12 characters." }, { status: 400 });
    }
    const issues = integrationActivationIssues(current);
    if (issues.length) return Response.json({ error: `Integration is not activation-ready. Missing: ${issues.join(", ")}.` }, { status: 409 });
    if (!integrationValidationCurrent(current.lastValidatedAt)) return Response.json({ error: "Live integration validation is missing or older than 24 hours. Revalidate the endpoint before activation." }, { status: 409 });

    const data = await db.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.update({
        where: { id },
        data: { status: ConnectionStatus.ACTIVE, enabled: true, lastError: null }
      });
      await appendAudit(tx, ctx, {
        action: "settings.integration-activated",
        resourceType: "IntegrationConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: `Administrative activation attestation: ${attestation}`
      });
      return updated;
    });
    return Response.json({ data });
  }

  if (action === "disable") {
    if (current.status === ConnectionStatus.DISABLED && !current.enabled) return Response.json({ data: current });
    const reason = asText(body.reason, 500);
    if (!reason || reason.length < 8) return Response.json({ error: "Disabling requires a reason of at least 8 characters." }, { status: 400 });
    const data = await db.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.update({
        where: { id },
        data: { status: ConnectionStatus.DISABLED, enabled: false }
      });
      await appendAudit(tx, ctx, {
        action: "settings.integration-disabled",
        resourceType: "IntegrationConnection",
        resourceId: id,
        classification: DataClassification.RESTRICTED,
        purpose: reason
      });
      return updated;
    });
    return Response.json({ data });
  }

  if (current.status !== ConnectionStatus.DISABLED && current.status !== ConnectionStatus.DEGRADED) {
    return Response.json({ error: "Only disabled or degraded integrations can be reopened as draft." }, { status: 409 });
  }
  const reason = asText(body.reason, 500);
  if (!reason || reason.length < 8) return Response.json({ error: "Reopening requires a reason of at least 8 characters." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const updated = await tx.integrationConnection.update({
      where: { id },
      data: { status: ConnectionStatus.DRAFT, enabled: false, lastValidatedAt: null, lastError: null }
    });
    await appendAudit(tx, ctx, {
      action: "settings.integration-reopened",
      resourceType: "IntegrationConnection",
      resourceId: id,
      classification: DataClassification.RESTRICTED,
      purpose: reason
    });
    return updated;
  });
  return Response.json({ data });
}
