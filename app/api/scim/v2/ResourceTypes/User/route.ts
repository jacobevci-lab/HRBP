import { scimAccess, scimJson, scimRuntimeConfig, scimUserResourceType } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
  return scimJson(scimUserResourceType(scimRuntimeConfig().baseUrl));
}
