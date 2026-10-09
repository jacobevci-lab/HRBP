import {
  SCIM_GROUP_SCHEMA,
  SCIM_USER_SCHEMA,
  scimAccess,
  scimError,
  scimGroupSchemaDefinition,
  scimJson,
  scimUserSchemaDefinition
} from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await scimAccess(request); if (denied) return denied;
  const id = (await params).id;
  if (id === SCIM_USER_SCHEMA) return scimJson(scimUserSchemaDefinition());
  if (id === SCIM_GROUP_SCHEMA) return scimJson(scimGroupSchemaDefinition());
  return scimError(404, "SCIM schema was not found.");
}
