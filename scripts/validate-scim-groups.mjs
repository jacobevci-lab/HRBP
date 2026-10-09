import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(path + ": " + message);
}
function reject(path, text, pattern, message) {
  if (pattern.test(text)) failures.push(path + ": " + message);
}

const schemaPath = "prisma/access.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /model ScimGroup[\s\S]*externalId\s+String\?[\s\S]*displayName\s+String[\s\S]*members\s+ScimGroupMember\[\]/, "SCIM group state must be durable");
expect(schemaPath, schema, /model ScimGroupMember[\s\S]*groupId\s+String[\s\S]*userId\s+String[\s\S]*@@unique\(\[groupId, userId\]\)/, "group membership must be unique per user");

const migrationPath = "prisma/migrations/20261008213000_scim_group_provisioning/migration.sql";
const migration = await source(migrationPath);
expect(migrationPath, migration, /CREATE TABLE "ScimGroup"/, "versioned migration must create SCIM groups");
expect(migrationPath, migration, /ScimGroupMember_userId_fkey[\s\S]*REFERENCES "UserAccount"/, "membership must retain database user identity integrity");
expect(migrationPath, migration, /ScimGroupMember_groupId_fkey[\s\S]*REFERENCES "ScimGroup"/, "membership must retain database group integrity");

const protocolPath = "lib/scim-protocol.mjs";
const protocol = await source(protocolPath);
expect(protocolPath, protocol, /SCIM_GROUP_SCHEMA/, "SCIM Group schema URI must be defined");
expect(protocolPath, protocol, /parseScimGroupMembers[\s\S]*length > 1000/, "group membership payloads must be bounded");
expect(protocolPath, protocol, /applyScimGroupPatch[\s\S]*members\\\[value\\s\+eq/, "SCIM member delta removal must be explicitly parsed");
reject(protocolPath, protocol, /TENANT_ADMIN|PlatformRole/, "SCIM protocol parsing must not carry authorization role mutation");

const collectionPath = "app/api/scim/v2/Groups/route.ts";
const collection = await source(collectionPath);
expect(collectionPath, collection, /parseScimGroupFilter/, "group list must support bounded SCIM filtering");
expect(collectionPath, collection, /provisioningSource:\s*"SCIM"[\s\S]*id:\s*\{ in: uniqueMemberIds \}/, "group members must resolve only to SCIM-managed tenant users");
expect(collectionPath, collection, /lockScimTenant/, "group writes must serialize against SCIM identity writes");
expect(collectionPath, collection, /TransactionIsolationLevel\.Serializable/, "group creation/update must use serializable isolation");
expect(collectionPath, collection, /identity\.scim-group-provisioned/, "group provisioning must be audited");
expect(collectionPath, collection, /identity\.scim-group-updated/, "group synchronization updates must be audited");
reject(collectionPath, collection, /501/, "SCIM Group collection must no longer be an unsupported stub");

const resourcePath = "app/api/scim/v2/Groups/[id]/route.ts";
const resource = await source(resourcePath);
expect(resourcePath, resource, /export async function GET/, "group resource must support GET");
expect(resourcePath, resource, /export async function PUT/, "group resource must support PUT");
expect(resourcePath, resource, /export async function PATCH/, "group resource must support PATCH");
expect(resourcePath, resource, /export async function DELETE/, "group resource must support DELETE");
expect(resourcePath, resource, /provisioningSource:\s*"SCIM"/, "membership replacement must reject unmanaged application users");
expect(resourcePath, resource, /expectedUpdatedAt[\s\S]*SCIM_GROUP_STATE_CONFLICT/, "group PATCH must reject stale concurrent membership state");
expect(resourcePath, resource, /identity\.scim-group-patched[\s\S]*identity\.scim-group-deprovisioned/, "group patch/delete must be audited");
reject(resourcePath, resource, /role\s*:/, "group lifecycle must not directly change application roles");

const resourceTypesPath = "app/api/scim/v2/ResourceTypes/route.ts";
const resourceTypes = await source(resourceTypesPath);
expect(resourceTypesPath, resourceTypes, /scimGroupResourceType/, "SCIM discovery must advertise Group resource type");

const schemasPath = "app/api/scim/v2/Schemas/route.ts";
const schemas = await source(schemasPath);
expect(schemasPath, schemas, /scimGroupSchemaDefinition/, "SCIM discovery must advertise Group schema");

const settingsPath = "components/settings-live-page.tsx";
const settings = await source(settingsPath);
expect(settingsPath, settings, /scimGroup\.count[\s\S]*scimGroupMember\.count/, "settings operations must expose SCIM group and membership health");
expect(settingsPath, settings, /groups \/ \$\{scimMembershipCount\} memberships|grup \/ \$\{scimMembershipCount\} üyelik/, "settings must distinguish user and group provisioning telemetry");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /scim:groups:validate/, "SCIM group validator must be registered");
expect(packagePath, pkg, /scim:validate[^\n]*scim:groups:validate/, "SCIM group governance must run inside the main SCIM validation gate");

if (failures.length) {
  console.error("SCIM group provisioning validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("SCIM group provisioning validation passed.");
