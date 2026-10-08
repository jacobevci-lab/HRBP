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

test("PostgreSQL governed emergency access lifecycle", { skip: process.env.CI !== "true" || !process.env.DATABASE_URL }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp");

  const prisma = require("@prisma/client");
  const db = new prisma.PrismaClient();
  const tenantId = "ci-emergency-access-" + randomUUID();
  const requesterId = "requester-" + randomUUID();
  const approverId = "approver-" + randomUUID();
  const assuranceVersion = "a".repeat(64);
  const ctx = {
    tenantId,
    actorId: requesterId,
    role: prisma.PlatformRole.TENANT_ADMIN,
    mfaSatisfied: true,
    deviceTrustSatisfied: false,
    assuranceVersion
  };

  const inputValidation = load("lib/input-validation.ts");
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
  const assurance = { authenticationAssuranceVersion: () => assuranceVersion };
  const notificationOutbox = { enqueueNotificationOutbox: async () => ({ queued: true }) };

  const requestRoute = load("app/api/settings/emergency-access/route.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/auth-assurance": assurance,
    "@/lib/authorization": authorization,
    "@/lib/db": { db },
    "@/lib/input-validation": inputValidation,
    "@/lib/request-context": requestContext
  });
  const decisionRoute = load("app/api/settings/emergency-access/[id]/decision/route.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/auth-assurance": assurance,
    "@/lib/authorization": authorization,
    "@/lib/db": { db },
    "@/lib/input-validation": inputValidation,
    "@/lib/notification-outbox": notificationOutbox,
    "@/lib/request-context": requestContext
  });
  const revokeRoute = load("app/api/settings/emergency-access/[id]/route.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/authorization": authorization,
    "@/lib/db": { db },
    "@/lib/input-validation": inputValidation,
    "@/lib/notification-outbox": notificationOutbox,
    "@/lib/request-context": requestContext
  });
  const emergency = load("lib/emergency-access.ts", {
    "@prisma/client": prisma,
    "@/lib/db": { db }
  });

  async function requestAccess(reason = "Production incident recovery requires temporary restricted-data review.") {
    const response = await requestRoute.POST(new Request("https://hrbp.test/api/settings/emergency-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, requestedMinutes: 30 })
    }));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function decide(id, decision) {
    const response = await decisionRoute.POST(new Request("https://hrbp.test/api/settings/emergency-access/" + id + "/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision })
    }), { params: Promise.resolve({ id }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    await db.tenant.create({ data: { id: tenantId, name: "CI Emergency Access", region: "test" } });
    await db.userAccount.createMany({
      data: [
        { id: requesterId, tenantId, subject: "requester", displayName: "Requester Admin", email: "requester@example.test", role: "TENANT_ADMIN", active: true },
        { id: approverId, tenantId, subject: "approver", displayName: "Approver Admin", email: "approver@example.test", role: "TENANT_ADMIN", active: true }
      ]
    });
    await db.tenantSecurityPolicy.create({
      data: {
        tenantId,
        dataRegion: "test",
        mfaRequired: false,
        breakGlassEnabled: true,
        updatedById: requesterId
      }
    });

    await t.test("requester cannot self-approve and independent admin activation is live-resolved", async () => {
      ctx.actorId = requesterId;
      const requested = await requestAccess();
      assert.equal(requested.status, 201);
      assert.equal(requested.body.data.status, "REQUESTED");

      const self = await decide(requested.body.data.id, "APPROVE");
      assert.equal(self.status, 403);

      ctx.actorId = approverId;
      const approved = await decide(requested.body.data.id, "APPROVE");
      assert.equal(approved.status, 200);
      assert.equal(approved.body.data.status, "ACTIVE");
      assert.ok(approved.body.data.validTo);

      const active = await emergency.resolveEmergencyAccess({
        tenantId,
        actorId: requesterId,
        role: prisma.PlatformRole.TENANT_ADMIN
      });
      assert.equal(active.breakGlassActive, true);
      assert.equal(active.breakGlassGrantId, requested.body.data.id);

      ctx.actorId = requesterId;
      const revoke = await revokeRoute.DELETE(
        new Request("https://hrbp.test/api/settings/emergency-access/" + requested.body.data.id, { method: "DELETE" }),
        { params: Promise.resolve({ id: requested.body.data.id }) }
      );
      assert.equal(revoke.status, 200);
      assert.equal((await db.emergencyAccessGrant.findUnique({ where: { id: requested.body.data.id } })).status, "REVOKED");

      const inactive = await emergency.resolveEmergencyAccess({
        tenantId,
        actorId: requesterId,
        role: prisma.PlatformRole.TENANT_ADMIN
      });
      assert.equal(inactive.breakGlassActive, false);
    });

    await t.test("tenant policy disable makes active grant ineffective immediately", async () => {
      ctx.actorId = requesterId;
      const requested = await requestAccess("Legal incident review requires temporary restricted evidence visibility.");
      assert.equal(requested.status, 201);
      ctx.actorId = approverId;
      assert.equal((await decide(requested.body.data.id, "APPROVE")).status, 200);

      await db.tenantSecurityPolicy.update({ where: { tenantId }, data: { breakGlassEnabled: false } });
      const resolved = await emergency.resolveEmergencyAccess({
        tenantId,
        actorId: requesterId,
        role: prisma.PlatformRole.TENANT_ADMIN
      });
      assert.equal(resolved.breakGlassActive, false);

      await db.tenantSecurityPolicy.update({ where: { tenantId }, data: { breakGlassEnabled: true } });
      await db.emergencyAccessGrant.update({ where: { id: requested.body.data.id }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: approverId } });
    });

    await t.test("concurrent requests do not create overlapping open grants", async () => {
      ctx.actorId = requesterId;
      const [a, b] = await Promise.all([
        requestAccess("Incident A requires time-bound emergency restricted-data read visibility."),
        requestAccess("Incident B requires time-bound emergency restricted-data read visibility.")
      ]);
      assert.deepEqual([a.status, b.status].sort(), [201, 409]);
      assert.equal(await db.emergencyAccessGrant.count({
        where: { tenantId, requesterId, status: { in: ["REQUESTED", "ACTIVE"] } }
      }), 1);
    });

    await t.test("audit ledger contains request, approval and revocation evidence", async () => {
      const actions = await db.auditEvent.findMany({
        where: { tenantId, resourceType: "EmergencyAccessGrant" },
        select: { action: true }
      });
      const names = new Set(actions.map((row) => row.action));
      assert.ok(names.has("security.emergency-access-requested"));
      assert.ok(names.has("security.emergency-access-approved"));
      assert.ok(names.has("security.emergency-access-revoked"));
    });
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { tenantId } });
      await db.auditLedgerState.deleteMany({ where: { tenantId } });
      await db.emergencyAccessGrant.deleteMany({ where: { tenantId } });
      await db.userAccount.deleteMany({ where: { tenantId } });
      await db.tenantSecurityPolicy.deleteMany({ where: { tenantId } });
      await db.tenant.deleteMany({ where: { id: tenantId } });
    } finally {
      await db.$disconnect();
    }
  }
});
