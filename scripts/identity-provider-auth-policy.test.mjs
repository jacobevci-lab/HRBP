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
  allowedEmailDomains = ["example.test"],
  transactionBinding,
  auditError = null
}) {
  const effectiveRuntimeBinding = runtimeBinding?.managed
    ? { bindingVersion: 7, ...runtimeBinding }
    : runtimeBinding;
  const effectiveTransactionBinding = transactionBinding ?? (effectiveRuntimeBinding?.managed
    ? {
        identityProviderId: effectiveRuntimeBinding.connectionId,
        identityProviderVersion: effectiveRuntimeBinding.bindingVersion
      }
    : {});
  const calls = { userLookup: 0, userCreates: 0, createdUser: null, sessionClaims: null, auditEvents: [], transactionClears: 0 };
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
    "@prisma/client": {
      DataClassification: { INTERNAL: "INTERNAL" },
      PlatformRole: { TENANT_ADMIN: "TENANT_ADMIN", EMPLOYEE: "EMPLOYEE" }
    },
    "@/lib/audit": {
      recordAudit: async (input) => {
        if (auditError) throw auditError;
        calls.auditEvents.push(input);
      }
    },
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
        identityProviderId: effectiveTransactionBinding.identityProviderId,
        identityProviderVersion: effectiveTransactionBinding.identityProviderVersion,
        exp: Math.floor(Date.now() / 1000) + 60
      }),
      createSessionCookie: (claims) => {
        calls.sessionClaims = claims;
        return "hrbp_session=test; Path=/; HttpOnly";
      },
      clearOidcTransactionCookie: () => {
        calls.transactionClears += 1;
        return "hrbp_oidc_txn=; Max-Age=0";
      }
    },
    "@/lib/db": { withDb: (operation) => operation(db) },
    "@/lib/runtime-identity-provider": {
      enforceOidcRuntimeBinding: async () => effectiveRuntimeBinding
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

async function invoke(route, headers = {}, query = "code=code-1&state=state-1") {
  return route.GET(new Request(`https://hrbp.example.test/api/auth/callback?${query}`, { headers }));
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
      mfaRequired: false
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


test("OIDC callback rejects a transaction started under an older provider generation", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      bindingVersion: 8,
      type: "OIDC",
      jitEnabled: false,
      mfaRequired: false
    },
    transactionBinding: {
      identityProviderId: "idp-1",
      identityProviderVersion: 7
    }
  });
  const response = await invoke(route);
  assert.match(response.headers.get("location") ?? "", /error=transaction/);
  assert.equal(calls.userLookup, 0);
  assert.equal(calls.sessionClaims, null);
});

test("OIDC callback rejects an unmanaged transaction after governed provider adoption", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      bindingVersion: 1,
      type: "OIDC",
      jitEnabled: false,
      mfaRequired: false
    },
    transactionBinding: {}
  });
  const response = await invoke(route);
  assert.match(response.headers.get("location") ?? "", /error=transaction/);
  assert.equal(calls.userLookup, 0);
  assert.equal(calls.sessionClaims, null);
});

test("OIDC callback rejects a governed transaction if runtime becomes unmanaged", async () => {
  const { route, calls } = fixture({
    runtimeBinding: { managed: false },
    transactionBinding: {
      identityProviderId: "idp-1",
      identityProviderVersion: 7
    }
  });
  const response = await invoke(route);
  assert.match(response.headers.get("location") ?? "", /error=transaction/);
  assert.equal(calls.userLookup, 0);
  assert.equal(calls.sessionClaims, null);
});


test("successful governed OIDC sign-in records provider generation and assurance audit evidence", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      bindingVersion: 9,
      type: "OIDC",
      jitEnabled: false,
      mfaRequired: false
    },
    assurance: { mfaSatisfied: true, deviceTrustSatisfied: true }
  });
  const response = await invoke(route, { "cf-connecting-ip": "203.0.113.9" });
  assert.equal(response.headers.get("location"), "/");
  assert.equal(calls.auditEvents.length, 1);
  const event = calls.auditEvents[0];
  assert.equal(event.action, "auth.oidc-succeeded");
  assert.equal(event.resourceType, "UserAccount");
  assert.equal(event.resourceId, "user-1");
  assert.equal(event.ctx.tenantId, "tenant-1");
  assert.equal(event.ctx.actorId, "user-1");
  assert.equal(event.ctx.ipAddress, "203.0.113.9");
  assert.equal(event.ctx.mfaSatisfied, true);
  assert.equal(event.ctx.deviceTrustSatisfied, true);
  assert.match(event.purpose, /idp-1 generation 9/);
  assert.match(event.purpose, /MFA=true/);
  assert.match(event.purpose, /deviceTrust=true/);
});

test("OIDC session issuance fails closed when immutable audit persistence is unavailable", async () => {
  const { route, calls } = fixture({
    runtimeBinding: {
      managed: true,
      connectionId: "idp-1",
      bindingVersion: 7,
      type: "OIDC",
      jitEnabled: false,
      mfaRequired: false
    },
    auditError: new Error("audit unavailable")
  });
  const response = await invoke(route);
  assert.match(response.headers.get("location") ?? "", /error=callback/);
  assert.equal(calls.sessionClaims, null);
  assert.equal(calls.userLookup, 1);
});


test("provider-declined OIDC callback requires matching state and clears the transaction", async () => {
  const { route, calls } = fixture({ runtimeBinding: { managed: false } });
  const response = await invoke(route, {}, "error=access_denied&error_description=ignored&state=state-1");
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /error=provider/);
  assert.match(response.headers.get("set-cookie") ?? "", /hrbp_oidc_txn=.*Max-Age=0/);
  assert.equal(calls.transactionClears, 1);
  assert.equal(calls.userLookup, 0);
  assert.equal(calls.sessionClaims, null);
});

test("provider error with missing or mismatched state is treated as state failure, not trusted provider error", async () => {
  for (const query of [
    "error=access_denied",
    "error=access_denied&state=wrong-state"
  ]) {
    const { route, calls } = fixture({ runtimeBinding: { managed: false } });
    const response = await invoke(route, {}, query);
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /error=state/);
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal(calls.transactionClears, 1);
    assert.equal(calls.userLookup, 0);
  }
});

test("terminal callback validation failures always clear the one-time OIDC transaction", async () => {
  const { route, calls } = fixture({ runtimeBinding: { managed: false } });
  const response = await invoke(route, {}, "state=state-1");
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /error=state/);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal(calls.transactionClears, 1);
  assert.equal(calls.userLookup, 0);
});
