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
reject(identityPath, identity, /action === "validate"[\s\S]*status:\s*ConnectionStatus\.ACTIVE/, "identity validation must not activate the provider");

const integrationPath = "app/api/settings/integrations/[id]/route.ts";
const integration = await source(integrationPath);
expect(integrationPath, integration, /type LifecycleAction = "validate" \| "activate" \| "disable" \| "reopen"/, "integration lifecycle must include configuration validation");
expect(integrationPath, integration, /action === "validate"[\s\S]*integrationActivationIssues\(current\)/, "integration validation must reuse governed readiness checks");
expect(integrationPath, integration, /settings\.integration-config-validated/, "integration validation must be audited");
expect(integrationPath, integration, /!current\.lastValidatedAt[\s\S]*Validate the integration configuration before activation/, "integration activation must require recorded validation evidence");
expect(integrationPath, integration, /status: ConnectionStatus\.DRAFT, enabled: false, lastValidatedAt: null/, "reopening integration configuration must invalidate prior validation");
reject(integrationPath, integration, /action === "validate"[\s\S]*enabled:\s*true/, "integration validation must not enable the connection");

const metadataPath = "app/api/settings/integrations/[id]/metadata/route.ts";
const metadata = await source(metadataPath);
expect(metadataPath, metadata, /lastValidatedAt:\s*null[\s\S]*lastSyncAt:\s*null/, "integration metadata edits must invalidate validation and stale sync evidence");

const listPath = "app/api/settings/integrations/route.ts";
const list = await source(listPath);
expect(listPath, list, /lastValidatedAt:\s*true/, "integration registry must expose validation timestamp without exposing secrets");

const panelPath = "components/connection-lifecycle-panel.tsx";
const panel = await source(panelPath);
expect(panelPath, panel, /Validation required|Doğrulama gerekli/, "connection lifecycle must expose missing validation evidence");
expect(panelPath, panel, /validated=\{Boolean\(row\.lastValidatedAt\)\}/, "connection lifecycle actions must receive validation state");
expect(panelPath, panel, /configuration validation is recorded|yapılandırma doğrulaması kaydedildikten/, "activation guidance must document the validation gate");

const actionsPath = "components/connection-lifecycle-actions.tsx";
const actions = await source(actionsPath);
expect(actionsPath, actions, /type Action = "validate" \| "activate" \| "disable" \| "reopen"/, "connection actions must support validation");
expect(actionsPath, actions, /Validate config|Yapıyı doğrula/, "connection actions must expose configuration validation");
expect(actionsPath, actions, /disabled=\{Boolean\(busy\) \|\| !validated\}/, "activation control must remain disabled until validation succeeds");
expect(actionsPath, actions, /JSON\.stringify\(validation \? \{ action \}/, "validation action must not ask for or transmit an activation attestation");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /connection-validation:validate/, "connection validation gate validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*connection-validation:validate/, "connection validation gate must run before production builds");

if (failures.length) {
  console.error("Connection validation gate validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Connection validation gate validation passed.");
