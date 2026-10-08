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

test("PostgreSQL scheduled employee job-change lifecycle", { skip: process.env.CI !== "true" || !process.env.DATABASE_URL }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp");

  const prisma = require("@prisma/client");
  const db = new prisma.PrismaClient();
  const tenantId = "ci-scheduled-job-change-" + randomUUID();
  const ctx = { tenantId, actorId: "actor-" + randomUUID(), role: prisma.PlatformRole.HR_OPERATIONS };
  const secret = "ci-scheduled-job-change-secret-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const inputValidation = load("lib/input-validation.ts");
  const authSession = load("lib/auth-session.ts", {
    "@prisma/client": prisma,
    "@/lib/runtime-env": {
      runtimeString: (key) => key === "HRBP_SESSION_SECRET" ? secret : undefined,
      runtimeNumber: (_key, fallback) => fallback
    },
    "@/lib/safe-redirect": { sanitizeReturnTo: (value) => value }
  });
  const previewReceipt = load("lib/employee-position-change-preview.ts", {
    "@/lib/auth-session": authSession
  });
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
  const employmentScope = {
    resolveEmploymentScope: async () => ({ mode: "ALL" }),
    canActOnEmployment: () => true
  };
  const dbMock = { withDb: (operation) => operation(db) };

  const previewRoute = load("app/api/people/[personId]/lifecycle/position/preview/route.ts", {
    "@/lib/authorization": authorization,
    "@/lib/db": dbMock,
    "@/lib/employee-position-change-preview": previewReceipt,
    "@/lib/employment-scope": employmentScope,
    "@/lib/input-validation": inputValidation,
    "@/lib/request-context": requestContext
  });
  const scheduleRoute = load("app/api/people/[personId]/lifecycle/position/schedule/route.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/authorization": authorization,
    "@/lib/db": dbMock,
    "@/lib/employee-position-change-preview": previewReceipt,
    "@/lib/input-validation": inputValidation,
    "@/lib/request-context": requestContext
  });
  const cancelRoute = load("app/api/people/[personId]/lifecycle/position/schedule/[id]/route.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/authorization": authorization,
    "@/lib/db": dbMock,
    "@/lib/employment-scope": employmentScope,
    "@/lib/input-validation": inputValidation,
    "@/lib/request-context": requestContext
  });

  const notificationMock = {
    enqueueNotificationOutbox: async (_tx, input) => input
  };
  const scheduler = load("lib/scheduled-position-changes.ts", {
    "@prisma/client": prisma,
    "@/lib/audit": audit,
    "@/lib/db": { db },
    "@/lib/employee-position-change-preview": previewReceipt,
    "@/lib/notification-outbox": notificationMock,
    "@/lib/runtime-env": { runtimeNumber: (_key, fallback) => fallback }
  });

  async function invoke(route, personId, body) {
    const response = await route.POST(new Request("https://hrbp.test/api/job-change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }), { params: Promise.resolve({ personId }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function fixture(label) {
    const now = new Date();
    const orgOld = await db.organizationUnit.create({
      data: { tenantId, code: "OLD-" + label, name: "Old " + label, type: "DEPARTMENT", validFrom: now }
    });
    const orgNew = await db.organizationUnit.create({
      data: { tenantId, code: "NEW-" + label, name: "New " + label, type: "DEPARTMENT", validFrom: now }
    });
    const source = await db.position.create({
      data: {
        tenantId, orgUnitId: orgOld.id, positionCode: "SRC-" + label, title: "Analyst",
        grade: "G5", location: "Istanbul", status: "FILLED", validFrom: now
      }
    });
    const target = await db.position.create({
      data: {
        tenantId, orgUnitId: orgNew.id, positionCode: "DST-" + label, title: "Senior Analyst",
        grade: "G6", location: "Ankara", status: "OPEN", validFrom: now
      }
    });
    const person = await db.person.create({ data: { tenantId, givenName: "Scheduled", familyName: label } });
    const employment = await db.employment.create({
      data: { tenantId, personId: person.id, positionId: source.id, startDate: now, status: "ACTIVE" }
    });
    return { person, employment, source, target };
  }

  function futurePayload(targetPositionId, days = 3) {
    const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const effectiveAt = future.toISOString().slice(0, 10);
    return {
      targetPositionId,
      eventType: "TRANSFERRED",
      effectiveAt,
      reason: "Approved future transfer HR-SCHEDULE-1"
    };
  }

  async function scheduleFixture(label) {
    const fx = await fixture(label);
    const payload = futurePayload(fx.target.id);
    const preview = await invoke(previewRoute, fx.person.id, payload);
    assert.equal(preview.status, 200);
    const scheduled = await invoke(scheduleRoute, fx.person.id, { ...payload, previewReceipt: preview.body.data.receipt });
    assert.equal(scheduled.status, 201);
    return { ...fx, payload, scheduled: scheduled.body.data };
  }

  try {
    await db.tenant.create({ data: { id: tenantId, name: "CI Scheduled Job Changes", region: "test" } });

    await t.test("future reviewed transfer applies once when due", async () => {
      const fx = await scheduleFixture("apply");
      assert.equal((await db.employment.findUnique({ where: { id: fx.employment.id } })).positionId, fx.source.id);

      const runAt = new Date(new Date(fx.payload.effectiveAt).getTime() + 60 * 60 * 1000);
      const report = await scheduler.runScheduledPositionChanges(runAt);
      assert.equal(report.applied, 1);
      assert.equal(report.blocked, 0);

      const scheduled = await db.scheduledPositionChange.findUnique({ where: { id: fx.scheduled.id } });
      assert.equal(scheduled.status, "APPLIED");
      assert.equal(scheduled.attempts, 1);
      assert.ok(scheduled.appliedAt);
      assert.equal((await db.employment.findUnique({ where: { id: fx.employment.id } })).positionId, fx.target.id);
      assert.equal((await db.position.findUnique({ where: { id: fx.source.id } })).status, "OPEN");
      assert.equal((await db.position.findUnique({ where: { id: fx.target.id } })).status, "FILLED");

      const replay = await scheduler.runScheduledPositionChanges(new Date(runAt.getTime() + 60_000));
      assert.equal(replay.applied, 0);
      assert.equal((await db.scheduledPositionChange.findUnique({ where: { id: fx.scheduled.id } })).attempts, 1);
    });

    await t.test("reviewed impact drift blocks automation without changing employment", async () => {
      const fx = await scheduleFixture("drift");
      const reportPerson = await db.person.create({ data: { tenantId, givenName: "New", familyName: "Report" } });
      await db.employment.create({
        data: { tenantId, personId: reportPerson.id, managerEmploymentId: fx.employment.id, startDate: new Date(), status: "ACTIVE" }
      });

      const runAt = new Date(new Date(fx.payload.effectiveAt).getTime() + 60 * 60 * 1000);
      const report = await scheduler.runScheduledPositionChanges(runAt);
      assert.equal(report.applied, 0);
      assert.equal(report.blocked, 1);
      const scheduled = await db.scheduledPositionChange.findUnique({ where: { id: fx.scheduled.id } });
      assert.equal(scheduled.status, "BLOCKED");
      assert.equal(scheduled.blockedCode, "IMPACT_STATE_CHANGED");
      assert.equal((await db.employment.findUnique({ where: { id: fx.employment.id } })).positionId, fx.source.id);
    });

    await t.test("cancelled schedule is never applied", async () => {
      const fx = await scheduleFixture("cancel");
      const response = await cancelRoute.DELETE(new Request("https://hrbp.test/api/job-change/schedule/" + fx.scheduled.id, {
        method: "DELETE"
      }), { params: Promise.resolve({ personId: fx.person.id, id: fx.scheduled.id }) });
      assert.equal(response.status, 200);
      assert.equal((await db.scheduledPositionChange.findUnique({ where: { id: fx.scheduled.id } })).status, "CANCELLED");

      const runAt = new Date(new Date(fx.payload.effectiveAt).getTime() + 60 * 60 * 1000);
      const report = await scheduler.runScheduledPositionChanges(runAt);
      assert.equal(report.applied, 0);
      assert.equal((await db.employment.findUnique({ where: { id: fx.employment.id } })).positionId, fx.source.id);
    });

    await t.test("one pending schedule reserves employment and target", async () => {
      const fx = await fixture("conflict");
      const payload = futurePayload(fx.target.id);
      const preview = await invoke(previewRoute, fx.person.id, payload);
      assert.equal(preview.status, 200);
      const first = await invoke(scheduleRoute, fx.person.id, { ...payload, previewReceipt: preview.body.data.receipt });
      assert.equal(first.status, 201);

      const secondPreview = await invoke(previewRoute, fx.person.id, payload);
      assert.equal(secondPreview.status, 200);
      const second = await invoke(scheduleRoute, fx.person.id, { ...payload, previewReceipt: secondPreview.body.data.receipt });
      assert.equal(second.status, 409);
      assert.match(second.body.error, /pending scheduled change/i);
    });
  } finally {
    try {
      await db.scheduledPositionChange.deleteMany({ where: { tenantId } });
      await db.auditEvent.deleteMany({ where: { tenantId } });
      await db.auditLedgerState.deleteMany({ where: { tenantId } });
      await db.employeeLifecycleEvent.deleteMany({ where: { tenantId } });
      await db.requisition.deleteMany({ where: { tenantId } });
      await db.employment.deleteMany({ where: { tenantId } });
      await db.person.deleteMany({ where: { tenantId } });
      await db.position.deleteMany({ where: { tenantId } });
      await db.organizationUnit.deleteMany({ where: { tenantId } });
      await db.tenant.deleteMany({ where: { id: tenantId } });
    } finally {
      await db.$disconnect();
    }
  }
});
