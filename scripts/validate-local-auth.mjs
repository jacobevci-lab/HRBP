import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(path + ": " + message); }
function reject(path, text, pattern, message) { if (pattern.test(text)) failures.push(path + ": " + message); }

const schemaPath = "prisma/schema.prisma";
const schema = await source(schemaPath);
expect(schemaPath, schema, /localAuthEnabled\s+Boolean\s+@default\(false\)/, "local auth must be opt-in per account");
expect(schemaPath, schema, /localPasswordHash\s+String\?/, "local password hashes must have a dedicated nullable field");
expect(schemaPath, schema, /localFailedAttempts\s+Int\s+@default\(0\)/, "local login failure count must be persisted");
expect(schemaPath, schema, /localLockedUntil\s+DateTime\?/, "local login lockout must be persisted");
expect(schemaPath, schema, /sessionVersion\s+Int\s+@default\(1\)/, "accounts must carry a persisted session revocation epoch");
expect(schemaPath, schema, /sessionsRevokedAt\s+DateTime\?/, "session revocation timestamp must be persisted");

const helperPath = "lib/local-auth.ts";
const helper = await source(helperPath);
expect(helperPath, helper, /scryptSync/, "local passwords must use scrypt");
expect(helperPath, helper, /timingSafeEqual/, "local password verification must use timing-safe comparison");
expect(helperPath, helper, /LOCAL_AUTH_MAX_FAILURES = 5/, "local auth must bound failed attempts");
expect(helperPath, helper, /LOCAL_AUTH_LOCK_MINUTES = 15/, "local auth must impose a lockout window");

