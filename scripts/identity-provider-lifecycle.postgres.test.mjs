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
      select: { id: true, runtimeVersion: true }
    });
    assert.equal(active.length, 1, "exactly one OIDC-family provider must remain active");
    assert.equal(active[0].runtimeVersion, 2, "activation must rotate the provider runtime generation exactly once");

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

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { identityGovernanceAdoptedAt: true }
    });
    assert.ok(tenant?.identityGovernanceAdoptedAt, "first governed OIDC activation must persist sticky tenant adoption");

    const adoptionAudit = await db.auditEvent.findMany({
      where: {
        tenantId,
        resourceType: "Tenant",
        resourceId: tenantId,
        action: "settings.identity-governance-adopted"
      },
      select: { id: true }
    });
    assert.equal(adoptionAudit.length, 1, "tenant governance adoption must be audited exactly once");

    const disabled = await route.PATCH(new Request("https://hrbp.test/api/settings/identity/" + active[0].id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "disable",
        reason: "CI verifies sticky governed fallback protection"
      })
    }), { params: Promise.resolve({ id: active[0].id }) });
    assert.equal(disabled.status, 200);
    const disabledState = await db.identityProviderConnection.findUnique({
      where: { id: active[0].id },
      select: { runtimeVersion: true, status: true }
    });
    assert.equal(disabledState?.status, "DISABLED");
    assert.equal(disabledState?.runtimeVersion, 3, "disable must rotate the provider runtime generation again");
    assert.equal(await db.identityProviderConnection.count({
      where: { tenantId, status: "ACTIVE", type: { in: ["ENTRA_ID", "OKTA", "OIDC"] } }
    }), 0);

    const runtimeBinding = load("lib/runtime-identity-provider.ts", {
      "@prisma/client": prisma,
      "@/lib/auth-assurance": { authenticationAssuranceConfiguration: () => ({ mfaConfigured: true }) },
      "@/lib/auth-config": {
        getOidcConfig: () => ({
          issuer: "https://legacy.example.test",
          clientId: "legacy-client",
          tenantId,
          scopes: "openid profile email",
          allowedEmailDomains: ["example.test"],
          jitProvisioning: true
        }),
        localAuthConfigurationStatus: () => ({ enabled: false, configured: false, missing: [] })
      },
      "@/lib/scim": { scimRuntimeConfig: () => ({ configured: true }) }
    });
    await assert.rejects(
      runtimeBinding.enforceOidcRuntimeBinding(db, {
        issuer: "https://legacy.example.test",
        clientId: "legacy-client",
        tenantId,
        scopes: "openid profile email",
        allowedEmailDomains: ["example.test"],
        jitProvisioning: true
      }),
      /IDENTITY_PROVIDER_INACTIVE/
    );
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
