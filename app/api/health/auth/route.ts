import { authConfigurationStatus } from "@/lib/auth-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const configuration = authConfigurationStatus();
  return Response.json({
    status: configuration.configured ? "ok" : "configuration_required",
    authentication: "oidc",
    session: "signed-http-only-cookie",
    configured: configuration.configured,
    missing: configuration.missing
  }, { status: configuration.configured ? 200 : 503, headers: { "cache-control": "no-store" } });
}