const routePath = "app/api/auth/local/route.ts";
const route = await source(routePath);
expect(routePath, route, /HRBP_LOCAL_AUTH_ENABLED/, "local sign-in must be globally feature-gated");
expect(routePath, route, /mutationOriginAllowed\(request\)/, "local sign-in must enforce origin checks");
expect(routePath, route, /tenantId,\s*active:\s*true,\s*localAuthEnabled:\s*true/, "local account lookup must be tenant-bound, active and explicitly enabled");
expect(routePath, route, /localLockedUntil/, "local sign-in must enforce persisted lockout");
expect(routePath, route, /verifyLocalPassword/, "local sign-in must use governed password verification");
expect(routePath, route, /createSessionCookie/, "local sign-in must issue the same signed application session as SSO");
expect(routePath, route, /sessionVersion:\s*identity\.user\.sessionVersion/, "local sessions must embed the persisted revocation epoch");
expect(routePath, route, /sessionMaxMinutes/, "local sessions must honor tenant session lifetime policy");
expect(routePath, route, /auth\.local-succeeded/, "successful local sign-in must be audited");
expect(routePath, route, /auth\.local-failed|auth\.local-locked/, "failed local sign-ins must be audited");
expect(routePath, route, /LOCAL_AUTH_ACCOUNT_LOCKED/, "lockout threshold events must notify tenant administrators");
expect(routePath, route, /recipientRole:\s*"TENANT_ADMIN"/, "local lockout alerts must route to tenant administrators");
expect(routePath, route, /dedupeKey:\s*`local-auth-lock:/, "local lockout alerts must be idempotently deduplicated");
reject(routePath, route, /passwordHash:\s*password|localPasswordHash:\s*password/, "plaintext passwords must never be persisted");

const pagePath = "app/auth/sign-in/page.tsx";
const page = await source(pagePath);
expect(pagePath, page, /LocalSignInForm/, "sign-in page must mount the local login form");
expect(pagePath, page, /HRBP_LOCAL_AUTH_ENABLED/, "local login UI must remain feature-gated");

const seedPath = "scripts/seed-staging.mjs";
const seed = await source(seedPath);
expect(seedPath, seed, /LOCAL_TEST_ADMIN_ID = "user-local-test-admin"/, "staging must provision a dedicated local test admin");
expect(seedPath, seed, /subject:\s*"local\.admin"/, "test admin must have a stable local username");
expect(seedPath, seed, /role:\s*"TENANT_ADMIN"/, "test admin must have tenant admin role");
expect(seedPath, seed, /HRBP_TEST_ADMIN_PASSWORD/, "test admin password must come from environment");
expect(seedPath, seed, /scryptSync/, "staging password must be hashed before persistence");
reject(seedPath, seed, /password\s*[:=]\s*["'][^"']{12,}["']/, "staging seed must not hardcode a plaintext test password");

const envPath = ".env.example";
const env = await source(envPath);
expect(envPath, env, /HRBP_LOCAL_AUTH_ENABLED=false/, "local auth feature flag must be documented disabled by default");
expect(envPath, env, /HRBP_TEST_ADMIN_PASSWORD=/, "test admin password secret must be documented without a value");

const workflowPath = ".github/workflows/staging-db-sync.yml";
const workflow = await source(workflowPath);
expect(workflowPath, workflow, /HRBP_TEST_ADMIN_PASSWORD:\s*\$\{\{ secrets\.HRBP_TEST_ADMIN_PASSWORD \}\}/, "staging seed must receive the test admin password only from GitHub secrets");
expect(workflowPath, workflow, /subject:\s*"local\.admin"/, "staging verification must require the local test admin account");


const adminRoutePath = "app/api/settings/local-accounts/route.ts";
const adminRoute = await source(adminRoutePath);
expect(adminRoutePath, adminRoute, /settings:write/, "local account creation must require tenant settings write capability");
expect(adminRoutePath, adminRoute, /mutationOriginAllowed\(request\)/, "local account creation must enforce origin checks");
expect(adminRoutePath, adminRoute, /hashLocalPassword/, "local account creation must hash passwords before persistence");
expect(adminRoutePath, adminRoute, /localAuthEnabled:\s*true/, "new governed local accounts must explicitly enable local sign-in");
reject(adminRoutePath, adminRoute, /localPasswordHash:\s*password\b/, "local account administration must never persist plaintext passwords");

const adminLifecyclePath = "app/api/settings/local-accounts/[id]/route.ts";
const adminLifecycle = await source(adminLifecyclePath);
expect(adminLifecyclePath, adminLifecycle, /settings:write/, "local account lifecycle operations must require tenant settings write capability");
expect(adminLifecyclePath, adminLifecycle, /mutationOriginAllowed\(request\)/, "local account lifecycle operations must enforce origin checks");
expect(adminLifecyclePath, adminLifecycle, /current\.id === ctx\.actorId/, "administrators must not be able to disable the local account backing their current session");
expect(adminLifecyclePath, adminLifecycle, /reset-password/, "local account lifecycle must support governed password rotation");
expect(adminLifecyclePath, adminLifecycle, /revoke-sessions/, "local account lifecycle must support immediate session revocation");
expect(adminLifecyclePath, adminLifecycle, /sessionVersion:\s*\{\s*increment:\s*1\s*\}/, "session revocation must atomically advance the account epoch");
expect(adminLifecyclePath, adminLifecycle, /settings\.account-sessions-revoked/, "session revocation must append restricted audit evidence");
expect(adminLifecyclePath, adminLifecycle, /localFailedAttempts:\s*0[\s\S]*localLockedUntil:\s*null/, "password rotation and unlock must clear lockout state");
expect(adminLifecyclePath, adminLifecycle, /hashLocalPassword/, "password rotation must use the governed password hasher");
reject(adminLifecyclePath, adminLifecycle, /localPasswordHash:\s*password\b/, "password rotation must never persist plaintext passwords");

const adminUiPath = "components/local-account-admin.tsx";
const adminUi = await source(adminUiPath);
expect(adminUiPath, adminUi, /type="password"/, "local account administration must use masked password inputs");
expect(adminUiPath, adminUi, /\/api\/settings\/local-accounts/, "local account administration UI must use the governed tenant API");
expect(adminUiPath, adminUi, /reset-password/, "local account administration UI must support password rotation");
expect(adminUiPath, adminUi, /revoke-sessions/, "local account administration UI must expose revoke-all-sessions control");


const settingsPagePath = "components/settings-live-page.tsx";
const settingsPage = await source(settingsPagePath);
expect(settingsPagePath, settingsPage, /LocalAccountAdmin/, "tenant settings must expose governed local account administration");
expect(settingsPagePath, settingsPage, /HRBP_LOCAL_AUTH_ENABLED/, "tenant settings must surface the local authentication runtime gate");
expect(settingsPagePath, settingsPage, /localAuthEnabled:\s*true/, "tenant settings readiness must count explicitly enabled local accounts");


const settingsObservabilityPath = "components/settings-live-page.tsx";
const settingsObservability = await source(settingsObservabilityPath);
expect(settingsObservabilityPath, settingsObservability, /auth\.local-succeeded[\s\S]*auth\.local-failed[\s\S]*auth\.local-locked/, "settings must expose bounded local authentication audit telemetry");
expect(settingsObservabilityPath, settingsObservability, /take:\s*50/, "local authentication telemetry must remain bounded");
expect(settingsObservabilityPath, settingsObservability, /tenantId:\s*ctx\.tenantId/, "local authentication telemetry must remain tenant scoped");
expect(settingsObservabilityPath, settingsObservability, /resourceType:\s*"UserAccount"/, "local authentication telemetry must read only user-account audit evidence");
reject(settingsObservabilityPath, settingsObservability, /select:\s*\{[^}]*localPasswordHash|event\.localPasswordHash/, "local authentication telemetry must not select or render password hashes");


const authConfigPath = "lib/auth-config.ts";
const authConfig = await source(authConfigPath);
expect(authConfigPath, authConfig, /localAuthConfigurationStatus/, "local authentication readiness must be exposed through the shared auth configuration helper");
expect(authConfigPath, authConfig, /HRBP_LOCAL_AUTH_ENABLED/, "local authentication readiness must respect the runtime feature gate");
expect(authConfigPath, authConfig, /HRBP_SESSION_SECRET/, "local authentication readiness must require the shared signed-session secret");

const authHealthPath = "app/api/health/auth/route.ts";
const authHealth = await source(authHealthPath);
expect(authHealthPath, authHealth, /localAuthConfigurationStatus/, "authentication health must include local authentication readiness");
expect(authHealthPath, authHealth, /mode:\s*"oidc"[\s\S]*mode:\s*"local"/, "authentication health must publish both supported modes");
expect(authHealthPath, authHealth, /configured:\s*anyReady/, "authentication health must be healthy when any configured authentication mode is usable");
expect(authHealthPath, authHealth, /cache-control[\s\S]*no-store/, "authentication health must remain uncached");
reject(authHealthPath, authHealth, /HRBP_SESSION_SECRET|HRBP_TEST_ADMIN_PASSWORD/, "authentication health must never expose secret names or values directly");


const notificationPresentationPath = "lib/notification-presentation.ts";
const notificationPresentation = await source(notificationPresentationPath);
expect(notificationPresentationPath, notificationPresentation, /LOCAL_AUTH_ACCOUNT_LOCKED/, "local lockout notifications must have localized presentation");
expect(notificationPresentationPath, notificationPresentation, /accountSubject[\s\S]*lockedUntil/, "local lockout notifications must summarize only bounded account and lockout metadata");

const notificationDisplayPath = "lib/notification-display.ts";
const notificationDisplay = await source(notificationDisplayPath);
expect(notificationDisplayPath, notificationDisplay, /resourceType === "UserAccount"[\s\S]*\/module\/settings/, "local account alerts must deep-link to tenant settings");


const sessionPath = "lib/auth-session.ts";
const sessionSource = await source(sessionPath);
expect(sessionPath, sessionSource, /sessionVersion:\s*number/, "signed session claims must carry an account revocation epoch");
expect(sessionPath, sessionSource, /maxMinutes\?:\s*number/, "session issuance must accept tenant maximum lifetime");
expect(sessionPath, sessionSource, /Math\.min\(runtimeMinutes, policyMinutes\)/, "session lifetime must use the stricter runtime or tenant ceiling");

const verifiedPath = "lib/verified-session.ts";
const verifiedSource = await source(verifiedPath);
expect(verifiedPath, verifiedSource, /user\.sessionVersion !== claims\.sessionVersion/, "every authenticated request must enforce the persisted session epoch");
expect(verifiedPath, verifiedSource, /sessionsRevokedAt[\s\S]*claims\.issuedAt/, "every authenticated request must reject sessions issued before revocation");

const policyPath = "app/api/settings/security-policy/route.ts";
const policySource = await source(policyPath);
expect(policyPath, policySource, /sessionPolicyTightened/, "security policy updates must detect tighter session lifetime");
expect(policyPath, policySource, /userAccount\.updateMany[\s\S]*sessionVersion:\s*\{\s*increment:\s*1\s*\}/, "tightening tenant session lifetime must revoke existing sessions");

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /local-auth:validate/, "local auth validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*local-auth:validate/, "local auth validation must run before production builds");

if (failures.length) {
  console.error("Local authentication validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Local authentication validation passed.");
