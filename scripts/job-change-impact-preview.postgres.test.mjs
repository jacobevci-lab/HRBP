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

test("PostgreSQL governed job-change preview/apply integration", { skip: process.env.CI !== "true" || !process.env.DATABASE_URL }, async (t) => {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp");

  const prisma = require("@prisma/client");
  const db = new prisma.PrismaClient();
  const tenantId = "ci-job-change-" + randomUUID();
  const ctx = { tenantId, actorId: "actor-" + randomUUID(), role: prisma.PlatformRole.HR_OPERATIONS };
  const secret = "ci-job-change-preview-secret-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ";

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
  const dbMock = { withDb: (operation) => operation(db) };

  const previewRoute = load("app/api/people/[personId]/lifecycle/position/preview/route.ts", {
    "@/lib/authorization": authorization,
    "@/lib/db": dbMock,
    "@/lib/employee-position-change-preview": previewReceipt,
    "@/lib/input-validation": inputValidation,
    "@/lib/request-context": requestContext
  });
  const applyRoute = load("app/api/people/[personId]/lifecycle/position/route.ts", {
    "@/lib/audit": audit,
    "@/lib/authorization": authorization,
    "@/lib/db": dbMock,
    "@/lib/employee-position-change-preview": previewReceipt,
    "@/lib/input-validation": inputValidation,
    "@/lib/prisma-safety": { isPrismaRecordNotFound: (error) => error?.code === "P2025" },
    "@/lib/request-context": requestContext
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
    const now = new Date("2026-10-08T00:00:00.000Z");
    const orgOld = await db.organizationUnit.create({
      data: { tenantId, code: "OLD-" + label, name: "Old " + label, type: "DEPARTMENT", validFrom: now }
    });
    const orgNew = await db.organizationUnit.create({
      data: { tenantId, code: "NEW-" + label, name: "New " + label, type: "DEPARTMENT", validFrom: now }
    });
    const oldPosition = await db.position.create({
      data: {
        tenantId, orgUnitId: orgOld.id, positionCode: "POS-OLD-" + label, title: "Senior Analyst",
        grade: "G6", location: "Istanbul", critical: false, status: "FILLED", validFrom: now
      }
    });
    const targetPosition = await db.position.create({
      data: {
        tenantId, orgUnitId: orgNew.id, positionCode: "POS-NEW-" + label, title: "Lead Analyst",
        grade: "G7", location: "Ankara", critical: true, status: "OPEN", validFrom: now
      }
    });
    const managerPerson = await db.person.create({ data: { tenantId, givenName: "Manager", familyName: label } });
    const managerEmployment = await db.employment.create({
      data: { tenantId, personId: managerPerson.id, startDate: now, status: "ACTIVE" }
    });
    const person = await db.person.create({ data: { tenantId, givenName: "Employee", familyName: label } });
    const employment = await db.employment.create({
      data: {
        tenantId, personId: person.id, positionId: oldPosition.id, managerEmploymentId: managerEmployment.id,
        startDate: now, status: "ACTIVE"
      }
    });
    const reportPerson = await db.person.create({ data: { tenantId, givenName: "Report", familyName: label } });
    await db.employment.create({
      data: { tenantId, personId: reportPerson.id, managerEmploymentId: employment.id, startDate: now, status: "ACTIVE" }
    });
    await db.requisition.create({
      data: {
        tenantId, positionId: targetPosition.id, title: "Target requisition " + label,
        status: "OPEN", openings: 1
      }
    });
    return { person, employment, oldPosition, targetPosition };
  }

  const payloadFor = (targetPositionId) => ({
    targetPositionId,
    eventType: "PROMOTED",
    effectiveAt: "2026-10-08",
    reason: "Approved promotion reference HR-2026-77"
  });

  try {
    await db.tenant.create({ data: { id: tenantId, name: "CI Job Change Preview", region: "test" } });

    await t.test("review-confirm flow persists exactly one governed position change", async () => {
      const fx = await fixture("fresh");
      const payload = payloadFor(fx.targetPosition.id);
      const preview = await invoke(previewRoute, fx.person.id, payload);
      assert.equal(preview.status, 200);
      assert.ok(preview.body.data.receipt);
      assert.equal(preview.body.data.impacts.orgUnitChanged, true);
      assert.equal(preview.body.data.impacts.gradeChanged, true);
      assert.equal(preview.body.data.impacts.locationChanged, true);
      assert.equal(preview.body.data.impacts.directReportCount, 1);
      assert.equal(preview.body.data.impacts.openTargetRequisitionCount, 1);
      assert.ok(preview.body.data.warnings.includes("DIRECT_REPORT_RELATIONSHIPS_UNCHANGED"));
      assert.ok(preview.body.data.warnings.includes("MANAGER_RELATIONSHIP_UNCHANGED"));
      assert.ok(preview.body.data.warnings.includes("TARGET_REQUISITIONS_REMAIN_OPEN"));
      assert.ok(preview.body.data.warnings.includes("GRADE_CHANGE_REQUIRES_COMPENSATION_REVIEW"));
      assert.ok(preview.body.data.warnings.includes("LOCATION_CHANGE_REQUIRES_POLICY_REVIEW"));
      assert.ok(preview.body.data.warnings.includes("TARGET_POSITION_IS_CRITICAL"));

      const applied = await invoke(applyRoute, fx.person.id, { ...payload, previewReceipt: preview.body.data.receipt });
      assert.equal(applied.status, 200);
      assert.equal(applied.body.data.targetPositionId, fx.targetPosition.id);

      const employment = await db.employment.findUnique({ where: { id: fx.employment.id } });
      const source = await db.position.findUnique({ where: { id: fx.oldPosition.id } });
      const target = await db.position.findUnique({ where: { id: fx.targetPosition.id } });
      assert.equal(employment.positionId, fx.targetPosition.id);
      assert.equal(source.status, "OPEN");
      assert.equal(target.status, "FILLED");
      assert.equal(await db.employeeLifecycleEvent.count({ where: { tenantId, personId: fx.person.id, type: "PROMOTED" } }), 1);
      assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: fx.employment.id, action: "EMPLOYEE_PROMOTED" } }), 1);
    });

    await t.test("changed reviewed impact state invalidates the signed preview", async () => {
      const fx = await fixture("stale");
      const payload = payloadFor(fx.targetPosition.id);
      const preview = await invoke(previewRoute, fx.person.id, payload);
      assert.equal(preview.status, 200);

      const extra = await db.person.create({ data: { tenantId, givenName: "Extra", familyName: "Report" } });
      await db.employment.create({
        data: { tenantId, personId: extra.id, managerEmploymentId: fx.employment.id, startDate: new Date("2026-10-08"), status: "ACTIVE" }
      });

      const applied = await invoke(applyRoute, fx.person.id, { ...payload, previewReceipt: preview.body.data.receipt });
      assert.equal(applied.status, 409);
      assert.match(applied.body.error, /impact state changed|preview/i);
      assert.equal((await db.employment.findUnique({ where: { id: fx.employment.id } })).positionId, fx.oldPosition.id);
    });

    await t.test("receipt cannot be replayed by another actor or after reviewed input drift", async () => {
      const fx = await fixture("binding");
      const payload = payloadFor(fx.targetPosition.id);
      const preview = await invoke(previewRoute, fx.person.id, payload);
      assert.equal(preview.status, 200);

      const originalActor = ctx.actorId;
      ctx.actorId = "other-" + randomUUID();
      try {
        const otherActor = await invoke(applyRoute, fx.person.id, { ...payload, previewReceipt: preview.body.data.receipt });
        assert.equal(otherActor.status, 409);
      } finally {
        ctx.actorId = originalActor;
      }

      const changedReason = await invoke(applyRoute, fx.person.id, {
        ...payload,
        reason: "Different approved reason",
        previewReceipt: preview.body.data.receipt
      });
      assert.equal(changedReason.status, 409);
      assert.equal((await db.employment.findUnique({ where: { id: fx.employment.id } })).positionId, fx.oldPosition.id);
    });

    await t.test("target occupancy that appears after preview still blocks apply", async () => {
      const fx = await fixture("occupied");
      const payload = payloadFor(fx.targetPosition.id);
      const preview = await invoke(previewRoute, fx.person.id, payload);
      assert.equal(preview.status, 200);

      const otherPerson = await db.person.create({ data: { tenantId, givenName: "Other", familyName: "Incumbent" } });
      await db.employment.create({
        data: {
          tenantId, personId: otherPerson.id, positionId: fx.targetPosition.id,
          startDate: new Date("2026-10-08"), status: "ACTIVE"
        }
      });

      const applied = await invoke(applyRoute, fx.person.id, { ...payload, previewReceipt: preview.body.data.receipt });
      assert.equal(applied.status, 409);
      assert.match(applied.body.error, /active incumbent/i);
    });

    await t.test("apply without a signed preview never mutates employment", async () => {
      const fx = await fixture("missing");
      const applied = await invoke(applyRoute, fx.person.id, payloadFor(fx.targetPosition.id));
      assert.equal(applied.status, 409);
      assert.match(applied.body.error, /signed impact preview/i);
      assert.equal((await db.employment.findUnique({ where: { id: fx.employment.id } })).positionId, fx.oldPosition.id);
    });
  } finally {
    try {
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
