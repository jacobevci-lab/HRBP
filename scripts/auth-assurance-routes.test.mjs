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
    "@/lib/auth-assurance": { evaluateOidcAssurance: () => assurance },
    "@/lib/auth-session": {
      readOidcTransaction: () => ({ state: "state-1", nonce: "nonce-1", verifier: "verifier", returnTo: "/", exp: Math.floor(Date.now() / 1000) + 60 }),
      createSessionCookie: (claims) => {
        calls.sessionClaims = claims;
        return "hrbp_session=test; Path=/; HttpOnly";
      },
      clearOidcTransactionCookie: () => "hrbp_oidc_txn=; Max-Age=0"
    },
    "@/lib/db": { withDb: (operation) => operation(db) },
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
    policy: { sessionMaxMinutes: 480, mfaRequired: true, deviceTrustRequired: false },
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
    policy: { sessionMaxMinutes: 480, mfaRequired: false, deviceTrustRequired: true },
    assurance: { mfaSatisfied: true, deviceTrustSatisfied: false }
  });
  const response = await invoke(route);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /error=device-trust-required/);
  assert.equal(calls.userLookup, 0);
});

test("OIDC callback binds successful assurance evidence into the application session", async () => {
  const { route, calls } = fixture({
    policy: { sessionMaxMinutes: 120, mfaRequired: true, deviceTrustRequired: true },
    assurance: { mfaSatisfied: true, deviceTrustSatisfied: true }
  });
  const response = await invoke(route);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(calls.userLookup, 1);
  assert.ok(calls.sessionClaims);
  assert.equal(calls.sessionClaims.mfaSatisfied, true);
  assert.equal(calls.sessionClaims.deviceTrustSatisfied, true);
  assert.equal(calls.sessionClaims.tenantId, "tenant-1");
  assert.equal(calls.sessionClaims.actorId, "user-1");
});
