import { scimAccess, scimGroupResourceType, scimJson, scimRuntimeConfig } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await scimAccess(request); if (denied) return denied;
  return scimJson(scimGroupResourceType(scimRuntimeConfig().baseUrl));
}
