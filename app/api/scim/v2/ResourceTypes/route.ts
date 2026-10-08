import { SCIM_LIST_SCHEMA, scimAccess, scimJson, scimRuntimeConfig, scimUserResourceType } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
  const config = scimRuntimeConfig();
  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [scimUserResourceType(config.baseUrl)]
  });
}
