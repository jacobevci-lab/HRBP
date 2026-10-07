import { SCIM_LIST_SCHEMA, SCIM_USER_SCHEMA, scimAuthorized, scimError, scimJson, scimRuntimeConfig } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  const config = scimRuntimeConfig();
  const location = config.baseUrl ? new URL("/api/scim/v2/ResourceTypes/User", config.baseUrl).toString() : undefined;
  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [{
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: SCIM_USER_SCHEMA,
      schemaExtensions: [],
      meta: { resourceType: "ResourceType", ...(location ? { location } : {}) }
    }]
  });
}
