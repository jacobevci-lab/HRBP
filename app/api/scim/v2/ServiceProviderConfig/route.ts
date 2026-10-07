import { scimAuthorized, scimError, scimJson } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!scimAuthorized(request)) return scimError(401, "Valid SCIM bearer credentials are required.");
  return scimJson({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      type: "oauthbearertoken",
      name: "Bearer Token",
      description: "Static tenant-scoped SCIM bearer token configured in the deployment secret store.",
      specUri: "https://www.rfc-editor.org/rfc/rfc6750"
    }]
  });
}
