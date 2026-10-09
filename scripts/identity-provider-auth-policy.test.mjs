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

function fixture({
  runtimeBinding,
  envJit = false,
  assurance = { mfaSatisfied: true, deviceTrustSatisfied: false },
  existingUser = true,
  email = "user@example.test",
  allowedEmailDomains = ["example.test"]
}) {
  const calls = { userLookup: 0, userCreates: 0, createdUser: null, sessionClaims: null };
  const baseUser = {
    id: "user-1",
    tenantId: "tenant-1",
    subject: "subject-1",
    displayName: "Managed User",
    email,
    role: "EMPLOYEE",
    active: true,
    sessionVersion: 1
  };
  const db = {
    tenantSecurityPolicy: {
      findUnique: async () => ({
        sessionMaxMinutes: 480,
        mfaRequired: false,
        deviceTrustRequired: false,
        assuranceEnforcedAt: null
      })
    },
    userAccount: {
      findFirst: async () => {
        calls.userLookup += 1;
        return existingUser ? baseUser : null;
      },
      create: async ({ data }) => {
        calls.userCreates += 1;
        calls.createdUser = data;
        return { ...baseUser, ...data, id: "jit-user-1", sessionVersion: 1 };
      },
      update: async ({ data }) => ({ ...baseUser, ...data })
    },
    person: { findFirst: async () => null },
    tenant: { findUnique: async () => ({ sessionVersion: 1 }) }
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
        allowedEmailDomains,
        jitProvisioning: envJit
      })
    },
    "@/lib/auth-assurance": {
      evaluateOidcAssurance: () => assurance,
      authenticationAssuranceVersion: () => "a".repeat(64)
    },
    "@/lib/auth-session": {
      readOidcTransaction: () => ({
        state: "state-1",
        nonce: "nonce-1",
        verifier: "verifier",
        returnTo: "/",
        exp: Math.floor(Date.now() / 1000) + 60
      }),
      createSessionCookie: (claims) => {
        calls.sessionClaims = claims;
        return "hrbp_session=test; Path=/; HttpOnly";
      },
      clearOidcTransactionCookie: () => "hrbp_oidc_txn=; Max-Age=0"
    },
    "@/lib/db": { withDb: (operation) => operation(db) },
    "@/lib/runtime-identity-provider": {
      enforceOidcRuntimeBinding: async () => runtimeBinding
    },
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
        email,
        name: "Managed User",
        nonce: "nonce-1"
      })
    }
  });

  return { route, calls };
}

async function invoke(route) {
  return route.GET(new Request("https://hrbp.example.test/api/auth/callback?code=code-1&state=state-1"));
}

test("managed provider MFA rejects an unassured token even when tenant MFA policy is off", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      type: "OIDC",
      jitEnabled: false,
      mfaRequired: true
    },
    assurance: { mfaSatisfied: false, deviceTrustSatisfied: false }
  });
  const response = await invoke(route);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /error=mfa-required/);
  assert.equal(calls.userLookup, 0);
  assert.equal(calls.sessionClaims, null);
});

test("managed provider with JIT disabled overrides legacy environment JIT enablement", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      type: "OIDC",
      jitEnabled: false,
      mfaRequired: false
    },
    envJit: true,
    existingUser: false
  });
  const response = await invoke(route);
  assert.match(response.headers.get("location") ?? "", /error=not-provisioned/);
  assert.equal(calls.userCreates, 0);
  assert.equal(calls.sessionClaims, null);
});

test("managed provider with JIT enabled can provision an allowlisted employee even when legacy env JIT is off", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      type: "ENTRA_ID",
      jitEnabled: true,
      mfaRequired: false,
      bindingVersion: 1791576000000
    },
    envJit: false,
    existingUser: false
  });
  const response = await invoke(route);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(calls.userCreates, 1);
  assert.equal(calls.createdUser.role, "EMPLOYEE");
  assert.equal(calls.createdUser.email, "user@example.test");
  assert.ok(calls.sessionClaims);
  assert.equal(calls.sessionClaims.identityProviderId, "idp-1");
  assert.equal(calls.sessionClaims.identityProviderVersion, 1791576000000);
});

test("managed JIT still requires the deployment email-domain allowlist", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      type: "OKTA",
      jitEnabled: true,
      mfaRequired: false
    },
    envJit: false,
    existingUser: false,
    email: "user@outside.test",
    allowedEmailDomains: ["example.test"]
  });
  const response = await invoke(route);
  assert.match(response.headers.get("location") ?? "", /error=not-provisioned/);
  assert.equal(calls.userCreates, 0);
});

test("unmanaged legacy deployment keeps environment-controlled JIT behavior", async () => {
  const { route, calls } = fixture({
    runtimeBinding: { managed: false },
    envJit: true,
    existingUser: false
  });
  const response = await invoke(route);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(calls.userCreates, 1);
  assert.ok(calls.sessionClaims);
});
