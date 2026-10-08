import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

function fixture({ policy, assurance }) {
  const calls = { userLookup: 0, sessionClaims: null };
  const user = {
    id: "user-1",
    tenantId: "tenant-1",
    subject: "subject-1",
    displayName: "Assured User",
    email: "user@example.test",
    role: "EMPLOYEE",
    active: true,
    sessionVersion: 1
  };
  const db = {
    tenantSecurityPolicy: {
      findUnique: async () => policy
    },
    userAccount: {
      findFirst: async () => { calls.userLookup += 1; return user; },
      create: async () => { throw new Error("unexpected create"); },
      update: async () => user
    },
    person: {
      findFirst: async () => null
    },
    tenant: {
      findUnique: async () => ({ sessionVersion: 1 })
    }
  };
  const route = load("app/api/auth/callback/route.ts", {
    "@/lib/safe-redirect": { sanitizeReturnTo: () => "/" },
    "@prisma/client": { PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN", EMPLOYEE: "EMPLOYEE" } },
    "@/lib/auth-config": {
      getOidcConfig: () => ({
        issuer: "https://idp.example.test",
        clientId: "client",
        tenantId: "tenant-1",
        scopes: "openid profile email",
        allowedEmailDomains: ["example.test"],
        jitProvisioning: false
      })
    },
    "@/lib/auth-assurance": {
      evaluateOidcAssurance: () => assurance,
      authenticationAssuranceVersion: () => "a".repeat(64)
    },
    "@/lib/auth-session": {
      readOidcTransaction: () => ({ state: "state-1", nonce: "nonce-1", verifier: "verifier", returnTo: "/", exp: Math.floor(Date.now() / 1000) + 60 }),
      createSessionCookie: (claims) => {
        calls.sessionClaims = claims;
        return "hrbp_session=test; Path=/; HttpOnly";
      },
      clearOidcTransactionCookie: () => "hrbp_oidc_txn=; Max-Age=0"
    },
    "@/lib/db": { withDb: (operation) => operation(db) },
    "@/lib/runtime-identity-provider": { enforceOidcRuntimeBinding: async () => ({ managed: false }) },
    "@/lib/oidc": {
      discoverOidc: async () => ({
        issuer: "https://idp.example.test",
        authorization_endpoint: "https://idp.example.test/auth",
        token_endpoint: "https://idp.example.test/token",
        jwks_uri: "https://idp.example.test/jwks"
      }),
      exchangeAuthorizationCode: async () => ({ id_token: "token" }),
      verifyIdToken: async () => ({
        sub: "subject-1",
        email: "user@example.test",
        name: "Assured User",
        nonce: "nonce-1"
      })
    }
  });
  return { route, calls };
}

async function invoke(route) {
  return route.GET(new Request("https://hrbp.example.test/api/auth/callback?code=code-1&state=state-1"));
}

test("OIDC callback rejects missing MFA assurance before account provisioning", async () => {
  const { route, calls } = fixture({
    policy: { sessionMaxMinutes: 480, mfaRequired: true, deviceTrustRequired: false, assuranceEnforcedAt: new Date("2026-10-08T12:00:00Z") },
    assurance: { mfaSatisfied: false, deviceTrustSatisfied: false }
  });
  const response = await invoke(route);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /error=mfa-required/);
  assert.equal(calls.userLookup, 0);
  assert.equal(calls.sessionClaims, null);
});

test("OIDC callback rejects missing device trust assurance before account provisioning", async () => {
  const { route, calls } = fixture({
    policy: { sessionMaxMinutes: 480, mfaRequired: false, deviceTrustRequired: true, assuranceEnforcedAt: new Date("2026-10-08T12:00:00Z") },
    assurance: { mfaSatisfied: true, deviceTrustSatisfied: false }
  });
  const response = await invoke(route);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /error=device-trust-required/);
  assert.equal(calls.userLookup, 0);
});

test("legacy pre-enforcement policy flags do not lock out OIDC sign-in", async () => {
  const { route, calls } = fixture({
    policy: { sessionMaxMinutes: 480, mfaRequired: true, deviceTrustRequired: true, assuranceEnforcedAt: null },
    assurance: { mfaSatisfied: false, deviceTrustSatisfied: false }
  });
  const response = await invoke(route);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(calls.userLookup, 1);
  assert.ok(calls.sessionClaims);
  assert.equal(calls.sessionClaims.mfaSatisfied, false);
  assert.equal(calls.sessionClaims.deviceTrustSatisfied, false);
});

