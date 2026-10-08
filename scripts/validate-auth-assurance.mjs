import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) {
  if (!pattern.test(text)) failures.push(path + ": " + message);
}

const helperPath = "lib/auth-assurance.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /HRBP_OIDC_MFA_CLAIM[\s\S]*"amr"/, "MFA assurance must have a deterministic amr default");
expect(helperPath, helper, /HRBP_OIDC_MFA_VALUES[\s\S]*"mfa"/, "MFA assurance must have a deterministic mfa default");
expect(helperPath, helper, /deviceTrustConfigured/, "device trust must expose configuration readiness");
expect(helperPath, helper, /authenticationAssuranceVersion[\s\S]*createHash\("sha256"\)/, "assurance mapping must have a deterministic version digest");
expect(helperPath, helper, /actual\.some\(\(value\) => accepted\.has\(value\)\)/, "assurance matching must use exact allowlisted values");

const callbackPath = "app/api/auth/callback/route.ts";
const callback = await source(callbackPath);
expect(callbackPath, callback, /evaluateOidcAssurance\(payload/, "OIDC callback must evaluate signed token assurance claims");
expect(callbackPath, callback, /securityPolicy\?\.assuranceEnforcedAt[\s\S]*securityPolicy\.mfaRequired[\s\S]*!assurance\.mfaSatisfied[\s\S]*MFA_REQUIRED/, "OIDC callback must fail closed when an activated tenant MFA policy lacks assurance");
expect(callbackPath, callback, /securityPolicy\?\.assuranceEnforcedAt[\s\S]*securityPolicy\.deviceTrustRequired[\s\S]*!assurance\.deviceTrustSatisfied[\s\S]*DEVICE_TRUST_REQUIRED/, "OIDC callback must fail closed when an activated trusted-device policy lacks assurance");
expect(callbackPath, callback, /mfaSatisfied:\s*assurance\.mfaSatisfied[\s\S]*deviceTrustSatisfied:\s*assurance\.deviceTrustSatisfied[\s\S]*assuranceVersion/, "OIDC sessions must bind evaluated assurance evidence and mapping version");
expect(callbackPath, callback, /mfa-required[\s\S]*device-trust-required/, "OIDC assurance denials must use bounded public error codes");

const sessionPath = "lib/auth-session.ts";
const session = await source(sessionPath);
expect(sessionPath, session, /mfaSatisfied\?: boolean[\s\S]*deviceTrustSatisfied\?: boolean[\s\S]*assuranceVersion\?: string \| null/, "session claims must carry bounded assurance booleans and mapping version");
expect(sessionPath, session, /typeof claims\.mfaSatisfied !== "boolean"[\s\S]*typeof claims\.deviceTrustSatisfied !== "boolean"/, "session decoding must reject malformed assurance claims");

const sessionApiPath = "app/api/auth/session/route.ts";
const sessionApi = await source(sessionApiPath);
expect(sessionApiPath, sessionApi, /assurance:[\s\S]*mfaSatisfied:[\s\S]*deviceTrustSatisfied:/, "session API must expose only bounded assurance booleans");

const contextPath = "lib/request-context.ts";
const context = await source(contextPath);
expect(contextPath, context, /mfaSatisfied\?: boolean[\s\S]*deviceTrustSatisfied\?: boolean/, "request context must carry session assurance evidence");
expect(contextPath, context, /mfaSatisfied:\s*session\.mfaSatisfied === true[\s\S]*deviceTrustSatisfied:\s*session\.deviceTrustSatisfied === true/, "request context must derive assurance only from the verified signed session");

const serverContextPath = "lib/server-session.ts";
const serverContext = await source(serverContextPath);
expect(serverContextPath, serverContext, /mfaSatisfied:\s*claims\.mfaSatisfied === true[\s\S]*deviceTrustSatisfied:\s*claims\.deviceTrustSatisfied === true/, "server-component context must preserve verified assurance state");

const verifiedPath = "lib/verified-session.ts";
const verified = await source(verifiedPath);
expect(verifiedPath, verified, /mfaRequired:\s*true[\s\S]*deviceTrustRequired:\s*true[\s\S]*assuranceEnforcedAt:\s*true/, "request verification must load current tenant assurance policy and activation state");
expect(verifiedPath, verified, /policy\?\.assuranceEnforcedAt[\s\S]*policy\.mfaRequired[\s\S]*claims\.mfaSatisfied !== true/, "existing sessions must fail immediately after activated MFA policy enforcement");
expect(verifiedPath, verified, /policy\?\.assuranceEnforcedAt[\s\S]*policy\.deviceTrustRequired[\s\S]*claims\.deviceTrustSatisfied !== true/, "existing sessions must fail immediately after activated device-trust policy enforcement");
expect(verifiedPath, verified, /claims\.authMethod === "oidc"[\s\S]*claims\.assuranceVersion !== authenticationAssuranceVersion\(\)/, "OIDC sessions must fail after assurance claim mapping changes");

const localPath = "app/api/auth/local/route.ts";
const local = await source(localPath);
expect(localPath, local, /assurancePolicy\?\.assuranceEnforcedAt[\s\S]*assurancePolicy\.mfaRequired \|\| assurancePolicy\.deviceTrustRequired/, "local password sessions must not bypass an activated tenant assurance policy");
expect(localPath, local, /assurancePolicy[\s\S]*const body = await readJsonObject/, "local assurance policy must be checked before credential input is evaluated");
expect(localPath, local, /mfaSatisfied:\s*false[\s\S]*deviceTrustSatisfied:\s*false/, "local sessions must not claim assurance they cannot provide");

const policyPath = "app/api/settings/security-policy/route.ts";
const policy = await source(policyPath);
expect(policyPath, policy, /assurancePolicyIssues[\s\S]*status:\s*409/, "tenant security policy must reject unenforceable assurance settings");
expect(policyPath, policy, /enablingMfa[\s\S]*ctx\.mfaSatisfied !== true[\s\S]*status:\s*409/, "MFA policy enablement must require a currently assured OIDC session");
expect(policyPath, policy, /enablingDeviceTrust[\s\S]*ctx\.deviceTrustSatisfied !== true[\s\S]*status:\s*409/, "device-trust policy enablement must require a currently trusted-device session");
expect(policyPath, policy, /mfaConfigured[\s\S]*deviceTrustConfigured/, "security policy read must expose secret-free assurance readiness");
expect(policyPath, policy, /mfaRequired:\s*false/, "MFA must remain explicitly opt-in until an assured administrator enables it");
expect(policyPath, policy, /assuranceEnforcedAt = next\.mfaRequired \|\| next\.deviceTrustRequired[\s\S]*existing\?\.assuranceEnforcedAt \?\? new Date\(\)/, "assurance enforcement must activate only through an explicit assured policy save");
expect(policyPath, policy, /mfaRequired:\s*Boolean\(policy\.assuranceEnforcedAt && policy\.mfaRequired\)/, "security policy GET must project effective activated MFA state");
expect(policyPath, policy, /settings\.authentication-assurance-activated[\s\S]*settings\.authentication-assurance-deactivated/, "assurance activation and deactivation must have distinct audit actions");

const schemaPath = "prisma/platform.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /assuranceEnforcedAt\s+DateTime\?/, "tenant security policy must persist assurance activation state");

const migrationPath = "prisma/migrations/20261008123000_auth_assurance_activation/migration.sql";
const migration = await source(migrationPath);
expect(migrationPath, migration, /ADD COLUMN "assuranceEnforcedAt" TIMESTAMP\(3\)/, "versioned migration must add nullable assurance activation without auto-enabling legacy policy rows");

const healthPath = "app/api/health/auth/route.ts";
const health = await source(healthPath);
expect(healthPath, health, /assurance:[\s\S]*mfaConfigured[\s\S]*deviceTrustConfigured/, "auth health must expose assurance readiness without claim values");

const editorPath = "components/security-policy-editor.tsx";
const editor = await source(editorPath);
expect(editorPath, editor, /assuranceMissing/, "settings UX must surface missing assurance mapping");
expect(editorPath, editor, /currentMfaSatisfied[\s\S]*currentDeviceTrustSatisfied/, "settings UX must prevent enabling a control from an unassured current session");
expect(editorPath, editor, /OIDC MFA claim\/value mapping is not configured/, "MFA settings copy must distinguish configuration from enforcement");
expect(editorPath, editor, /OIDC device-trust claim\/value mapping is not configured/, "device-trust settings copy must distinguish configuration from enforcement");

const loaderPath = "components/security-policy-editor-loader.tsx";
const loader = await source(loaderPath);
expect(loaderPath, loader, /mfaRequired:\s*Boolean\(policy\?\.assuranceEnforcedAt && policy\.mfaRequired\)/, "settings must display only activated MFA policy");

const livePath = "components/settings-live-page.tsx";
const live = await source(livePath);
expect(livePath, live, /security\?\.assuranceEnforcedAt && security\.mfaRequired/, "settings overview must call MFA required only when assurance enforcement is activated");

const postflightPath = "scripts/onprem-postflight.mjs";
const postflight = await source(postflightPath);
expect(postflightPath, postflight, /mode === "pre-upgrade" \|\| \([\s\S]*assurance\?\.mfaConfigured === true/, "pre-upgrade health must remain compatible with releases that predate assurance telemetry");
expect(postflightPath, postflight, /mfaAssuranceConfigured:[\s\S]*not-required-pre-upgrade/, "postflight must distinguish old-release pre-upgrade assurance telemetry from target readiness");

const envPath = ".env.onprem.example";
const env = await source(envPath);
for (const token of [
  "HRBP_OIDC_MFA_CLAIM=amr",
  "HRBP_OIDC_MFA_VALUES=mfa",
  "HRBP_OIDC_DEVICE_TRUST_CLAIM=",
  "HRBP_OIDC_DEVICE_TRUST_VALUES="
]) {
  if (!env.includes(token)) failures.push(envPath + ": missing assurance deployment setting " + token);
}

if (failures.length) {
  console.error("Authentication assurance validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Authentication assurance validation passed.");
