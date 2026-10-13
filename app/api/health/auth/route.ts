import { authenticationAssuranceConfiguration } from "@/lib/auth-assurance";
import { authConfigurationStatus, getOidcConfig, localAuthConfigurationStatus } from "@/lib/auth-config";
import { withDb } from "@/lib/db";
import { enforceOidcRuntimeBinding } from "@/lib/runtime-identity-provider";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OidcRuntimeHealth = {
  ready: boolean;
  governance: "managed" | "legacy" | "blocked" | "unconfigured";
  runtimeIssue: null | "governed_provider_inactive" | "governed_provider_ambiguous" | "governed_provider_drift" | "governance_unavailable";
};

function boundedOidcRuntimeIssue(error: unknown): OidcRuntimeHealth["runtimeIssue"] {
  const message = error instanceof Error ? error.message : "";
  if (message === "IDENTITY_PROVIDER_INACTIVE") return "governed_provider_inactive";
  if (message === "IDENTITY_PROVIDER_AMBIGUOUS") return "governed_provider_ambiguous";
  if (message === "IDENTITY_PROVIDER_DRIFT") return "governed_provider_drift";
  return "governance_unavailable";
}

async function oidcRuntimeHealth(environmentConfigured: boolean): Promise<OidcRuntimeHealth> {
  const config = getOidcConfig();
  if (!environmentConfigured || !config) {
    return { ready: false, governance: "unconfigured", runtimeIssue: null };
  }

  try {
    const binding = await withDb((db) => enforceOidcRuntimeBinding(db, config));
    return {
      ready: true,
      governance: binding.managed ? "managed" : "legacy",
      runtimeIssue: null
    };
  } catch (error) {
    return {
      ready: false,
      governance: "blocked",
      runtimeIssue: boundedOidcRuntimeIssue(error)
    };
  }
}

export async function GET() {
  const oidc = authConfigurationStatus();
  const local = localAuthConfigurationStatus();
  const assurance = authenticationAssuranceConfiguration();
  const oidcRuntime = await oidcRuntimeHealth(oidc.configured);
  const oidcReady = oidc.configured && oidcRuntime.ready;
  const anyReady = oidcReady || local.configured;
  const oidcGovernanceBlocked = oidc.configured && !oidcRuntime.ready;
  const authentication = oidcReady && local.configured
    ? "multi-mode"
    : local.configured
      ? "local"
      : oidcReady
        ? "oidc"
        : "unavailable";
  const status = anyReady
    ? oidcGovernanceBlocked
      ? "degraded"
      : "ok"
    : "configuration_required";

  return Response.json({
    status,
    authentication,
    session: "signed-http-only-cookie",
    configured: anyReady,
    missing: anyReady ? [] : [...new Set([...oidc.missing, ...(local.enabled ? local.missing : [])])],
    assurance: {
      mfaConfigured: assurance.mfaConfigured,
      deviceTrustConfigured: assurance.deviceTrustConfigured
    },
    modes: [
      {
        mode: "oidc",
        enabled: true,
        configured: oidcReady,
        environmentConfigured: oidc.configured,
        governance: oidcRuntime.governance,
        runtimeIssue: oidcRuntime.runtimeIssue,
        missing: oidc.missing
      },
      { mode: "local", enabled: local.enabled, configured: local.configured, missing: local.enabled ? local.missing : [] }
    ]
  }, { status: anyReady ? 200 : 503, headers: { "cache-control": "no-store" } });
}
