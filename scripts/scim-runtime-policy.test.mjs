import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadScim({ activeProviders = [], databaseError = null, enabled = true, bearer = true, governanceAdoptedAt = null } = {}) {
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
    },
    tenant: {
      findUnique: async () => ({ identityGovernanceAdoptedAt: governanceAdoptedAt })
    }
  };
  const env = {
    HRBP_SCIM_ENABLED: enabled,
    HRBP_AUTH_TENANT_ID: "tenant-1",
    APP_URL: "https://hrbp.example.test",
    HRBP_ALLOWED_EMAIL_DOMAINS: "example.test",
    HRBP_SCIM_TOKEN: "x".repeat(32),
    HRBP_SCIM_TOKEN_PREVIOUS: "",
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
    if (name === "@/lib/internal-auth") return { internalBearerAuthorized: () => bearer };
    if (name === "@/lib/runtime-env") return {
      runtimeBoolean: (key, fallback) => typeof env[key] === "boolean" ? env[key] : fallback,
      runtimeString: (key) => typeof env[key] === "string" ? env[key] : undefined
    };
    if (name === "@/lib/scim-protocol.mjs") return protocol;
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

test("legacy SCIM runtime remains available until a governed active provider exists", async () => {
  const runtime = loadScim();
  assert.deepEqual(await runtime.resolveGovernedScimPolicy({
    identityProviderConnection: { findMany: async () => [] },
    tenant: { findUnique: async () => ({ identityGovernanceAdoptedAt: null }) }
  }, "tenant-1"), { managed: false });
  assert.equal(await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users")), null);
});

test("sticky identity governance blocks SCIM fallback when no governed provider is active", async () => {
  const runtime = loadScim({
    governanceAdoptedAt: new Date("2026-10-09T07:00:00.000Z")
  });
  const policy = await runtime.resolveGovernedScimPolicy({
    identityProviderConnection: { findMany: async () => [] },
    tenant: { findUnique: async () => ({ identityGovernanceAdoptedAt: new Date("2026-10-09T07:00:00.000Z") }) }
  }, "tenant-1");
  assert.deepEqual(policy, {
    managed: true,
    providerId: null,
    providerName: null,
    scimEnabled: false,
    inactive: true
  });
  const response = await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users"));
  assert.equal(response.status, 404);
  assert.match((await response.json()).detail, /governed identity has no active provider/i);
});

test("active governed provider can explicitly disable SCIM even when runtime token is configured", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: false }]
  });
  const response = await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users"));
  assert.equal(response.status, 404);
  assert.match((await response.json()).detail, /disabled by the active governed identity provider/i);
});

test("active governed provider with SCIM enabled keeps the configured runtime available", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: true }]
  });
  assert.equal(await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users")), null);
});

test("ambiguous governed identity state fails SCIM closed", async () => {
  const runtime = loadScim({
    activeProviders: [
      { id: "idp-1", name: "Provider One", scimEnabled: true },
      { id: "idp-2", name: "Provider Two", scimEnabled: true }
    ]
  });
  const response = await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users"));
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /policy is unavailable/i);
});

test("database errors fail governed SCIM policy closed", async () => {
  const runtime = loadScim({ databaseError: new Error("db unavailable") });
  const response = await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users"));
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /policy is unavailable/i);
});

test("invalid bearer credentials are rejected after governed policy permits SCIM", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: true }],
    bearer: false
  });
  const response = await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /Bearer/);
});


test("governed SCIM enablement reports runtime-not-ready instead of pretending policy is off", async () => {
  const runtime = loadScim({
    activeProviders: [{ id: "idp-1", name: "Corporate Entra", scimEnabled: true }],
    enabled: false
  });
  const response = await runtime.scimAccess(new Request("https://hrbp.example.test/api/scim/v2/Users"));
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /enabled by policy.*runtime configuration is not ready/i);
});
