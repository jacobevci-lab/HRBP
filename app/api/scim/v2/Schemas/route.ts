import { SCIM_LIST_SCHEMA, scimAccess, scimGroupSchemaDefinition, scimJson, scimUserSchemaDefinition } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await scimAccess(request); if (denied) return denied;
  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
    startIndex: 1,
    itemsPerPage: 2,
    Resources: [scimUserSchemaDefinition(), scimGroupSchemaDefinition()]
  });
}
