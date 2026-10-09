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

const prisma = {
  ConnectionStatus: { ACTIVE: "ACTIVE" },
  IdentityProviderType: {
    ENTRA_ID: "ENTRA_ID",
    OKTA: "OKTA",
    OIDC: "OIDC",
    SAML: "SAML",
    LDAP: "LDAP",
    LOCAL: "LOCAL"
  }
};

function runtimeModule({ oidc, localConfigured = false, mfaConfigured = true, scimConfigured = true }) {
  return load("lib/runtime-identity-provider.ts", {
    "@prisma/client": prisma,
    "@/lib/auth-assurance": {
      authenticationAssuranceConfiguration: () => ({ mfaConfigured })
    },
    "@/lib/auth-config": {
      getOidcConfig: () => oidc,
      localAuthConfigurationStatus: () => ({ enabled: localConfigured, configured: localConfigured, missing: [] })
    },
    "@/lib/scim": {
      scimRuntimeConfig: () => ({ configured: scimConfigured })
    }
  });
}

const runtimeConfig = {
  issuer: "https://idp.example.test/",
  clientId: "client-1",
  tenantId: "tenant-1",
  scopes: "openid profile email",
  allowedEmailDomains: ["example.test"],
  jitProvisioning: false
};

test("legacy environment-driven OIDC stays usable until an active governed provider exists", async () => {
  const runtime = runtimeModule({ oidc: runtimeConfig });
  const client = {
    identityProviderConnection: {
      findMany: async () => []
    },
    tenant: {
      findUnique: async () => ({ identityGovernanceAdoptedAt: null })
    }
  };
  assert.deepEqual(await runtime.enforceOidcRuntimeBinding(client, runtimeConfig), { managed: false });
});

test("governed OIDC adoption blocks legacy environment fallback when no provider is active", async () => {
  const runtime = runtimeModule({ oidc: runtimeConfig });
  const client = {
    identityProviderConnection: {
      findMany: async () => []
    },
    tenant: {
      findUnique: async () => ({ identityGovernanceAdoptedAt: new Date("2026-10-09T07:00:00.000Z") })
    }
  };
  await assert.rejects(
    runtime.enforceOidcRuntimeBinding(client, runtimeConfig),
    /IDENTITY_PROVIDER_INACTIVE/
  );
});

test("one active matching OIDC provider binds runtime JIT and MFA policy", async () => {
  const runtime = runtimeModule({ oidc: runtimeConfig });
  const client = {
    identityProviderConnection: {
      findMany: async () => [{
        id: "idp-1",
        type: "OIDC",
        issuer: "https://idp.example.test",
        clientId: "client-1",
        jitEnabled: true,
        mfaRequired: true,
        scimEnabled: false,
        updatedAt: new Date("2026-10-09T20:00:00.000Z")
      }]
    }
  };
  assert.deepEqual(await runtime.enforceOidcRuntimeBinding(client, runtimeConfig), {
    managed: true,
    connectionId: "idp-1",
    type: "OIDC",
    jitEnabled: true,
    mfaRequired: true,
    scimEnabled: false,
    bindingVersion: new Date("2026-10-09T20:00:00.000Z").getTime()
  });
});

test("active provider metadata drift fails closed", async () => {
  const runtime = runtimeModule({ oidc: runtimeConfig });
  const client = {
    identityProviderConnection: {
      findMany: async () => [{
        id: "idp-1",
        type: "ENTRA_ID",
        issuer: "https://different.example.test",
        clientId: "client-1",
        jitEnabled: false,
        mfaRequired: true,
        scimEnabled: false
      }]
    }
  };
  await assert.rejects(
    runtime.enforceOidcRuntimeBinding(client, runtimeConfig),
    /IDENTITY_PROVIDER_DRIFT/
  );
});

test("multiple active OIDC-family providers fail closed", async () => {
  const runtime = runtimeModule({ oidc: runtimeConfig });
  const client = {
    identityProviderConnection: {
      findMany: async () => [
        { id: "idp-1", type: "OIDC", issuer: "https://idp.example.test", clientId: "client-1", jitEnabled: false, mfaRequired: true, scimEnabled: false },
        { id: "idp-2", type: "OKTA", issuer: "https://idp.example.test", clientId: "client-1", jitEnabled: false, mfaRequired: true, scimEnabled: false }
      ]
    }
  };
  await assert.rejects(
    runtime.enforceOidcRuntimeBinding(client, runtimeConfig),
    /IDENTITY_PROVIDER_AMBIGUOUS/
  );
});

test("activation readiness distinguishes metadata validity from runtime policy support", () => {
  const runtime = runtimeModule({ oidc: runtimeConfig, localConfigured: false, mfaConfigured: true });

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "OIDC",
    issuer: "https://idp.example.test",
    clientId: "client-1",
    jitEnabled: true,
    mfaRequired: true,
    scimEnabled: false
  }), []);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "OIDC",
    issuer: "https://other.example.test",
    clientId: "client-2",
    jitEnabled: false,
    mfaRequired: false,
    scimEnabled: false
  }), ["runtime issuer match", "runtime clientId match"]);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "SAML",
    issuer: null,
    clientId: null,
    jitEnabled: false,
    mfaRequired: false,
    scimEnabled: false
  }), ["SAML login runtime adapter"]);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "LDAP",
    issuer: "ldaps://ldap.example.test",
    clientId: null,
    jitEnabled: false,
    mfaRequired: false,
    scimEnabled: false
  }), ["LDAP login runtime adapter"]);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "LOCAL",
    issuer: null,
    clientId: null,
    jitEnabled: false,
    mfaRequired: false,
    scimEnabled: false
  }), ["local authentication runtime"]);
});

test("managed JIT cannot activate without an explicit allowed-domain boundary", () => {
  const runtime = runtimeModule({
    oidc: { ...runtimeConfig, allowedEmailDomains: [] },
    mfaConfigured: true
  });
  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "OIDC",
    issuer: "https://idp.example.test",
    clientId: "client-1",
    jitEnabled: true,
    mfaRequired: false,
    scimEnabled: false
  }), ["JIT allowed email domains"]);
});

test("managed MFA cannot activate without signed-token assurance mapping", () => {
  const runtime = runtimeModule({ oidc: runtimeConfig, mfaConfigured: false });
  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "OIDC",
    issuer: "https://idp.example.test",
    clientId: "client-1",
    jitEnabled: false,
    mfaRequired: true,
    scimEnabled: false
  }), ["OIDC MFA claim/value mapping"]);
});


test("managed SCIM cannot activate until the runtime token/domain boundary is ready", () => {
  const runtime = runtimeModule({ oidc: runtimeConfig, scimConfigured: false });
  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "OIDC",
    issuer: "https://idp.example.test",
    clientId: "client-1",
    jitEnabled: false,
    mfaRequired: false,
    scimEnabled: true
  }), ["SCIM runtime configuration"]);
});


test("local identity provider cannot claim governed SCIM runtime", () => {
  const runtime = runtimeModule({ oidc: runtimeConfig, localConfigured: true, scimConfigured: true });
  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "LOCAL",
    issuer: null,
    clientId: null,
    jitEnabled: false,
    mfaRequired: false,
    scimEnabled: true
  }), ["SCIM requires federated identity provider"]);
});
