import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(path + ": " + message);
}

const scimPath = "lib/scim.ts";
const scim = await source(scimPath);
expect(scimPath, scim, /resolveGovernedScimPolicy[\s\S]*ConnectionStatus\.ACTIVE[\s\S]*scimEnabled:\s*true/, "SCIM runtime must resolve the active governed provider flag");
expect(scimPath, scim, /active\.length !== 1[\s\S]*SCIM_PROVIDER_AMBIGUOUS/, "ambiguous active providers must fail governed SCIM closed");
expect(scimPath, scim, /export async function scimAccess/, "SCIM access must support live governed policy lookup");
expect(scimPath, scim, /resolveGovernedScimPolicy\(db, config\.tenantId\)/, "SCIM access must evaluate current database policy on each request");
expect(scimPath, scim, /requestedEnabled = policy\.managed \? policy\.scimEnabled : config\.enabled[\s\S]*!requestedEnabled[\s\S]*disabled by the active governed identity provider/, "active provider SCIM disablement must take immediate effect");
expect(scimPath, scim, /catch[\s\S]*SCIM provisioning policy is unavailable/, "SCIM policy lookup failures must fail closed");
expect(scimPath, scim, /requestedEnabled[\s\S]*!config\.configured[\s\S]*enabled by policy but its runtime configuration is not ready/, "governed SCIM runtime outages must surface as unavailable rather than disabled");
expect(scimPath, scim, /active\.length === 0[\s\S]*client\.tenant\.findUnique[\s\S]*identityGovernanceAdoptedAt[\s\S]*inactive:\s*true/, "sticky identity governance must keep SCIM managed-off when no provider is active");
expect(scimPath, scim, /policy\.inactive[\s\S]*governed identity has no active provider/, "SCIM must distinguish inactive governed identity from explicit provider disablement");

const runtimePath = "lib/runtime-identity-provider.ts";
const runtime = await source(runtimePath);
expect(runtimePath, runtime, /scimEnabled:\s*boolean/, "identity runtime readiness must include provider SCIM policy");
expect(runtimePath, runtime, /connection\.scimEnabled && !scimRuntimeConfig\(\)\.configured[\s\S]*SCIM runtime configuration/, "provider activation must reject unenforceable SCIM enablement");
expect(runtimePath, runtime, /scimEnabled:\s*true/, "OIDC runtime binding must load SCIM provider policy");
expect(runtimePath, runtime, /scimEnabled:\s*connection\.scimEnabled/, "runtime binding must return effective provider SCIM policy");

const scimRoutes = [
  "app/api/scim/v2/ResourceTypes/route.ts",
  "app/api/scim/v2/ResourceTypes/User/route.ts",
  "app/api/scim/v2/ResourceTypes/Group/route.ts",
  "app/api/scim/v2/Schemas/route.ts",
  "app/api/scim/v2/Schemas/[id]/route.ts",
  "app/api/scim/v2/ServiceProviderConfig/route.ts",
  "app/api/scim/v2/Users/route.ts",
  "app/api/scim/v2/Users/[id]/route.ts",
  "app/api/scim/v2/Groups/route.ts",
  "app/api/scim/v2/Groups/[id]/route.ts"
];
for (const path of scimRoutes) {
  const route = await source(path);
  expect(path, route, /await scimAccess\(request\)/, "every SCIM endpoint must await governed runtime policy before data access");
}

const schemaByIdPath = "app/api/scim/v2/Schemas/[id]/route.ts";
const schemaById = await source(schemaByIdPath);
expect(schemaByIdPath, schemaById, /SCIM_USER_SCHEMA[\s\S]*SCIM_GROUP_SCHEMA/, "individual schema discovery must support both User and Group");
expect(schemaByIdPath, schemaById, /scimUserSchemaDefinition[\s\S]*scimGroupSchemaDefinition/, "individual schema discovery must return both governed definitions");

const groupResourceTypePath = "app/api/scim/v2/ResourceTypes/Group/route.ts";
const groupResourceType = await source(groupResourceTypePath);
expect(groupResourceTypePath, groupResourceType, /scimGroupResourceType/, "individual Group resource-type discovery must be available");

const healthPath = "app/api/health/scim/route.ts";
const health = await source(healthPath);
expect(healthPath, health, /resolveGovernedScimPolicy\(db, config\.tenantId\)/, "SCIM health must report governed provider policy");
expect(healthPath, health, /governedScimEnabled/, "SCIM health must expose secret-free effective provider state");
expect(healthPath, health, /governedProviderInactive/, "SCIM health must expose inactive governed-provider state without secrets");
expect(healthPath, health, /policyUnavailable/, "SCIM health must distinguish policy-store failure");

const settingsPath = "components/settings-live-page.tsx";
const settings = await source(settingsPath);
expect(settingsPath, settings, /effectiveScimEnabled = managedOidc \? managedOidc\.scimEnabled : governedIdentityAdopted \? false : scim\.enabled/, "Settings must distinguish sticky governed SCIM from legacy runtime policy");
expect(settingsPath, settings, /SCIM \{effectiveScimEnabled \? "on" : "off"\}/, "identity runtime summary must show effective SCIM state");
expect(settingsPath, settings, /SCIM is disabled by the active governed provider/, "Settings must explain provider-driven SCIM disablement");
expect(settingsPath, settings, /SCIM is blocked because governed identity has no ACTIVE provider/, "Settings must explain sticky SCIM blocking when the governed provider is inactive");

const identityTestsPath = "scripts/identity-runtime-binding.test.mjs";
const identityTests = await source(identityTestsPath);
expect(identityTestsPath, identityTests, /managed SCIM cannot activate until the runtime token\/domain boundary is ready/, "identity readiness tests must cover SCIM runtime dependency");
expect(identityTestsPath, identityTests, /governed OIDC adoption blocks legacy environment fallback/, "identity runtime tests must prove sticky adoption blocks fallback");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /scim:runtime-policy:validate/, "SCIM runtime policy validator must be registered");
expect(packagePath, pkg, /scim-runtime-policy\.test\.mjs/, "SCIM runtime policy behavioral tests must run");
expect(packagePath, pkg, /scim:validate[^\n]*scim:runtime-policy:validate/, "SCIM runtime governance must gate production builds");

if (failures.length) {
  console.error("Governed SCIM runtime validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Governed SCIM runtime validation passed.");
