import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const schemaPath = "prisma/platform.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /model IntegrationConnection[\s\S]*lastValidatedAt\s+DateTime\?/, "integration connections must persist configuration validation evidence");

const identityPath = "app/api/settings/identity/[id]/route.ts";
const identity = await source(identityPath);
expect(identityPath, identity, /type LifecycleAction = "validate" \| "activate" \| "disable" \| "reopen"/, "identity lifecycle must include configuration validation");
expect(identityPath, identity, /action === "validate"[\s\S]*identityActivationIssues\(current\)/, "identity validation must reuse governed readiness checks");
expect(identityPath, identity, /settings\.identity-provider-config-validated/, "identity validation must be audited");
expect(identityPath, identity, /!current\.lastValidatedAt[\s\S]*Validate the identity-provider configuration before activation/, "identity activation must require recorded validation evidence");
expect(identityPath, identity, /status: ConnectionStatus\.DRAFT, lastValidatedAt: null/, "reopening identity configuration must invalidate prior validation");
expect(identityPath, identity, /action === "validate"[\s\S]*data:\s*\{\s*lastValidatedAt:\s*new Date\(\)\s*\}[\s\S]*settings\.identity-provider-config-validated/, "identity validation must record validation evidence without changing lifecycle state");
expect(identityPath, identity, /identityRuntimeActivationIssues\(current\)[\s\S]*current login runtime/, "identity activation must distinguish metadata validity from runtime support");
expect(identityPath, identity, /isOidcRuntimeProvider\(current\.type\)[\s\S]*Only one runtime OIDC-family identity provider can be active/, "runtime-backed OIDC activation must prevent ambiguous active providers");

const runtimeBindingPath = "lib/runtime-identity-provider.ts";
const runtimeBinding = await source(runtimeBindingPath);
expect(runtimeBindingPath, runtimeBinding, /status:\s*ConnectionStatus\.ACTIVE[\s\S]*type:\s*\{ in:\s*\[\.\.\.oidcRuntimeProviderTypes\] \}/, "runtime binding must read only active OIDC-family providers");
expect(runtimeBindingPath, runtimeBinding, /active\.length !== 1[\s\S]*IDENTITY_PROVIDER_AMBIGUOUS/, "multiple active runtime providers must fail closed");
expect(runtimeBindingPath, runtimeBinding, /IDENTITY_PROVIDER_DRIFT/, "managed provider/runtime metadata drift must fail closed");
expect(runtimeBindingPath, runtimeBinding, /SAML login runtime adapter[\s\S]*LDAP login runtime adapter/, "unsupported identity protocols must not be falsely activatable");
expect(runtimeBindingPath, runtimeBinding, /jitEnabled:\s*true[\s\S]*mfaRequired:\s*true/, "managed runtime binding must load provider JIT and MFA policy flags");
expect(runtimeBindingPath, runtimeBinding, /connection\.jitEnabled && runtime\.allowedEmailDomains\.length === 0[\s\S]*JIT allowed email domains/, "managed JIT activation must require an explicit domain boundary");
expect(runtimeBindingPath, runtimeBinding, /connection\.mfaRequired && !authenticationAssuranceConfiguration\(\)\.mfaConfigured[\s\S]*OIDC MFA claim\/value mapping/, "managed MFA activation must require signed-token assurance mapping");
expect(runtimeBindingPath, runtimeBinding, /connection\.scimEnabled && !scimRuntimeConfig\(\)\.configured[\s\S]*SCIM runtime configuration/, "managed SCIM activation must require a configured runtime boundary");
expect(runtimeBindingPath, runtimeBinding, /connection\.type === IdentityProviderType\.LOCAL[\s\S]*connection\.scimEnabled[\s\S]*SCIM requires federated identity provider/, "local identity providers must not activate governed SCIM");
expect(runtimeBindingPath, runtimeBinding, /jitEnabled:\s*true[\s\S]*mfaRequired:\s*true[\s\S]*scimEnabled:\s*true/, "managed runtime binding must load provider JIT, MFA and SCIM policy flags");
expect(runtimeBindingPath, runtimeBinding, /scimEnabled:\s*connection\.scimEnabled/, "managed runtime binding must return provider SCIM policy");

const loginPath = "app/api/auth/login/route.ts";
const login = await source(loginPath);
expect(loginPath, login, /enforceOidcRuntimeBinding\(db, config\)[\s\S]*discoverOidc\(config\.issuer\)/, "OIDC login must verify governed runtime binding before provider discovery");

const callbackPath = "app/api/auth/callback/route.ts";
const callback = await source(callbackPath);
expect(callbackPath, callback, /enforceOidcRuntimeBinding\(db, config\)[\s\S]*discoverOidc\(config\.issuer\)/, "OIDC callback must revalidate governed runtime binding before token exchange");
expect(callbackPath, callback, /IDENTITY_PROVIDER_AMBIGUOUS[\s\S]*IDENTITY_PROVIDER_DRIFT[\s\S]*configuration/, "runtime binding failures must surface only as bounded configuration errors");
expect(callbackPath, callback, /runtimeBinding\.managed && runtimeBinding\.mfaRequired && !assurance\.mfaSatisfied[\s\S]*MFA_REQUIRED/, "active provider MFA policy must be enforced before account provisioning");
expect(callbackPath, callback, /jitEnabled = runtimeBinding\.managed \? runtimeBinding\.jitEnabled : config\.jitProvisioning/, "managed provider JIT policy must override the legacy environment toggle while preserving unmanaged compatibility");

