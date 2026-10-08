import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { assurancePolicyIssues, authenticationAssuranceConfiguration } from "@/lib/auth-assurance";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asFiniteNumber, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "settings:read")) return forbidden();

  const [tenant, policy] = await Promise.all([
    db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { region: true } }),
    db.tenantSecurityPolicy.findUnique({ where: { tenantId: ctx.tenantId } })
  ]);
  if (!tenant) return Response.json({ error: "Tenant was not found." }, { status: 404 });

  return Response.json({
    data: policy ?? {
      tenantId: ctx.tenantId,
      dataRegion: tenant.region,
      customerManagedKey: false,
      mfaRequired: false,
      sessionMaxMinutes: 480,
      exportRestrictedData: false,
      downloadWatermarking: true,
      deviceTrustRequired: false,
      breakGlassEnabled: true,
      updatedAt: null
    },
    permissions: { write: can(ctx, "settings:write") },
    assurance: (() => {
      const config = authenticationAssuranceConfiguration();
      return {
        mfaConfigured: config.mfaConfigured,
        deviceTrustConfigured: config.deviceTrustConfigured
      };
    })()
  }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });

  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { region: true } });
  if (!tenant) return Response.json({ error: "Tenant was not found." }, { status: 404 });

  const existing = await db.tenantSecurityPolicy.findUnique({ where: { tenantId: ctx.tenantId } });
  const dataRegion = body.dataRegion === undefined
    ? existing?.dataRegion ?? tenant.region
    : asText(body.dataRegion, 64);
  if (!dataRegion) return Response.json({ error: "A valid dataRegion is required." }, { status: 400 });

  const sessionValue = body.sessionMaxMinutes === undefined
    ? existing?.sessionMaxMinutes ?? 480
    : asFiniteNumber(body.sessionMaxMinutes);
  if (sessionValue === null || !Number.isInteger(sessionValue) || sessionValue < 15 || sessionValue > 1440) {
    return Response.json({ error: "sessionMaxMinutes must be an integer between 15 and 1440." }, { status: 400 });
  }

  const kmsKeyRefParsed = body.kmsKeyRef === undefined ? undefined : asOptionalText(body.kmsKeyRef, 512);
  if (kmsKeyRefParsed === null) return Response.json({ error: "kmsKeyRef is invalid." }, { status: 400 });
  const customerManagedKey = booleanValue(body.customerManagedKey, existing?.customerManagedKey ?? false);
  const kmsKeyRef = kmsKeyRefParsed === undefined ? existing?.kmsKeyRef ?? null : kmsKeyRefParsed ?? null;
  if (customerManagedKey && !kmsKeyRef) {
    return Response.json({ error: "kmsKeyRef is required when customerManagedKey is enabled." }, { status: 400 });
  }

  const next = {
    dataRegion,
    kmsKeyRef,
    customerManagedKey,
    mfaRequired: booleanValue(body.mfaRequired, existing?.mfaRequired ?? false),
    sessionMaxMinutes: sessionValue,
    exportRestrictedData: booleanValue(body.exportRestrictedData, existing?.exportRestrictedData ?? false),
    downloadWatermarking: booleanValue(body.downloadWatermarking, existing?.downloadWatermarking ?? true),
    deviceTrustRequired: booleanValue(body.deviceTrustRequired, existing?.deviceTrustRequired ?? false),
    breakGlassEnabled: booleanValue(body.breakGlassEnabled, existing?.breakGlassEnabled ?? true),
    updatedById: ctx.actorId
  };

  const assuranceIssues = assurancePolicyIssues({
    mfaRequired: next.mfaRequired,
    deviceTrustRequired: next.deviceTrustRequired
  });
  if (assuranceIssues.length) {
    return Response.json({
      error: `Authentication assurance is not configured for: ${assuranceIssues.join(", ")}.`
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const enablingMfa = next.mfaRequired && existing?.mfaRequired !== true;
  if (enablingMfa && ctx.mfaSatisfied !== true) {
    return Response.json({
      error: "MFA cannot be enabled because the current OIDC session does not demonstrate MFA assurance. Complete an assured sign-in first."
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const enablingDeviceTrust = next.deviceTrustRequired && existing?.deviceTrustRequired !== true;
  if (enablingDeviceTrust && ctx.deviceTrustSatisfied !== true) {
    return Response.json({
      error: "Trusted-device enforcement cannot be enabled because the current OIDC session does not demonstrate device-trust assurance."
    }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const data = await db.$transaction(async (tx) => {
    const policy = await tx.tenantSecurityPolicy.upsert({
      where: { tenantId: ctx.tenantId },
      update: next,
      create: { tenantId: ctx.tenantId, ...next }
    });
    await appendAudit(tx, ctx, {
      action: "settings.security-policy-updated",
      resourceType: "TenantSecurityPolicy",
      resourceId: policy.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Tenant security posture configuration update"
    });
    return policy;
  });

  return Response.json({ data });
}
