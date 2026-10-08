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

function runtimeModule({ oidc, localConfigured = false }) {
  return load("lib/runtime-identity-provider.ts", {
    "@prisma/client": prisma,
    "@/lib/auth-config": {
      getOidcConfig: () => oidc,
      localAuthConfigurationStatus: () => ({ enabled: localConfigured, configured: localConfigured, missing: [] })
    }
  });
}

const runtimeConfig = {
  issuer: "https://idp.example.test/",
  clientId: "client-1",
  tenantId: "tenant-1",
  scopes: "openid profile email",
  allowedEmailDomains: [],
  jitProvisioning: false
};

test("legacy environment-driven OIDC stays usable until an active governed provider exists", async () => {
  const runtime = runtimeModule({ oidc: runtimeConfig });
  const client = {
    identityProviderConnection: {
      findMany: async () => []
    }
  };
  assert.deepEqual(await runtime.enforceOidcRuntimeBinding(client, runtimeConfig), { managed: false });
});

test("one active matching OIDC provider binds the runtime", async () => {
  const runtime = runtimeModule({ oidc: runtimeConfig });
  const client = {
    identityProviderConnection: {
      findMany: async () => [{
        id: "idp-1",
        type: "OIDC",
        issuer: "https://idp.example.test",
        clientId: "client-1"
      }]
    }
  };
  assert.deepEqual(await runtime.enforceOidcRuntimeBinding(client, runtimeConfig), {
    managed: true,
    connectionId: "idp-1",
    type: "OIDC"
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
        clientId: "client-1"
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
        { id: "idp-1", type: "OIDC", issuer: "https://idp.example.test", clientId: "client-1" },
        { id: "idp-2", type: "OKTA", issuer: "https://idp.example.test", clientId: "client-1" }
      ]
    }
  };
  await assert.rejects(
    runtime.enforceOidcRuntimeBinding(client, runtimeConfig),
    /IDENTITY_PROVIDER_AMBIGUOUS/
  );
});

test("activation readiness distinguishes metadata validity from runtime support", () => {
  const runtime = runtimeModule({ oidc: runtimeConfig, localConfigured: false });

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "OIDC",
    issuer: "https://idp.example.test",
    clientId: "client-1"
  }), []);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "OIDC",
    issuer: "https://other.example.test",
    clientId: "client-2"
  }), ["runtime issuer match", "runtime clientId match"]);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "SAML",
    issuer: null,
    clientId: null
  }), ["SAML login runtime adapter"]);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "LDAP",
    issuer: "ldaps://ldap.example.test",
    clientId: null
  }), ["LDAP login runtime adapter"]);

  assert.deepEqual(runtime.identityRuntimeActivationIssues({
    type: "LOCAL",
    issuer: null,
    clientId: null
  }), ["local authentication runtime"]);
});
