import assert from "node:assert/strict";
import { createSessionCookie, decodeSignedPayload, SESSION_COOKIE, type SessionClaims } from "@/lib/auth-session";

function tokenFromCookie(cookie: string) {
  const pair = cookie.split(";")[0] || "";
  const index = pair.indexOf("=");
  assert.ok(index > 0, "Session cookie pair is missing.");
  assert.equal(pair.slice(0, index), SESSION_COOKIE);
  return decodeURIComponent(pair.slice(index + 1));
}

const secret = "session-policy-test-secret-".padEnd(64, "x");
process.env.HRBP_SESSION_SECRET = secret;
process.env.HRBP_SESSION_TTL_HOURS = "8";

const base = {
  authMethod: "oidc" as const,
  sessionVersion: 7,
  tenantId: "tenant-test",
  actorId: "user-test",
  role: "TENANT_ADMIN" as const,
  displayName: "Test Admin",
  email: "admin@example.test",
  subject: "oidc-subject"
};

const policyCookie = createSessionCookie(base, 30);
const policyClaims = decodeSignedPayload<SessionClaims>(tokenFromCookie(policyCookie), secret);
assert.ok(policyClaims);
assert.equal(policyClaims.sessionVersion, 7);
assert.equal(policyClaims.exp - policyClaims.issuedAt, 30 * 60, "Tenant policy must cap session lifetime.");

const runtimeCookie = createSessionCookie(base, 1440);
const runtimeClaims = decodeSignedPayload<SessionClaims>(tokenFromCookie(runtimeCookie), secret);
assert.ok(runtimeClaims);
assert.equal(runtimeClaims.exp - runtimeClaims.issuedAt, 8 * 60 * 60, "Runtime ceiling must cap a looser tenant policy.");

const missingEpoch = { ...policyClaims } as Record<string, unknown>;
delete missingEpoch.sessionVersion;
assert.equal((missingEpoch as { sessionVersion?: unknown }).sessionVersion, undefined);

console.log("Session policy cookie contract passed.");
