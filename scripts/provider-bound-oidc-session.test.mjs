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

function fixture({ runtimeBinding, runtimeError = null }) {
  const db = {
    userAccount: {
      findFirst: async () => ({
        id: "user-1",
        subject: "subject-1",
        role: "EMPLOYEE",
        email: "user@example.test",
        localAuthEnabled: false,
        localPasswordUpdatedAt: null,
        sessionVersion: 1,
        tenant: { sessionVersion: 1 }
      })
    },
    tenantSecurityPolicy: {
      findUnique: async () => ({
        sessionMaxMinutes: 480,
        mfaRequired: false,
        deviceTrustRequired: false,
        assuranceEnforcedAt: null
      })
    },
    employment: { findFirst: async () => null }
  };

  const runtime = load("lib/verified-session.ts", {
    "@/lib/auth-assurance": { authenticationAssuranceVersion: () => "a".repeat(64) },
    "@/lib/auth-config": {
      getOidcConfig: () => ({
        issuer: "https://idp.example.test",
        clientId: "client-1",
        tenantId: "tenant-1",
        scopes: "openid profile email",
        allowedEmailDomains: ["example.test"],
        jitProvisioning: false
      })
    },
    "@/lib/auth-session": {
      validSessionClaims: () => true,
      effectiveSessionMaxMinutes: () => 480
    },
    "@/lib/db": { db },
    "@/lib/runtime-identity-provider": {
      enforceOidcRuntimeBinding: async () => {
        if (runtimeError) throw runtimeError;
        return runtimeBinding;
      }
    }
  });
  return runtime;
}

function authSessionRuntime() {
  return load("lib/auth-session.ts", {
    "node:crypto": {
      createHash: () => ({ update: () => ({ digest: () => "hash" }) }),
      createHmac: () => ({ update: () => ({ digest: () => "sig" }) }),
      randomBytes: () => Buffer.alloc(32),
      timingSafeEqual: () => true
    },
    "@prisma/client": {
      PlatformRole: {
        EMPLOYEE: "EMPLOYEE",
        MANAGER: "MANAGER",
        HRBP: "HRBP",
        HR_OPERATIONS: "HR_OPERATIONS",
        RECRUITER: "RECRUITER",
        TIME_ADMIN: "TIME_ADMIN",
        TALENT_ADMIN: "TALENT_ADMIN",
        COMPENSATION_ADMIN: "COMPENSATION_ADMIN",
        PAYROLL_ADMIN: "PAYROLL_ADMIN",
        ER_INVESTIGATOR: "ER_INVESTIGATOR",
        LEGAL: "LEGAL",
        PRIVACY_OFFICER: "PRIVACY_OFFICER",
        SECURITY_AUDITOR: "SECURITY_AUDITOR",
        TENANT_ADMIN: "TENANT_ADMIN"
      }
    },
    "@/lib/runtime-env": {
      runtimeNumber: (_key, fallback) => fallback,
      runtimeString: () => undefined
    },
    "@/lib/safe-redirect": { sanitizeReturnTo: () => "/" }
  });
}

function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 2,
    authMethod: "oidc",
    accountSessionVersion: 1,
    tenantSessionVersion: 1,
    mfaSatisfied: true,
    deviceTrustSatisfied: false,
    assuranceVersion: "a".repeat(64),
    tenantId: "tenant-1",
    actorId: "user-1",
    role: "EMPLOYEE",
    displayName: "Managed User",
    email: "user@example.test",
    subject: "subject-1",
    issuedAt: now,
    exp: now + 3600,
    ...overrides
  };
}

function managedBinding(overrides = {}) {
  return {
    managed: true,
    connectionId: "idp-1",
    bindingVersion: 7,
    type: "OIDC",
    jitEnabled: false,
    mfaRequired: false,
    scimEnabled: false,
    ...overrides
  };
}

test("managed OIDC session remains valid only for exact provider and generation", async () => {
  const runtime = fixture({ runtimeBinding: managedBinding() });
  const session = claims({ identityProviderId: "idp-1", identityProviderVersion: 7 });
  assert.equal(await runtime.verifySessionAccount(session), session);
});

test("provider switch invalidates a previously issued managed OIDC session", async () => {
  const runtime = fixture({ runtimeBinding: managedBinding({ connectionId: "idp-2", bindingVersion: 8 }) });
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 7
  })), null);
});

test("provider lifecycle generation change invalidates existing sessions", async () => {
  const runtime = fixture({ runtimeBinding: managedBinding({ bindingVersion: 8 }) });
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 7
  })), null);
});

test("managed provider adoption forces pre-adoption legacy OIDC sessions to reauthenticate", async () => {
  const runtime = fixture({ runtimeBinding: managedBinding() });
  assert.equal(await runtime.verifySessionAccount(claims()), null);
});

test("provider-level MFA stays effective for already-issued governed sessions", async () => {
  const runtime = fixture({ runtimeBinding: managedBinding({ mfaRequired: true }) });
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 7,
    mfaSatisfied: false
  })), null);
});

test("provider disablement or governed runtime failure invalidates OIDC sessions fail-closed", async () => {
  const runtime = fixture({
    runtimeBinding: { managed: false },
    runtimeError: new Error("IDENTITY_PROVIDER_INACTIVE")
  });
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 7
  })), null);
});

test("legacy environment OIDC session remains valid only while runtime is unmanaged", async () => {
  const runtime = fixture({ runtimeBinding: { managed: false } });
  const legacy = claims();
  assert.equal(await runtime.verifySessionAccount(legacy), legacy);
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 7
  })), null);
});

test("session claim validation requires provider id and generation as an OIDC-only pair", () => {
  const authSession = authSessionRuntime();
  assert.equal(authSession.validSessionClaims(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 7
  })), true);
  assert.equal(authSession.validSessionClaims(claims({ identityProviderId: "idp-1" })), false);
  assert.equal(authSession.validSessionClaims(claims({ identityProviderVersion: 7 })), false);
  assert.equal(authSession.validSessionClaims(claims({
    authMethod: "local",
    identityProviderId: "idp-1",
    identityProviderVersion: 7
  })), false);
  assert.equal(authSession.validSessionClaims(claims({
    identityProviderId: "bad provider id",
    identityProviderVersion: 7
  })), false);
  assert.equal(authSession.validSessionClaims(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 0
  })), false);
});
