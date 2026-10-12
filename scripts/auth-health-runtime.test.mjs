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
  oidcConfigured = true,
  localEnabled = false,
  localConfigured = false,
  binding = { managed: true },
  bindingError = null
} = {}) {
  const config = oidcConfigured ? {
    issuer: "https://idp.example.test",
    clientId: "client-1",
    tenantId: "tenant-1",
    scopes: "openid profile email",
    allowedEmailDomains: ["example.test"],
    jitProvisioning: false
  } : null;

  return load("app/api/health/auth/route.ts", {
    "@/lib/auth-assurance": {
      authenticationAssuranceConfiguration: () => ({
        mfaConfigured: true,
        deviceTrustConfigured: false
      })
    },
    "@/lib/auth-config": {
      authConfigurationStatus: () => ({
        configured: oidcConfigured,
        missing: oidcConfigured ? [] : ["HRBP_OIDC_ISSUER"]
      }),
      getOidcConfig: () => config,
      localAuthConfigurationStatus: () => ({
        enabled: localEnabled,
        configured: localConfigured,
        missing: localEnabled && !localConfigured ? ["HRBP_SESSION_SECRET (32+ chars)"] : []
      })
    },
    "@/lib/db": {
      withDb: async (operation) => operation({})
    },
    "@/lib/runtime-identity-provider": {
      enforceOidcRuntimeBinding: async () => {
        if (bindingError) throw bindingError;
        return binding;
      }
    }
  });
}

async function body(route) {
  const response = await route.GET();
  return { response, json: await response.json() };
}

test("managed governed OIDC reports ready only after runtime binding succeeds", async () => {
  const { response, json } = await body(fixture({
    binding: { managed: true, connectionId: "idp-1", bindingVersion: 4 }
  }));
  assert.equal(response.status, 200);
  assert.equal(json.status, "ok");
  assert.equal(json.authentication, "oidc");
  assert.equal(json.configured, true);
  assert.deepEqual(json.modes[0], {
    mode: "oidc",
    enabled: true,
    configured: true,
    environmentConfigured: true,
    governance: "managed",
    runtimeIssue: null,
    missing: []
  });
});

test("legacy environment OIDC remains healthy only while runtime governance is unmanaged", async () => {
  const { response, json } = await body(fixture({ binding: { managed: false } }));
  assert.equal(response.status, 200);
  assert.equal(json.authentication, "oidc");
  assert.equal(json.modes[0].governance, "legacy");
  assert.equal(json.modes[0].configured, true);
});

test("adopted tenant with no active governed provider fails OIDC health closed", async () => {
  const { response, json } = await body(fixture({
    bindingError: new Error("IDENTITY_PROVIDER_INACTIVE")
  }));
  assert.equal(response.status, 503);
  assert.equal(json.status, "configuration_required");
  assert.equal(json.authentication, "unavailable");
  assert.equal(json.configured, false);
  assert.equal(json.modes[0].configured, false);
  assert.equal(json.modes[0].governance, "blocked");
  assert.equal(json.modes[0].runtimeIssue, "governed_provider_inactive");
});

test("local authentication keeps service available while governed OIDC is blocked", async () => {
  const { response, json } = await body(fixture({
    localEnabled: true,
    localConfigured: true,
    bindingError: new Error("IDENTITY_PROVIDER_DRIFT")
  }));
  assert.equal(response.status, 200);
  assert.equal(json.status, "degraded");
  assert.equal(json.authentication, "local");
  assert.equal(json.configured, true);
  assert.equal(json.modes[0].runtimeIssue, "governed_provider_drift");
  assert.equal(json.modes[1].configured, true);
});

test("ambiguous governed providers and database outages expose only bounded health classes", async () => {
  for (const [error, expected] of [
    [new Error("IDENTITY_PROVIDER_AMBIGUOUS"), "governed_provider_ambiguous"],
    [new Error("database connection leaked details"), "governance_unavailable"]
  ]) {
    const { response, json } = await body(fixture({ bindingError: error }));
    assert.equal(response.status, 503);
    assert.equal(json.modes[0].runtimeIssue, expected);
    assert.ok(!JSON.stringify(json).includes(error.message));
  }
});

test("unconfigured OIDC environment does not query governed runtime", async () => {
  const route = fixture({
    oidcConfigured: false,
    localEnabled: true,
    localConfigured: true,
    bindingError: new Error("must not be observed")
  });
  const { response, json } = await body(route);
  assert.equal(response.status, 200);
  assert.equal(json.status, "ok");
  assert.equal(json.authentication, "local");
  assert.equal(json.modes[0].governance, "unconfigured");
  assert.equal(json.modes[0].runtimeIssue, null);
});
