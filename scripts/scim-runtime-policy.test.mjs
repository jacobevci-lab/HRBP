import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadScim({ activeProviders = [], databaseError = null, enabled = true, currentToken = "x".repeat(32), previousToken = "", previousExpiresAt = "" } = {}) {
  const js = ts.transpileModule(readFileSync("lib/scim.ts", "utf8"), {
    fileName: "lib/scim.ts",
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  const db = {
    identityProviderConnection: {
      findMany: async () => {
        if (databaseError) throw databaseError;
        return activeProviders;
      }
    }
  };
  const env = {
    HRBP_SCIM_ENABLED: enabled,
    HRBP_AUTH_TENANT_ID: "tenant-1",
    APP_URL: "https://hrbp.example.test",
    HRBP_ALLOWED_EMAIL_DOMAINS: "example.test",
    HRBP_SCIM_TOKEN: currentToken,
    HRBP_SCIM_TOKEN_PREVIOUS: previousToken,
    HRBP_SCIM_TOKEN_PREVIOUS_EXPIRES_AT: previousExpiresAt,
    HRBP_SCIM_ALLOW_UNMANAGED_ADOPTION: false
  };
  const protocol = {
    SCIM_ERROR_SCHEMA: "urn:ietf:params:scim:api:messages:2.0:Error",
    normalizeScimDomain: (value) => typeof value === "string" && value.includes(".") ? value.toLowerCase() : null
  };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name === "@prisma/client") return {
      ConnectionStatus: { ACTIVE: "ACTIVE" },
      IdentityProviderType: { ENTRA_ID: "ENTRA_ID", OKTA: "OKTA", OIDC: "OIDC" },
      PlatformRole: { EMPLOYEE: "EMPLOYEE" },
      Prisma: {}
    };
    if (name === "@/lib/db") return { db };
    if (name === "@/lib/internal-auth") return {
      internalBearerAuthorized: (request, secretName) => {
        const expected = env[secretName];
        const authorization = request.headers.get("authorization") ?? "";
        return Boolean(expected && authorization === "Bearer " + expected);
      }
    };
    if (name === "@/lib/runtime-env") return {
      runtimeBoolean: (key, fallback) => typeof env[key] === "boolean" ? env[key] : fallback,
      runtimeString: (key) => typeof env[key] === "string" ? env[key] : undefined
    };
    if (name === "@/lib/scim-protocol.mjs") return protocol;
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

function scimRequest(token = "x".repeat(32)) {
  return new Request("https://hrbp.example.test/api/scim/v2/Users", {
    headers: { authorization: "Bearer " + token }
  });
}

test("legacy SCIM runtime remains available until a governed active provider exists", async () => {
  const runtime = loadScim();
  assert.deepEqual(await runtime.resolveGovernedScimPolicy({
    identityProviderConnection: { findMany: async () => [] }
  }, "tenant-1"), { managed: false });
  assert.equal(await runtime.scimAccess(scimRequest()), null);
});

test("active governed provider can explicitly disable SCIM even when runtime token is configured", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: false }]
  });
  const response = await runtime.scimAccess(scimRequest());
  assert.equal(response.status, 404);
  assert.match((await response.json()).detail, /disabled by the active governed identity provider/i);
});

test("active governed provider with SCIM enabled keeps the configured runtime available", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: true }]
  });
  assert.equal(await runtime.scimAccess(scimRequest()), null);
});

test("ambiguous governed identity state fails SCIM closed", async () => {
  const runtime = loadScim({
    activeProviders: [
      { id: "idp-1", name: "Provider One", scimEnabled: true },
      { id: "idp-2", name: "Provider Two", scimEnabled: true }
    ]
  });
  const response = await runtime.scimAccess(scimRequest());
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /policy is unavailable/i);
});

test("database errors fail governed SCIM policy closed", async () => {
  const runtime = loadScim({ databaseError: new Error("db unavailable") });
  const response = await runtime.scimAccess(scimRequest());
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /policy is unavailable/i);
});

test("invalid bearer credentials are rejected before governed policy lookup matters", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: true }]
  });
  const response = await runtime.scimAccess(scimRequest("wrong-token"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /Bearer/);
});


test("governed SCIM enablement reports runtime-not-ready instead of pretending policy is off", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: true }],
    enabled: false
  });
  const response = await runtime.scimAccess(scimRequest());
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /enabled by policy.*runtime configuration is not ready/i);
});


test("previous SCIM token is accepted only inside a bounded rotation window", async () => {
  const previousToken = "p".repeat(32);
  const previousExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const runtime = loadScim({ previousToken, previousExpiresAt });
  const config = runtime.scimRuntimeConfig();
  assert.equal(config.rotationOverlapActive, true);
  assert.equal(config.rotationConfigurationValid, true);
  assert.equal(config.rotationExpired, false);
  assert.equal(await runtime.scimAccess(scimRequest(previousToken)), null);
});

test("expired previous SCIM token is rejected while the current token stays available", async () => {
  const previousToken = "p".repeat(32);
  const runtime = loadScim({
    previousToken,
    previousExpiresAt: new Date(Date.now() - 60 * 1000).toISOString()
  });
  const config = runtime.scimRuntimeConfig();
  assert.equal(config.configured, true);
  assert.equal(config.rotationOverlapActive, false);
  assert.equal(config.rotationExpired, true);
  assert.equal((await runtime.scimAccess(scimRequest(previousToken))).status, 401);
  assert.equal(await runtime.scimAccess(scimRequest()), null);
});

test("previous SCIM token without a valid expiry is never accepted", async () => {
  const previousToken = "p".repeat(32);
  for (const previousExpiresAt of ["", "not-a-date"]) {
    const runtime = loadScim({ previousToken, previousExpiresAt });
    const config = runtime.scimRuntimeConfig();
    assert.equal(config.rotationOverlapActive, false);
    assert.equal(config.rotationConfigurationValid, false);
    assert.equal((await runtime.scimAccess(scimRequest(previousToken))).status, 401);
    assert.equal(await runtime.scimAccess(scimRequest()), null);
  }
});

test("previous SCIM token overlap cannot be configured beyond seven days", async () => {
  const previousToken = "p".repeat(32);
  const runtime = loadScim({
    previousToken,
    previousExpiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()
  });
  const config = runtime.scimRuntimeConfig();
  assert.equal(config.rotationOverlapActive, false);
  assert.equal(config.rotationConfigurationValid, false);
  assert.equal((await runtime.scimAccess(scimRequest(previousToken))).status, 401);
  assert.equal(await runtime.scimAccess(scimRequest()), null);
});
