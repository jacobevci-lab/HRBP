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

test("PostgreSQL governs one-time OIDC bootstrap administration", { skip: process.env.CI !== "true" || !process.env.DATABASE_URL }, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp");

  const prisma = require("@prisma/client");
  const db = new prisma.PrismaClient();
  const ledger = await import("../lib/audit-ledger-lock.mjs");
  const lifecycle = load("lib/identity-provider-lifecycle.ts", { "@prisma/client": prisma });
  const audit = load("lib/audit.ts", {
    "@/lib/db": { db },
    "@/lib/audit-ledger-lock.mjs": ledger
  });
  const bootstrap = load("lib/bootstrap-admin.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/identity-provider-lifecycle": lifecycle
  });

  const tenantIds = [];
  async function tenant(name, extra = {}) {
    const id = "ci-bootstrap-" + randomUUID();
    tenantIds.push(id);
    await db.tenant.create({ data: { id, name, region: "test", ...extra } });
    return id;
  }

  try {
    const firstTenant = await tenant("CI Bootstrap First Admin");
    const input = {
      tenantId: firstTenant,
      email: "bootstrap.admin@example.test",
      displayName: "Bootstrap Admin"
    };

    const [a, b] = await Promise.all([
      bootstrap.provisionBootstrapAdmin(db, { ...input, subject: "bootstrap-subject-a" }),
      bootstrap.provisionBootstrapAdmin(db, { ...input, subject: "bootstrap-subject-b" })
    ]);

    assert.ok(a.user);
    assert.ok(b.user);
    assert.equal(a.user.id, b.user.id, "concurrent bootstrap attempts must converge on one account");
    assert.equal(await db.userAccount.count({
      where: { tenantId: firstTenant, role: "TENANT_ADMIN", active: true }
    }), 1);
    assert.equal(await db.auditEvent.count({
      where: {
        tenantId: firstTenant,
        resourceType: "UserAccount",
        action: "auth.bootstrap-admin-provisioned"
      }
    }), 1, "bootstrap creation must be audited exactly once");

    const adoptedTenant = await tenant("CI Bootstrap Adopted", {
      identityGovernanceAdoptedAt: new Date()
    });
    const adopted = await bootstrap.provisionBootstrapAdmin(db, {
      tenantId: adoptedTenant,
      subject: "adopted-bootstrap",
      email: "adopted.bootstrap@example.test",
      displayName: "Adopted Bootstrap"
    });
    assert.equal(adopted.user, null);
    assert.equal(adopted.closed, true);
    assert.equal(adopted.reason, "GOVERNANCE_ADOPTED");
    assert.equal(await db.userAccount.count({ where: { tenantId: adoptedTenant } }), 0);

    const administeredTenant = await tenant("CI Bootstrap Existing Admin");
    await db.userAccount.create({
      data: {
        tenantId: administeredTenant,
        subject: "existing-admin",
        displayName: "Existing Admin",
        email: "existing.admin@example.test",
        role: "TENANT_ADMIN",
        active: true
      }
    });
    const blocked = await bootstrap.provisionBootstrapAdmin(db, {
      tenantId: administeredTenant,
      subject: "new-bootstrap",
      email: "new.bootstrap@example.test",
      displayName: "New Bootstrap"
    });
    assert.equal(blocked.user, null);
    assert.equal(blocked.closed, true);
    assert.equal(blocked.reason, "ADMIN_EXISTS");
    assert.equal(await db.userAccount.count({
      where: { tenantId: administeredTenant, role: "TENANT_ADMIN" }
    }), 1);

    const employeeTenant = await tenant("CI Bootstrap Existing Employee");
    const employee = await db.userAccount.create({
      data: {
        tenantId: employeeTenant,
        subject: "existing-employee",
        displayName: "Existing Employee",
        email: "bootstrap.employee@example.test",
        role: "EMPLOYEE",
        active: true
      }
    });
    const existing = await bootstrap.provisionBootstrapAdmin(db, {
      tenantId: employeeTenant,
      subject: "different-subject",
      email: "bootstrap.employee@example.test",
      displayName: "Should Not Promote"
    });
    assert.equal(existing.user?.id, employee.id);
    assert.equal(existing.user?.role, "EMPLOYEE", "bootstrap must never promote an existing account");
    assert.equal(existing.created, false);
    assert.equal(await db.auditEvent.count({
      where: { tenantId: employeeTenant, action: "auth.bootstrap-admin-provisioned" }
    }), 0);
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await db.auditLedgerState.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await db.userAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    } finally {
      await db.$disconnect();
    }
  }
});
