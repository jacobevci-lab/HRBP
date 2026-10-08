import { SCIM_LIST_SCHEMA, scimAccess, scimError, scimJson } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
  return scimJson({ schemas: [SCIM_LIST_SCHEMA], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] });
}

export async function POST(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
  return scimError(501, "SCIM group provisioning is not supported by this HRBP release.");
}