const integrationPath = "app/api/settings/integrations/[id]/route.ts";
const integration = await source(integrationPath);
expect(integrationPath, integration, /type LifecycleAction = "validate" \| "activate" \| "disable" \| "reopen"/, "integration lifecycle must include configuration validation");
expect(integrationPath, integration, /action === "validate"[\s\S]*integrationActivationIssues\(current\)/, "integration validation must reuse governed readiness checks");
expect(integrationPath, integration, /settings\.integration-config-validated/, "integration validation must be audited");
expect(integrationPath, integration, /probeIntegrationEndpoint/, "integration live endpoint validation must use the governed allowlist probe");
expect(integrationPath, integration, /HRBP_INTEGRATION_PROBE_ALLOWED_ORIGINS/, "integration live validation must require an explicit approved-origin allowlist");
expect(integrationPath, integration, /settings\.integration-validation-failed/, "failed integration transport validation must be audited");
expect(integrationPath, integration, /TARGET_NOT_ALLOWED[\s\S]*TRANSPORT_UNAVAILABLE/, "integration validation must expose only bounded failure classes");
expect(integrationPath, integration, /integrationValidationCurrent\(current\.lastValidatedAt\)[\s\S]*older than 24 hours/, "integration activation must require fresh live validation evidence");
expect(integrationPath, integration, /status: ConnectionStatus\.DRAFT, enabled: false, lastValidatedAt: null/, "reopening integration configuration must invalidate prior validation");
expect(integrationPath, integration, /action === "validate"[\s\S]*lastValidatedAt:\s*new Date\(\)[\s\S]*lastError:\s*null[\s\S]*settings\.integration-config-validated/, "integration validation must record validation evidence without enabling the connection");

const metadataPath = "app/api/settings/integrations/[id]/metadata/route.ts";
const metadata = await source(metadataPath);
expect(metadataPath, metadata, /lastValidatedAt:\s*null[\s\S]*lastSyncAt:\s*null/, "integration metadata edits must invalidate validation and stale sync evidence");

const listPath = "app/api/settings/integrations/route.ts";
const list = await source(listPath);
expect(listPath, list, /lastValidatedAt:\s*true/, "integration registry must expose validation timestamp without exposing secrets");

const panelPath = "components/connection-lifecycle-panel.tsx";
const panel = await source(panelPath);
expect(panelPath, panel, /Validation required|Doğrulama gerekli/, "connection lifecycle must expose missing validation evidence");
expect(panelPath, panel, /integrationValidationCurrent\(row\.lastValidatedAt\)[\s\S]*validated=\{validationCurrent\}/, "integration lifecycle actions must receive fresh live-validation state");
expect(panelPath, panel, /configuration validation is recorded|yapılandırma doğrulaması kaydedildikten/, "activation guidance must document the validation gate");

const actionsPath = "components/connection-lifecycle-actions.tsx";
const actions = await source(actionsPath);
expect(actionsPath, actions, /type Action = "validate" \| "activate" \| "disable" \| "reopen"/, "connection actions must support validation");
expect(actionsPath, actions, /Validate config|Yapıyı doğrula/, "connection actions must expose configuration validation");
expect(actionsPath, actions, /Validate endpoint|Endpointi doğrula/, "integration actions must distinguish live endpoint validation from identity metadata validation");
expect(actionsPath, actions, /disabled=\{Boolean\(busy\) \|\| !validated\}/, "activation control must remain disabled until validation succeeds");
expect(actionsPath, actions, /JSON\.stringify\(validation \? \{ action \}/, "validation action must not ask for or transmit an activation attestation");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /connection-validation:validate/, "connection validation gate validator must be registered");
const settingsLivePath = "components/settings-live-page.tsx";
const settingsLive = await source(settingsLivePath);
expect(settingsLivePath, settingsLive, /managedOidc \? managedOidc\.jitEnabled : Boolean\(oidc\?\.jitProvisioning\)/, "settings must display effective managed-versus-legacy JIT state");
expect(settingsLivePath, settingsLive, /effectiveScimEnabled = managedOidc \? managedOidc\.scimEnabled : scim\.enabled/, "settings must display effective managed-versus-legacy SCIM state");
expect(settingsLivePath, settingsLive, /identityRuntimeActivationIssues\(managedOidc\)/, "settings runtime readiness must surface governed identity policy drift");

expect(packagePath, pkg, /identity-provider-auth-policy\.test\.mjs/, "managed identity-provider auth policy behavioral tests must run in the connection validation gate");
expect(packagePath, pkg, /integration-live-validation:validate/, "live validation policy tests must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*connection-validation:validate/, "connection validation gate must run before production builds");

if (failures.length) {
  console.error("Connection validation gate validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Connection validation gate validation passed.");
