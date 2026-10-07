import { SCIM_LIST_SCHEMA, scimAuthorized, scimError, scimJson } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  return scimJson({ schemas: [SCIM_LIST_SCHEMA], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] });
}

export async function POST(request: Request) {
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  return scimError(501, "SCIM group provisioning is not supported by this HRBP release.");
}
