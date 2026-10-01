import { authConfigurationStatus, localAuthConfigurationStatus } from "@/lib/auth-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const oidc = authConfigurationStatus();
  const local = localAuthConfigurationStatus();
  const anyReady = oidc.configured || local.configured;

  return Response.json({
    status: anyReady ? "ok" : "configuration_required",
    authentication: {
      modes: [
        { mode: "oidc", enabled: true, configured: oidc.configured },
        { mode: "local", enabled: local.enabled, configured: local.configured }
      ],
      session: "signed-http-only-cookie",
      configured: anyReady,
      missing: {
        oidc: oidc.missing,
        local: local.enabled ? local.missing : []
      }
    }
  }, { status: anyReady ? 200 : 503, headers: { "cache-control": "no-store" } });
}
