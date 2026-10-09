import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(path + ": " + message);
}
function reject(path, text, pattern, message) {
  if (pattern.test(text)) failures.push(path + ": " + message);
}

const schemaPath = "prisma/schema.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /roleManagedByScimGroup\s+Boolean\s+@default\(false\)/, "user accounts must track whether role ownership is directory-managed");

const accessPath = "prisma/access.prisma";
const access = await source(accessPath);
expect(accessPath, access, /enum ScimRoleMappingStatus[\s\S]*DRAFT[\s\S]*ACTIVE[\s\S]*DISABLED/, "mapping lifecycle must be explicit");
expect(accessPath, access, /model ScimGroupRoleMapping[\s\S]*groupId\s+String\s+@unique[\s\S]*role\s+PlatformRole[\s\S]*status\s+ScimRoleMappingStatus/, "one governed role mapping must exist per directory group");

const migrationPath = "prisma/migrations/20261009070000_scim_safe_role_mapping/migration.sql";
const migration = await source(migrationPath);
expect(migrationPath, migration, /ADD COLUMN "roleManagedByScimGroup" BOOLEAN NOT NULL DEFAULT false/, "migration must preserve legacy manual role ownership");
expect(migrationPath, migration, /CREATE TABLE "ScimGroupRoleMapping"/, "mapping state must be versioned");
expect(migrationPath, migration, /ScimGroupRoleMapping_groupId_key/, "each SCIM group must have at most one governed role mapping");

const helperPath = "lib/scim-role-mapping.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /PlatformRole\.EMPLOYEE[\s\S]*PlatformRole\.MANAGER[\s\S]*PlatformRole\.HRBP[\s\S]*PlatformRole\.RECRUITER/, "directory assignment must use the bounded workforce-role allowlist");
for (const privileged of [
  "TENANT_ADMIN", "SECURITY_AUDITOR", "PRIVACY_OFFICER", "LEGAL",
  "ER_INVESTIGATOR", "PAYROLL_ADMIN", "COMPENSATION_ADMIN", "HR_OPERATIONS"
]) {
  reject(helperPath, helper.match(/scimDirectoryAssignableRoles = \[[\s\S]*?\] as const/)?.[0] ?? "", new RegExp("PlatformRole\\." + privileged), privileged + " must not be directory-assignable");
}
expect(helperPath, helper, /roles\.length > 1[\s\S]*SCIM_ROLE_MAPPING_AMBIGUOUS/, "conflicting group roles must fail closed");
expect(helperPath, helper, /!user\.roleManagedByScimGroup && user\.role !== PlatformRole\.EMPLOYEE[\s\S]*SCIM_ROLE_MAPPING_MANUAL_CONFLICT/, "directory sync must not overwrite a manual non-employee role");
expect(helperPath, helper, /sessionVersion:\s*\{ increment: 1 \}[\s\S]*sessionsRevokedAt:\s*now/, "role changes must revoke stale sessions immediately");
expect(helperPath, helper, /targetRole = roles\[0\] \?\? PlatformRole\.EMPLOYEE[\s\S]*targetManaged = roles\.length === 1/, "removing the last mapping must release managed users to the safe employee baseline");

const registryPath = "app/api/settings/scim-role-mappings/route.ts";
const registry = await source(registryPath);
expect(registryPath, registry, /settings:write/, "mapping creation must require settings write authority");
expect(registryPath, registry, /mutationOriginAllowed\(request\)/, "mapping creation must enforce mutation origin");
expect(registryPath, registry, /ScimRoleMappingStatus\.DRAFT/, "new mappings must have no runtime effect until activation");
expect(registryPath, registry, /TransactionIsolationLevel\.Serializable/, "mapping creation must be serializable");
expect(registryPath, registry, /settings\.scim-role-mapping-created/, "mapping creation must be audited");

const previewPath = "app/api/settings/scim-role-mappings/preview/route.ts";
const preview = await source(previewPath);
expect(previewPath, preview, /previewScimRoleMapping/, "settings must preview population impact before activation");
expect(previewPath, preview, /settings:write/, "impact preview must remain inside the governed settings boundary");

const lifecyclePath = "app/api/settings/scim-role-mappings/[id]/route.ts";
const lifecycle = await source(lifecyclePath);
expect(lifecyclePath, lifecycle, /expectedUpdatedAt/, "mapping lifecycle must use optimistic concurrency evidence");
expect(lifecyclePath, lifecycle, /ATTESTATION_REQUIRED/, "activation must require an administrator attestation");
expect(lifecyclePath, lifecycle, /reconcileScimManagedRoles/, "mapping activation and disablement must reconcile affected accounts");
expect(lifecyclePath, lifecycle, /settings\.scim-role-mapping-activated[\s\S]*settings\.scim-role-mapping-disabled[\s\S]*settings\.scim-role-mapping-reopened/, "mapping lifecycle must remain auditable");
expect(lifecyclePath, lifecycle, /TransactionIsolationLevel\.Serializable/, "mapping lifecycle changes must be serializable");

for (const groupPath of ["app/api/scim/v2/Groups/route.ts", "app/api/scim/v2/Groups/[id]/route.ts"]) {
  const group = await source(groupPath);
  expect(groupPath, group, /reconcileScimManagedRoles/, "SCIM group membership changes must reconcile active role mappings");
  expect(groupPath, group, /SCIM_ROLE_MAPPING_AMBIGUOUS/, "SCIM sync must surface ambiguous directory-role conflicts");
  expect(groupPath, group, /SCIM_ROLE_MAPPING_MANUAL_CONFLICT/, "SCIM sync must protect manually governed roles");
}

const componentPath = "components/scim-role-mapping-admin.tsx";
const component = await source(componentPath);
expect(componentPath, component, /Preview impact|Etkiyi önizle/, "settings UX must expose impact preview");
expect(componentPath, component, /Activation attestation|Aktivasyon teyidi/, "settings UX must collect activation evidence");
expect(componentPath, component, /Privileged admin, payroll, compensation, privacy, legal and security roles remain human-governed/, "settings UX must explain the privilege boundary");

const settingsPath = "components/settings-live-page.tsx";
const settings = await source(settingsPath);
expect(settingsPath, settings, /ScimRoleMappingAdmin/, "Settings & Operations must mount the governed role mapping console");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /scim:role-mapping:validate/, "SCIM role mapping validator must be registered");
expect(packagePath, pkg, /scim-role-mapping\.test\.mjs/, "behavioral SCIM role reconciliation tests must run");
expect(packagePath, pkg, /scim:validate[^\n]*scim:role-mapping:validate/, "SCIM role mapping governance must gate production builds");

if (failures.length) {
  console.error("SCIM safe role mapping validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("SCIM safe role mapping validation passed.");
