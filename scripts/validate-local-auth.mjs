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
expect(routePath, route, /auth\.local-succeeded/, "successful local sign-in must be audited");
expect(routePath, route, /auth\.local-failed|auth\.local-locked/, "failed local sign-ins must be audited");
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

const packagePath = "package.json";
const pkg = await source(packagePath);
expect(packagePath, pkg, /local-auth:validate/, "local auth validator must be registered");
expect(packagePath, pkg, /prebuild[\s\S]*local-auth:validate/, "local auth validation must run before production builds");

if (failures.length) {
  console.error("Local authentication validation failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Local authentication validation passed.");
