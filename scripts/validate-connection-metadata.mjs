import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(`${path}: ${message}`); }

const identityPath = "app/api/settings/identity/[id]/metadata/route.ts";
const identity = await source(identityPath);
expect(identityPath, identity, /settings:write/, "identity metadata editing must require settings write authority");
expect(identityPath, identity, /mutationOriginAllowed\(request\)/, "identity metadata editing must enforce origin checks");
expect(identityPath, identity, /status !== ConnectionStatus\.DRAFT/, "identity metadata editing must be draft-only");
expect(identityPath, identity, /updatedAt\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/, "identity metadata editing must enforce optimistic concurrency");
expect(identityPath, identity, /TransactionIsolationLevel\.Serializable/, "identity metadata editing must be serializable");
expect(identityPath, identity, /identityIssuer/, "identity metadata editing must reuse governed endpoint validation");
expect(identityPath, identity, /identityMetadataUrl/, "identity metadata editing must validate SAML metadata URL");
expect(identityPath, identity, /lastValidatedAt:\s*null/, "identity metadata changes must invalidate prior validation evidence");
expect(identityPath, identity, /settings\.identity-provider-metadata-updated/, "identity metadata edits must be audited");
reject(identityPath, identity, /status:\s*ConnectionStatus\.ACTIVE/, "metadata editing must not activate an identity connection");

const integrationPath = "app/api/settings/integrations/[id]/metadata/route.ts";
const integration = await source(integrationPath);
expect(integrationPath, integration, /settings:write/, "integration metadata editing must require settings write authority");
expect(integrationPath, integration, /mutationOriginAllowed\(request\)/, "integration metadata editing must enforce origin checks");
expect(integrationPath, integration, /status !== ConnectionStatus\.DRAFT/, "integration metadata editing must be draft-only");
expect(integrationPath, integration, /updatedAt\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/, "integration metadata editing must enforce optimistic concurrency");
expect(integrationPath, integration, /TransactionIsolationLevel\.Serializable/, "integration metadata editing must be serializable");
expect(integrationPath, integration, /optionalEndpoint\(body\.baseUrl/, "integration metadata editing must preserve HTTP(S) endpoint validation");
expect(integrationPath, integration, /value\.length > 100/, "integration scope count must remain bounded");
expect(integrationPath, integration, /lastSyncAt:\s*null[\s\S]*lastError:\s*null/, "integration metadata changes must clear stale sync evidence");
expect(integrationPath, integration, /settings\.integration-metadata-updated/, "integration metadata edits must be audited");
reject(integrationPath, integration, /enabled:\s*true/, "metadata editing must not activate an integration");

const editorPath = "components/connection-metadata-editor.tsx";
const editor = await source(editorPath);
expect(editorPath, editor, /status === "DRAFT"/, "metadata editor must expose only draft connections");
expect(editorPath, editor, /expectedUpdatedAt:\s*identity\.updatedAt/, "identity editor must send optimistic concurrency evidence");
expect(editorPath, editor, /expectedUpdatedAt:\s*integration\.updatedAt/, "integration editor must send optimistic concurrency evidence");
expect(editorPath, editor, /\/metadata/, "metadata editor must use dedicated governed metadata routes");
expect(editorPath, editor, /Secret reference/, "metadata editor must handle references rather than secret values");
expect(editorPath, editor, /splitScopes/, "integration scope input must be normalized and bounded");

const modulePath = "app/module/[slug]/page.tsx";
const modulePage = await source(modulePath);
expect(modulePath, modulePage, /ConnectionMetadataEditor/, "settings workspace must mount the metadata editor");
expect(modulePath, modulePage, /can\(ctx,\s*"settings:write"\)/, "metadata editor visibility must remain settings-write gated");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /connection-metadata:validate/, "connection metadata validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*connection-metadata:validate/, "connection metadata validation must run before production builds");

if (failures.length) {
  console.error("Connection metadata validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Connection metadata validation passed.");
