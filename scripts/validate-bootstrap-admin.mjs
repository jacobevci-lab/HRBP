import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(path + ": " + message);
}
function reject(path, text, pattern, message) {
  if (pattern.test(text)) failures.push(path + ": " + message);
}

const helperPath = "lib/bootstrap-admin.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /lockIdentityProviderTenant\(tx, input\.tenantId\)/, "bootstrap provisioning must serialize with tenant identity lifecycle");
expect(helperPath, helper, /identityGovernanceAdoptedAt[\s\S]*GOVERNANCE_ADOPTED/, "governed identity adoption must permanently close bootstrap provisioning");
expect(helperPath, helper, /role:\s*PlatformRole\.TENANT_ADMIN[\s\S]*active:\s*true[\s\S]*ADMIN_EXISTS/, "an existing active tenant administrator must close bootstrap provisioning");
expect(helperPath, helper, /existing = await tx\.userAccount\.findFirst[\s\S]*if \(existing\) return \{ user: existing/, "existing accounts must be returned without privilege promotion");
expect(helperPath, helper, /settings|auth\.bootstrap-admin-provisioned/, "bootstrap creation must emit dedicated audit evidence");
expect(helperPath, helper, /system:oidc-bootstrap/, "bootstrap audit must use a bounded system actor");
expect(helperPath, helper, /TransactionIsolationLevel\.Serializable/, "bootstrap provisioning must use a serializable transaction");
reject(helperPath, helper, /update\([\s\S]*role:\s*PlatformRole\.TENANT_ADMIN/, "bootstrap must never upgrade an existing account into tenant administration");

const callbackPath = "app/api/auth/callback/route.ts";
const callback = await source(callbackPath);
expect(callbackPath, callback, /provisionBootstrapAdmin\(db,[\s\S]*tenantId: config\.tenantId[\s\S]*subject[\s\S]*email/, "OIDC callback must route bootstrap through governed provisioning");
expect(callbackPath, callback, /bootstrapResult\.closed[\s\S]*IDENTITY_NOT_PROVISIONED/, "closed bootstrap must not fall through to JIT employee provisioning");
expect(callbackPath, callback, /else if \(!user && jitAllowed\)/, "normal JIT provisioning must remain separate from bootstrap administration");
reject(callbackPath, callback, /!user && bootstrap[\s\S]{0,300}role:\s*PlatformRole\.TENANT_ADMIN/, "OIDC callback must not create privileged bootstrap users directly");

const ciPath = ".github/workflows/ci.yml";
const ci = await source(ciPath);
expect(ciPath, ci, /bootstrap-admin\.postgres\.test\.mjs/, "CI must prove bootstrap administration against PostgreSQL");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /bootstrap-admin:validate/, "bootstrap governance validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*bootstrap-admin:validate/, "bootstrap governance must gate production builds");

if (failures.length) {
  console.error("OIDC bootstrap administration validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("OIDC bootstrap administration validation passed.");
