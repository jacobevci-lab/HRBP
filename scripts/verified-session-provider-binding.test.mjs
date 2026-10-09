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

const authSession = load("lib/auth-session.ts", {
  "node:crypto": await import("node:crypto"),
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
  }
});

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
    displayName: "User One",
    email: "user@example.test",
    subject: "subject-1",
    issuedAt: now - 60,
    exp: now + 3600,
    ...overrides
  };
}

function fixture(runtimeBinding) {
  let runtimeCalls = 0;
  const db = {
    userAccount: {
      findFirst: async () => ({
        id: "user-1",
        subject: "subject-1",
        role: "EMPLOYEE",
        email: "user@example.test",
        localAuthEnabled: true,
        localPasswordUpdatedAt: new Date("2026-10-09T20:00:00.000Z"),
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
    employment: {
      findFirst: async () => ({ id: "employment-1" })
    }
  };
  const runtime = load("lib/verified-session.ts", {
    "@/lib/auth-assurance": {
      authenticationAssuranceVersion: () => "a".repeat(64)
    },
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
      validSessionClaims: (value) => Boolean(value),
      effectiveSessionMaxMinutes: (value) => value ?? 480
    },
    "@/lib/db": { db },
    "@/lib/runtime-identity-provider": {
      enforceOidcRuntimeBinding: async () => {
        runtimeCalls += 1;
        if (runtimeBinding instanceof Error) throw runtimeBinding;
        return runtimeBinding;
      }
    }
  });
  return { runtime, getRuntimeCalls: () => runtimeCalls };
}

test("session claim validation requires provider id and generation as a complete pair", () => {
  const paired = claims({ identityProviderId: "idp-1", identityProviderVersion: 7 });
  assert.equal(authSession.validSessionClaims(paired), true);
  assert.equal(authSession.validSessionClaims(claims({ identityProviderId: "idp-1" })), false);
  assert.equal(authSession.validSessionClaims(claims({ identityProviderVersion: 7 })), false);
  assert.equal(authSession.validSessionClaims(claims({ identityProviderId: "idp-1", identityProviderVersion: 0 })), false);
});

test("managed OIDC session remains valid only with the exact provider binding generation", async () => {
  const { runtime } = fixture({
    managed: true,
    connectionId: "idp-1",
    bindingVersion: 1791576000000,
    mfaRequired: false
  });
  const value = claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 1791576000000
  });
  assert.equal(await runtime.verifySessionAccount(value), value);
});

test("managed OIDC session without provider binding evidence is invalidated once", async () => {
  const { runtime } = fixture({
    managed: true,
    connectionId: "idp-1",
    bindingVersion: 1791576000000,
    mfaRequired: false
  });
  assert.equal(await runtime.verifySessionAccount(claims()), null);
});

test("provider lifecycle generation change invalidates an older governed OIDC cookie", async () => {
  const { runtime } = fixture({
    managed: true,
    connectionId: "idp-1",
    bindingVersion: 1791576060000,
    mfaRequired: false
  });
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 1791576000000
  })), null);
});

test("switching active identity provider invalidates sessions from the prior provider", async () => {
  const { runtime } = fixture({
    managed: true,
    connectionId: "idp-2",
    bindingVersion: 1791576060000,
    mfaRequired: false
  });
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 1791576000000
  })), null);
});

test("provider-level MFA remains enforced on every governed OIDC request", async () => {
  const { runtime } = fixture({
    managed: true,
    connectionId: "idp-1",
    bindingVersion: 1791576000000,
    mfaRequired: true
  });
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 1791576000000,
    mfaSatisfied: false
  })), null);
});

test("inactive or ambiguous governed provider state invalidates OIDC sessions fail closed", async () => {
  const { runtime } = fixture(new Error("IDENTITY_PROVIDER_INACTIVE"));
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 1791576000000
  })), null);
});

test("legacy unmanaged OIDC sessions remain compatible only when they carry no governed binding", async () => {
  const { runtime } = fixture({ managed: false });
  const legacy = claims();
  assert.equal(await runtime.verifySessionAccount(legacy), legacy);
  assert.equal(await runtime.verifySessionAccount(claims({
    identityProviderId: "idp-1",
    identityProviderVersion: 1791576000000
  })), null);
});

test("local sessions do not depend on OIDC provider availability", async () => {
  const { runtime, getRuntimeCalls } = fixture(new Error("IDENTITY_PROVIDER_INACTIVE"));
  const local = claims({
    authMethod: "local",
    credentialVersion: new Date("2026-10-09T20:00:00.000Z").toISOString(),
    identityProviderId: undefined,
    identityProviderVersion: undefined
  });
  assert.equal(await runtime.verifySessionAccount(local), local);
  assert.equal(getRuntimeCalls(), 0);
});