test("OIDC callback binds successful assurance evidence into the application session", async () => {
  const { route, calls } = fixture({
    policy: { sessionMaxMinutes: 120, mfaRequired: true, deviceTrustRequired: true, assuranceEnforcedAt: new Date("2026-10-08T12:00:00Z") },
    assurance: { mfaSatisfied: true, deviceTrustSatisfied: true }
  });
  const response = await invoke(route);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(calls.userLookup, 1);
  assert.ok(calls.sessionClaims);
  assert.equal(calls.sessionClaims.mfaSatisfied, true);
  assert.equal(calls.sessionClaims.deviceTrustSatisfied, true);
  assert.equal(calls.sessionClaims.assuranceVersion, "a".repeat(64));
  assert.equal(calls.sessionClaims.tenantId, "tenant-1");
  assert.equal(calls.sessionClaims.actorId, "user-1");
});


function policyFixture({ ctx, existing = null, assuranceIssues = [] }) {
  const calls = { upserts: 0, audits: 0 };
  const inputValidation = {
    readJsonObject: async (request) => request.json(),
    asFiniteNumber: (value) => typeof value === "number" && Number.isFinite(value) ? value : null,
    asOptionalText: (value, max) => value === undefined ? undefined : value === null || value === "" ? undefined : typeof value === "string" && value.length <= max ? value : null,
    asText: (value, max) => typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null
  };
  const tx = {
    tenantSecurityPolicy: {
      upsert: async ({ create, update }) => {
        calls.upserts += 1;
        return { id: "policy-1", tenantId: ctx.tenantId, ...(existing ? update : create) };
      }
    }
  };
  const db = {
    tenant: { findUnique: async () => ({ region: "TR" }) },
    tenantSecurityPolicy: { findUnique: async () => existing },
    $transaction: async (operation) => operation(tx)
  };
  const route = load("app/api/settings/security-policy/route.ts", {
    "@prisma/client": { DataClassification: { RESTRICTED: "RESTRICTED" } },
    "@/lib/audit": { appendAudit: async () => { calls.audits += 1; } },
    "@/lib/auth-assurance": {
      assurancePolicyIssues: () => assuranceIssues,
      authenticationAssuranceConfiguration: () => ({ mfaConfigured: true, deviceTrustConfigured: true }),
      authenticationAssuranceVersion: () => "a".repeat(64)
    },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/db": { db },
    "@/lib/input-validation": inputValidation,
    "@/lib/request-context": {
      getRequestContext: async () => ctx,
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized." }, { status: 401 })
    }
  });
  return { route, calls };
}

async function patchPolicy(route, body) {
  return route.PATCH(new Request("https://hrbp.example.test/api/settings/security-policy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
}

test("security policy cannot enable MFA from a session that has not demonstrated MFA", async () => {
  const { route, calls } = policyFixture({
    ctx: { tenantId: "tenant-1", actorId: "admin-1", role: "TENANT_ADMIN", mfaSatisfied: false, deviceTrustSatisfied: false, assuranceVersion: "a".repeat(64) }
  });
  const response = await patchPolicy(route, {
    dataRegion: "TR",
    mfaRequired: true,
    deviceTrustRequired: false,
    sessionMaxMinutes: 480
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /current OIDC session does not demonstrate MFA/i);
  assert.equal(calls.upserts, 0);
  assert.equal(calls.audits, 0);
});

test("security policy can enable assurance only after the current session demonstrates it", async () => {
  const { route, calls } = policyFixture({
    ctx: { tenantId: "tenant-1", actorId: "admin-1", role: "TENANT_ADMIN", mfaSatisfied: true, deviceTrustSatisfied: true, assuranceVersion: "a".repeat(64) }
  });
  const response = await patchPolicy(route, {
    dataRegion: "TR",
    mfaRequired: true,
    deviceTrustRequired: true,
    sessionMaxMinutes: 120,
    breakGlassEnabled: true,
    downloadWatermarking: true
  });
  assert.equal(response.status, 200);
  assert.equal(calls.upserts, 1);
  assert.equal(calls.audits, 1);
});


test("security policy cannot activate assurance from a stale mapping session", async () => {
  const { route, calls } = policyFixture({
    ctx: {
      tenantId: "tenant-1",
      actorId: "admin-1",
      role: "TENANT_ADMIN",
      mfaSatisfied: true,
      deviceTrustSatisfied: true,
      assuranceVersion: "b".repeat(64)
    }
  });
  const response = await patchPolicy(route, {
    dataRegion: "TR",
    mfaRequired: true,
    deviceTrustRequired: false,
    sessionMaxMinutes: 480
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /different assurance mapping|sign in again/i);
  assert.equal(calls.upserts, 0);
  assert.equal(calls.audits, 0);
});
