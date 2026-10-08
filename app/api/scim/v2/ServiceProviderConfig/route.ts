import { scimAccess, scimJson } from "@/lib/scim";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = scimAccess(request); if (denied) return denied;
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
      description: "Tenant-scoped HRBP SCIM bearer credential.",
      specUri: "https://www.rfc-editor.org/rfc/rfc6750"
    }]
  });
}
