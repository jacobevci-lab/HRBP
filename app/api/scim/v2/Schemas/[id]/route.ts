import { SCIM_USER_SCHEMA, scimAccess, scimError, scimJson, scimUserSchemaDefinition } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = scimAccess(request); if (denied) return denied;
  const id = (await params).id;
  if (id !== SCIM_USER_SCHEMA) return scimError(404, "SCIM schema was not found.");
  return scimJson(scimUserSchemaDefinition());
}
