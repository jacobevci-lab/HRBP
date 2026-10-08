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
expect(helperPath, helper, /actual\.some\(\(value\) => accepted\.has\(value\)\)/, "assurance matching must use exact allowlisted values");

const callbackPath = "app/api/auth/callback/route.ts";
const callback = await source(callbackPath);
expect(callbackPath, callback, /evaluateOidcAssurance\(payload/, "OIDC callback must evaluate signed token assurance claims");
expect(callbackPath, callback, /securityPolicy\?\.mfaRequired[\s\S]*!assurance\.mfaSatisfied[\s\S]*MFA_REQUIRED/, "OIDC callback must fail closed when tenant MFA assurance is missing");
expect(callbackPath, callback, /securityPolicy\?\.deviceTrustRequired[\s\S]*!assurance\.deviceTrustSatisfied[\s\S]*DEVICE_TRUST_REQUIRED/, "OIDC callback must fail closed when trusted-device evidence is missing");
expect(callbackPath, callback, /mfaSatisfied:\s*assurance\.mfaSatisfied[\s\S]*deviceTrustSatisfied:\s*assurance\.deviceTrustSatisfied/, "OIDC sessions must bind evaluated assurance evidence");
expect(callbackPath, callback, /mfa-required[\s\S]*device-trust-required/, "OIDC assurance denials must use bounded public error codes");

const sessionPath = "lib/auth-session.ts";
const session = await source(sessionPath);
expect(sessionPath, session, /mfaSatisfied\?: boolean[\s\S]*deviceTrustSatisfied\?: boolean/, "session claims must carry bounded assurance booleans");
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
expect(verifiedPath, verified, /mfaRequired:\s*true[\s\S]*deviceTrustRequired:\s*true/, "request verification must load current tenant assurance policy");
expect(verifiedPath, verified, /policy\?\.mfaRequired[\s\S]*claims\.mfaSatisfied !== true/, "existing sessions must fail immediately after MFA policy enforcement");
expect(verifiedPath, verified, /policy\?\.deviceTrustRequired[\s\S]*claims\.deviceTrustSatisfied !== true/, "existing sessions must fail immediately after device-trust policy enforcement");

const localPath = "app/api/auth/local/route.ts";
const local = await source(localPath);
expect(localPath, local, /assurancePolicy\?\.mfaRequired \|\| assurancePolicy\?\.deviceTrustRequired/, "local password sessions must not bypass tenant assurance policy");
expect(localPath, local, /auth\.local-assurance-denied/, "blocked local assurance bypass must be audited");
expect(localPath, local, /mfaSatisfied:\s*false[\s\S]*deviceTrustSatisfied:\s*false/, "local sessions must not claim assurance they cannot provide");

const policyPath = "app/api/settings/security-policy/route.ts";
const policy = await source(policyPath);
expect(policyPath, policy, /assurancePolicyIssues[\s\S]*status:\s*409/, "tenant security policy must reject unenforceable assurance settings");
expect(policyPath, policy, /enablingMfa[\s\S]*ctx\.mfaSatisfied !== true[\s\S]*status:\s*409/, "MFA policy enablement must require a currently assured OIDC session");
expect(policyPath, policy, /enablingDeviceTrust[\s\S]*ctx\.deviceTrustSatisfied !== true[\s\S]*status:\s*409/, "device-trust policy enablement must require a currently trusted-device session");
expect(policyPath, policy, /mfaConfigured[\s\S]*deviceTrustConfigured/, "security policy read must expose secret-free assurance readiness");

const healthPath = "app/api/health/auth/route.ts";
const health = await source(healthPath);
expect(healthPath, health, /assurance:[\s\S]*mfaConfigured[\s\S]*deviceTrustConfigured/, "auth health must expose assurance readiness without claim values");

const editorPath = "components/security-policy-editor.tsx";
const editor = await source(editorPath);
expect(editorPath, editor, /assuranceMissing/, "settings UX must surface missing assurance mapping");
expect(editorPath, editor, /currentMfaSatisfied[\s\S]*currentDeviceTrustSatisfied/, "settings UX must prevent enabling a control from an unassured current session");
expect(editorPath, editor, /OIDC MFA claim\/value mapping is not configured/, "MFA settings copy must distinguish configuration from enforcement");
expect(editorPath, editor, /OIDC device-trust claim\/value mapping is not configured/, "device-trust settings copy must distinguish configuration from enforcement");

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
