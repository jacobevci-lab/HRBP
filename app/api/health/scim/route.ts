import { db } from "@/lib/db";
import { resolveGovernedScimPolicy, scimRuntimeConfig } from "@/lib/scim";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const config = scimRuntimeConfig();
  try {
    const policy = await resolveGovernedScimPolicy(db, config.tenantId);
    const requestedEnabled = policy.managed ? policy.scimEnabled : config.enabled;
    const effectiveEnabled = requestedEnabled && config.configured;
    const healthy = !requestedEnabled || config.configured;

    return Response.json({
      status: healthy ? "ok" : "error",
      enabled: effectiveEnabled,
      runtimeEnabled: config.enabled,
      configured: config.configured,
      governed: policy.managed,
      governedProvider: policy.managed ? policy.providerName : null,
      governedScimEnabled: policy.managed ? policy.scimEnabled : null,
      governedProviderInactive: policy.managed ? policy.inactive : false,
      allowedDomainCount: config.allowedDomains.length,
      unmanagedAdoptionEnabled: config.allowUnmanagedAdoption,
      rotationOverlapActive: config.rotationOverlapActive
    }, {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
    });
  } catch {
    return Response.json({
      status: "error",
      enabled: false,
      runtimeEnabled: config.enabled,
      configured: config.configured,
      governed: null,
      governedProvider: null,
      governedScimEnabled: null,
      governedProviderInactive: null,
      allowedDomainCount: config.allowedDomains.length,
      unmanagedAdoptionEnabled: config.allowUnmanagedAdoption,
      rotationOverlapActive: config.rotationOverlapActive,
      policyUnavailable: true
    }, {
      status: 503,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
    });
  }
}
