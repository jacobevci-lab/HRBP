import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error(`Unmocked dependency ${name}`);
    return require(name);
  });
  return module.exports;
}

test("PostgreSQL task planning transaction integration (synthetic identity/scope)", { skip: process.env.CI !== "true" || !process.env.DATABASE_URL }, async (t) => {
  // Never run against a remote/user database. The existing CI creates this disposable DB.
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/hrbp");
  const prisma = require("@prisma/client");
  const db = new prisma.PrismaClient();
  const tenantId = `ci-planning-${randomUUID()}`;
  const ctx = { tenantId, actorId: `actor-${randomUUID()}`, role: "HR_OPERATIONS" };
  const audit = load("lib/audit.ts", { "@/lib/db": { db } });
  let scopeAllowed = true;
  let failAudit = false;
  const helper = load("lib/onboarding-task-planning.ts", {
    "@/lib/audit": { appendAudit: async (...args) => { if (failAudit) throw new Error("simulated audit failure"); return audit.appendAudit(...args); } },
    "@/lib/authorization": { can: () => true },
    "@/lib/db": { withDb: (operation) => operation(db) },
    "@/lib/onboarding-access": { resolveOnboardingPopulationScope: async () => scopeAllowed, canAccessOnboardingPlan: (scope) => scope },
    "@/lib/request-context": { getRequestContext: () => ctx, mutationOriginAllowed: () => true }
  });
  const createRoute = load("app/api/onboarding/plans/[id]/tasks/route.ts", { "@/lib/onboarding-task-planning": helper });
  const deadlineRoute = load("app/api/onboarding/tasks/[id]/deadline/route.ts", { "@/lib/onboarding-task-planning": helper });
  const input = () => ({ title: "CI synthetic planning control", ownerType: "IT", sensitive: true, dueDate: "2026-10-04T09:00:00.000Z", reason: "Synthetic CI task planning verification", expectedPlanStatus: "NOT_STARTED", requestId: randomUUID() });
  const deadline = (date = "2026-10-04T09:00:00.000Z") => ({ dueDate: date, reason: "Synthetic CI missing deadline verification", expectedPlanStatus: "NOT_STARTED", expectedTaskStatus: "NOT_STARTED" });
  const invoke = async (route, id, body) => {
    const response = await route.POST(new Request("https://hrbp.test/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    await db.tenant.create({ data: { id: tenantId, name: "Synthetic task-planning CI", region: "test" } });
    const person = await db.person.create({ data: { tenantId, givenName: "Synthetic", familyName: "Planning" } });
    const employment = await db.employment.create({ data: { tenantId, personId: person.id, startDate: new Date("2026-10-05T00:00:00.000Z"), status: "PREBOARDING" } });
    const plan = await db.onboardingPlan.create({ data: { tenantId, personId: person.id, employmentId: employment.id, targetStartDate: new Date("2026-10-05T00:00:00.000Z") } });
    const newUnscheduled = () => db.onboardingTask.create({ data: { tenantId, planId: plan.id, title: "Synthetic unscheduled control", ownerType: "HR" } });

    await t.test("real creation persists an unstarted task and verifiable audit hash together", async () => {
      const result = await invoke(createRoute, plan.id, input()); assert.equal(result.status, 201);
      const row = await db.onboardingTask.findUnique({ where: { id: result.body.data.id } });
      assert.equal(row.status, "NOT_STARTED"); assert.equal(row.sensitive, true);
      const evidence = await db.auditEvent.findFirst({ where: { tenantId, resourceId: row.id } });
      assert.equal(evidence.action, "onboarding-task.created"); assert.equal(evidence.classification, "RESTRICTED");
      assert.equal(evidence.hash, audit.computeAuditHash(evidence, evidence.previousHash));
    });
    await t.test("concurrent duplicate creation commits one task and one audit event", async () => {
      const payload = input(); const outcomes = await Promise.all([invoke(createRoute, plan.id, payload), invoke(createRoute, plan.id, payload)]);
      assert.deepEqual(outcomes.map((result) => result.status).sort(), [201, 409]);
      const id = outcomes.find((result) => result.status === 201).body.data.id;
      assert.equal(await db.onboardingTask.count({ where: { tenantId, id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: id, action: "onboarding-task.created" } }), 1);
    });
    await t.test("concurrent missing-deadline writes cannot overwrite each other", async () => {
      const task = await newUnscheduled();
      const outcomes = await Promise.all([invoke(deadlineRoute, task.id, deadline()), invoke(deadlineRoute, task.id, deadline("2026-10-04T10:00:00.000Z"))]);
      assert.deepEqual(outcomes.map((result) => result.status).sort(), [200, 409]);
      const winner = outcomes.find((result) => result.status === 200).body.data.dueDate;
      assert.equal((await db.onboardingTask.findUnique({ where: { id: task.id } })).dueDate.toISOString(), winner);
      assert.equal(await db.auditEvent.count({ where: { tenantId, resourceId: task.id, action: "onboarding-task.deadline-assigned" } }), 1);
      assert.equal((await invoke(deadlineRoute, task.id, deadline())).status, 409);
    });
    await t.test("real creation and deadline writes roll back when the audit writer fails", async () => {
      const task = await newUnscheduled();
      const before = await db.onboardingTask.count({ where: { tenantId } });
      failAudit = true;
      try {
        assert.equal((await invoke(createRoute, plan.id, input())).status, 500);
        assert.equal((await invoke(deadlineRoute, task.id, deadline())).status, 500);
      } finally { failAudit = false; }
      assert.equal(await db.onboardingTask.count({ where: { tenantId } }), before);
      assert.equal((await db.onboardingTask.findUnique({ where: { id: task.id } })).dueDate, null);
    });
    await t.test("real closed task stays untouched", async () => {
      const task = await newUnscheduled();
      await db.onboardingTask.update({ where: { id: task.id }, data: { status: "COMPLETED" } });
      assert.equal((await invoke(deadlineRoute, task.id, deadline())).status, 409);
      assert.equal((await db.onboardingTask.findUnique({ where: { id: task.id } })).dueDate, null);
    });
    await t.test("query tenant predicate prevents cross-tenant creation and scheduling", async () => {
      const task = await newUnscheduled(); const original = ctx.tenantId;
      ctx.tenantId = "ci-not-the-record-tenant";
      try {
        assert.equal((await invoke(createRoute, plan.id, input())).status, 404);
        assert.equal((await invoke(deadlineRoute, task.id, deadline())).status, 404);
      } finally { ctx.tenantId = original; }
    });
    await t.test("scope denial and active employment prevent planning despite a valid record ID", async () => {
      scopeAllowed = false;
      assert.equal((await invoke(createRoute, plan.id, input())).status, 404); scopeAllowed = true;
      await db.employment.update({ where: { id: employment.id }, data: { status: "ACTIVE" } });
      assert.equal((await invoke(createRoute, plan.id, input())).status, 409);
    });
  } finally {
    // Delete only this test's random tenant fixtures, never an unscoped table.
    try {
      await db.onboardingTask.deleteMany({ where: { tenantId } });
      await db.onboardingPlan.deleteMany({ where: { tenantId } });
      await db.employment.deleteMany({ where: { tenantId } });
      await db.person.deleteMany({ where: { tenantId } });
      await db.auditEvent.deleteMany({ where: { tenantId } });
      await db.tenant.deleteMany({ where: { id: tenantId } });
    } finally { await db.$disconnect(); }
  }
});
