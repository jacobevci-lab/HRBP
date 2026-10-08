import { SCIM_LIST_SCHEMA, scimAccess, scimJson, scimUserSchemaDefinition } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [scimUserSchemaDefinition()]
  });
}
