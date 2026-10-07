import { SCIM_LIST_SCHEMA, SCIM_USER_SCHEMA, scimAuthorized, scimError, scimJson } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [{
      id: SCIM_USER_SCHEMA,
      name: "User",
      description: "HRBP tenant application user",
      attributes: [
        { name: "userName", type: "string", multiValued: false, required: true, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "server" },
        { name: "displayName", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "externalId", type: "string", multiValued: false, required: false, caseExact: true, mutability: "readWrite", returned: "default", uniqueness: "server" },
        { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite", returned: "default" }
      ],
      meta: { resourceType: "Schema" }
    }]
  });
}
