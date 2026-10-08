import { scimRuntimeConfig } from "@/lib/scim";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const config = scimRuntimeConfig();
  const healthy = !config.enabled || config.configured;
  return Response.json({
    status: healthy ? "ok" : "error",
    enabled: config.enabled,
    configured: config.configured,
    allowedDomainCount: config.allowedDomains.length,
    unmanagedAdoptionEnabled: config.allowUnmanagedAdoption
  }, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
