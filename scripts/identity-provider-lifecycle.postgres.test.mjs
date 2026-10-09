import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const require = createRequire(import.meta.url);

function load(path, mocks = {}) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error("Unmocked dependency " + name);
    return require(name);
  });
  return module.exports;
}

test("PostgreSQL serializes governed identity-provider activation", { skip: process.env.CI !== "true" || !process.env.DATABASE_URL }, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp");

  const prisma = require("@prisma/client");
  const db = new prisma.PrismaClient();
  const tenantId = "ci-idp-lifecycle-" + randomUUID();
  const actorId = "idp-admin-" + randomUUID();
  const ctx = {
    tenantId,
    actorId,
    role: prisma.PlatformRole.TENANT_ADMIN,
    breakGlassActive: false,
    mfaSatisfied: true,
    deviceTrustSatisfied: false
  };

  const inputValidation = load("lib/input-validation.ts");
  const lifecycle = load("lib/identity-provider-lifecycle.ts", { "@prisma/client": prisma });
  const ledger = await import("../lib/audit-ledger-lock.mjs");
  const audit = load("lib/audit.ts", {
    "@/lib/db": { db },
    "@/lib/audit-ledger-lock.mjs": ledger
  });
  const authorization = {
    can: () => true,
    forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
  };
  const requestContext = {
    getRequestContext: async () => ctx,
    mutationOriginAllowed: () => true,
    unauthorized: () => Response.json({ error: "Unauthorized." }, { status: 401 })
  };
  let liveProbeCalls = 0;
  let liveProbeError = null;
  const runtime = {
    identityRuntimeActivationIssues: () => [],
    isOidcRuntimeProvider: (type) => ["ENTRA_ID", "OKTA", "OIDC"].includes(type),
    oidcRuntimeProviderTypes: [
      prisma.IdentityProviderType.ENTRA_ID,
      prisma.IdentityProviderType.OKTA,
      prisma.IdentityProviderType.OIDC
    ]
  };
  const readiness = { identityActivationIssues: () => [] };

  const route = load("app/api/settings/identity/[id]/route.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/authorization": authorization,
    "@/lib/db": { db },
    "@/lib/identity-provider-lifecycle": lifecycle,
    "@/lib/input-validation": inputValidation,
    "@/lib/auth-config": {
      getOidcConfig: () => ({
        issuer: "https://runtime-idp.example.test",
        clientId: "runtime-client",
        tenantId,
        scopes: "openid profile email",
        allowedEmailDomains: ["example.test"],
        jitProvisioning: false
      })
    },
    "@/lib/oidc": {
      oidcValidationCurrent: () => true,
      probeOidcDiscovery: async (issuer) => {
        liveProbeCalls += 1;
        if (liveProbeError) throw liveProbeError;
        return {
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks"
        };
      }
    },
    "@/lib/request-context": requestContext,
    "@/lib/settings-connection-validation": readiness,
    "@/lib/runtime-identity-provider": runtime
  });

  async function activate(id) {
    const response = await route.PATCH(new Request("https://hrbp.test/api/settings/identity/" + id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "activate",
        attestation: "Approved CI activation evidence"
      })
    }), { params: Promise.resolve({ id }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function validate(id) {
    const response = await route.PATCH(new Request("https://hrbp.test/api/settings/identity/" + id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "validate" })
    }), { params: Promise.resolve({ id }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    await db.tenant.create({ data: { id: tenantId, name: "CI IdP Lifecycle", region: "test" } });
    await db.userAccount.create({
      data: {
        id: actorId,
        tenantId,
        subject: "idp-admin",
        displayName: "IdP Admin",
        email: "idp.admin@example.test",
        role: "TENANT_ADMIN",
        active: true
      }
    });

    const now = new Date();
    const [one, two] = await Promise.all([
      db.identityProviderConnection.create({
        data: {
          tenantId,
          name: "OIDC One",
          type: "OIDC",
          issuer: "https://idp-one.example.test",
          clientId: "client-one",
          secretRef: "secret://one",
          status: "DRAFT",
          lastValidatedAt: now
        }
      }),
      db.identityProviderConnection.create({
        data: {
          tenantId,
          name: "OIDC Two",
          type: "OIDC",
          issuer: "https://idp-two.example.test",
          clientId: "client-two",
          secretRef: "secret://two",
          status: "DRAFT",
          lastValidatedAt: now
        }
      })
    ]);

    const results = await Promise.all([activate(one.id), activate(two.id)]);
    assert.deepEqual(results.map((entry) => entry.status).sort((a, b) => a - b), [200, 409]);

    const active = await db.identityProviderConnection.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        type: { in: ["ENTRA_ID", "OKTA", "OIDC"] }
      },
      select: { id: true }
    });
    assert.equal(active.length, 1, "exactly one OIDC-family provider must remain active");

    const rejected = results.find((entry) => entry.status === 409);
    assert.match(rejected?.body?.error ?? "", /(Only one runtime OIDC-family identity provider can be active|state changed concurrently)/i);

    const activationAudit = await db.auditEvent.findMany({
      where: {
        tenantId,
        resourceType: "IdentityProviderConnection",
        action: "settings.identity-provider-activated"
      },
      select: { resourceId: true }
    });
    assert.equal(activationAudit.length, 1, "only the committed activation should be audited");
    assert.equal(activationAudit[0].resourceId, active[0].id);

    const liveProvider = await db.identityProviderConnection.create({
      data: {
        tenantId,
        name: "OIDC Live Validation",
        type: "OIDC",
        issuer: "https://runtime-idp.example.test",
        clientId: "runtime-client",
        secretRef: "secret://live",
        status: "DRAFT"
      }
    });
    const validated = await validate(liveProvider.id);
    assert.equal(validated.status, 200);
    assert.equal(liveProbeCalls, 1);
    const liveState = await db.identityProviderConnection.findUnique({ where: { id: liveProvider.id } });
    assert.ok(liveState?.lastValidatedAt, "successful live OIDC validation must persist freshness evidence");
    assert.equal(await db.auditEvent.count({
      where: {
        tenantId,
        resourceType: "IdentityProviderConnection",
        resourceId: liveProvider.id,
        action: "settings.identity-provider-live-validated"
      }
    }), 1);

    const failingProvider = await db.identityProviderConnection.create({
      data: {
        tenantId,
        name: "OIDC Live Validation Failure",
        type: "OIDC",
        issuer: "https://runtime-idp.example.test",
        clientId: "runtime-client",
        secretRef: "secret://live-failure",
        status: "DRAFT"
      }
    });
    liveProbeError = new Error("OIDC discovery failed with HTTP 503.");
    const failedValidation = await validate(failingProvider.id);
    liveProbeError = null;
    assert.equal(failedValidation.status, 409);
    assert.match(failedValidation.body?.error ?? "", /live validation failed/i);
    const failedState = await db.identityProviderConnection.findUnique({ where: { id: failingProvider.id } });
    assert.equal(failedState?.lastValidatedAt, null);
    assert.equal(await db.auditEvent.count({
      where: {
        tenantId,
        resourceType: "IdentityProviderConnection",
        resourceId: failingProvider.id,
        action: "settings.identity-provider-live-validation-failed"
      }
    }), 1);
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { tenantId } });
      await db.auditLedgerState.deleteMany({ where: { tenantId } });
      await db.identityProviderConnection.deleteMany({ where: { tenantId } });
      await db.userAccount.deleteMany({ where: { tenantId } });
      await db.tenant.deleteMany({ where: { id: tenantId } });
    } finally {
      await db.$disconnect();
    }
  }
});
