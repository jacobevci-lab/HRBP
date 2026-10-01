import { authConfigurationStatus, localAuthConfigurationStatus } from "@/lib/auth-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const oidc = authConfigurationStatus();
  const local = localAuthConfigurationStatus();
  const anyReady = oidc.configured || local.configured;
  const authentication = oidc.configured && local.configured
    ? "multi-mode"
    : local.configured
      ? "local"
      : "oidc";

  return Response.json({
    status: anyReady ? "ok" : "configuration_required",
    authentication,
    session: "signed-http-only-cookie",
    configured: anyReady,
    missing: anyReady ? [] : [...new Set([...oidc.missing, ...(local.enabled ? local.missing : [])])],
    modes: [
      { mode: "oidc", enabled: true, configured: oidc.configured, missing: oidc.missing },
      { mode: "local", enabled: local.enabled, configured: local.configured, missing: local.enabled ? local.missing : [] }
    ]
  }, { status: anyReady ? 200 : 503, headers: { "cache-control": "no-store" } });
}
