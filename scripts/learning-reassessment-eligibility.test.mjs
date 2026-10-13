import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const assignmentStatuses = {
  ASSIGNED: "ASSIGNED", IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED", OVERDUE: "OVERDUE", WAIVED: "WAIVED"
};
const planStatuses = {
  DRAFT: "DRAFT", ACTIVE: "ACTIVE", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED"
};

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency: " + name);
  });
  return module.exports;
}

const eligibility = load("lib/learning-reassessment-eligibility.ts", {
  "@prisma/client": { DevelopmentPlanStatus: planStatuses }
}).learningReassessmentEligibility;

function fixture({
  participant = false,
  planStatus = "ACTIVE",
  planTenant = "tenant-1",
  planEmployment = "employment-1",
  successionActive = true,
  successionPlanActive = true,
  successionTenant = "tenant-1",
  successionPlanTenant = "tenant-1",
  successionEmployment = "employment-1",
  skillTenant = "tenant-1",
  targetProficiency = "ADVANCED",
  ownerActive = true,
  stale = false
} = {}) {
  const calls = { writes: [], audits: [], planNotifications: [], successionNotifications: [], reads: [], ownerLookups: 0, positions: 0 };
  const assignment = {
    id: "learning-1",
    employmentId: "employment-1",
    status: "IN_PROGRESS",
    completedAt: null,
    course: { code: "SEC-101", title: "Secure Development" },
    targetProficiency,
    developmentSkill: { tenantId: skillTenant, code: "SEC-ENG", name: "Security Engineering" },
    developmentPlan: {
      id: "development-1", tenantId: planTenant, employmentId: planEmployment,
      status: planStatus, title: "Security growth", ownerId: "plan-owner-1"
    },
    successionCandidate: {
      id: "candidate-1", active: successionActive, tenantId: successionTenant,
      employmentId: successionEmployment,
      plan: { active: successionPlanActive, tenantId: successionPlanTenant, ownerId: "successor-owner-1", positionId: "position-1" }
    }
  };
  const tx = {
    learningAssignment: {
      findFirst: async args => {
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.select.developmentPlan.select.status, true);
        assert.equal(args.select.developmentPlan.select.employmentId, true);
        assert.equal(args.select.developmentSkill.select.tenantId, true);
        assert.equal(args.select.successionCandidate.select.plan.select.active, true);
        calls.reads.push(args);
        return assignment;
      },
      updateMany: async args => {
        if (stale) return { count: 0 };
        calls.writes.push(args);
        assignment.status = args.data.status;
        return { count: 1 };
      },
      findUnique: async () => ({ id: "learning-1", status: assignment.status })
    },
    userAccount: {
      findFirst: async args => {
        calls.ownerLookups++;
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.active, true);
        return ownerActive ? { id: args.where.id } : null;
      }
    },
    position: {
      findFirst: async args => {
        calls.positions++;
        assert.equal(args.where.tenantId, "tenant-1");
        return { positionCode: "POS-1", title: "Security Lead" };
      }
    }
  };
  const mocks = {
    "@/lib/input-validation": {
      asIdentifier: v => typeof v === "string" && v.trim().length > 0 && v.trim().length <= 191 ? v.trim() : null,
      asEnumValue: (v, allowed) => typeof v === "string" && allowed.includes(v) ? v : null,
      asOptionalText: v => v === undefined ? undefined : typeof v === "string" ? v : null,
      asDecimalInput: v => typeof v === "string" || typeof v === "number" ? String(v) : null,
      readJsonObject: async request => request.json()
    },
    "@prisma/client": { DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" }, LearningAssignmentStatus: assignmentStatuses },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, data) => calls.audits.push(data) },
    "@/lib/authorization": {
      can: () => true,
      forbidden: message => Response.json({ error: message ?? "Forbidden" }, { status: 403 })
    },
    "@/lib/db": { db: { $transaction: async f => f(tx) } },
    "@/lib/learning-reassessment-eligibility": { learningReassessmentEligibility: eligibility },
    "@/lib/development-plan-notifications": {
      enqueueDevelopmentPlanReassessment: async (_tx, data) => { calls.planNotifications.push(data); }
    },
    "@/lib/succession-development-notifications": {
      enqueueSuccessionDevelopmentReassessment: async (_tx, data) => { calls.successionNotifications.push(data); }
    },
    "@/lib/employment-scope": { resolveEmploymentScope: async () => null, canActOnEmployment: () => true },
    "@/lib/request-context": {
      getRequestContext: async () => ({ tenantId: "tenant-1", actorId: "reviewer-1", employmentId: "employment-1" }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  };
  const path = participant
    ? "app/api/learning/assignments/[id]/self-transition/route.ts"
    : "app/api/learning/assignments/[id]/transition/route.ts";
  const route = load(path, mocks);
  async function complete() {
    return route.POST(new Request("https://hrbp.invalid/api/learning/assignments/learning-1/transition", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://hrbp.invalid" },
      body: JSON.stringify({ status: "COMPLETED", score: "92.50", certificateReference: "CERT-2026" })
    }), { params: Promise.resolve({ id: "learning-1" }) });
  }
  return { calls, complete };
}

test("eligible linked plans are reassessed by their active owners on either completion path", async () => {
  for (const participant of [true, false]) {
    const f = fixture({ participant });
    const response = await f.complete();
    assert.equal(response.status, 200);
    assert.equal(f.calls.writes.length, 1);
    assert.equal(f.calls.audits.length, 1);
    assert.equal(f.calls.planNotifications.length, 1);
    assert.equal(f.calls.successionNotifications.length, 1);
    assert.equal(f.calls.planNotifications[0].planId, "development-1");
    assert.equal(f.calls.planNotifications[0].assignmentId, "learning-1");
    assert.equal(f.calls.planNotifications[0].ownerId, "plan-owner-1");
    assert.equal(f.calls.planNotifications[0].tenantId, "tenant-1");
    assert.equal(f.calls.successionNotifications[0].candidateId, "candidate-1");
    assert.equal(f.calls.successionNotifications[0].ownerId, "successor-owner-1");
    assert.equal(f.calls.positions, 1);
  }
});

test("inactive, completed and cancelled development plans cannot trigger stale review requests", async () => {
  for (const participant of [true, false]) {
    for (const status of ["DRAFT", "COMPLETED", "CANCELLED"]) {
      const f = fixture({ participant, planStatus: status });
      assert.equal((await f.complete()).status, 200);
      assert.equal(f.calls.planNotifications.length, 0);
      assert.equal(f.calls.successionNotifications.length, 1);
      assert.equal(f.calls.writes.length, 1);
      assert.equal(f.calls.audits.length, 1);
    }
  }
});

test("cross-tenant and wrong-employee development links do not create decision tasks", async () => {
  for (const overrides of [{ planTenant: "tenant-2" }, { planEmployment: "employment-other" }]) {
    const f = fixture(overrides);
    assert.equal((await f.complete()).status, 200);
    assert.equal(f.calls.planNotifications.length, 0);
    assert.equal(f.calls.successionNotifications.length, 1);
  }
});

test("removed, inactive and incorrectly linked succession records do not trigger reassessment", async () => {
  for (const overrides of [
    { successionActive: false },
    { successionPlanActive: false },
    { successionTenant: "tenant-2" },
    { successionPlanTenant: "tenant-2" },
    { successionEmployment: "employment-other" }
  ]) {
    for (const participant of [true, false]) {
      const f = fixture({ ...overrides, participant });
      assert.equal((await f.complete()).status, 200);
      assert.equal(f.calls.successionNotifications.length, 0);
      assert.equal(f.calls.planNotifications.length, 1);
      assert.equal(f.calls.positions, 0);
      assert.equal(f.calls.writes.length, 1);
    }
  }
});

test("cross-tenant skill or missing proficiency evidence suppresses both follow-up decisions", async () => {
  for (const overrides of [{ skillTenant: "tenant-2" }, { targetProficiency: null }]) {
    const f = fixture(overrides);
    assert.equal((await f.complete()).status, 200);
    assert.equal(f.calls.planNotifications.length, 0);
    assert.equal(f.calls.successionNotifications.length, 0);
    assert.equal(f.calls.ownerLookups, 0);
    assert.equal(f.calls.audits.length, 1);
  }
});

test("inactive reviewers yield owner-null fallback while keeping completion auditable", async () => {
  const f = fixture({ ownerActive: false });
  assert.equal((await f.complete()).status, 200);
  assert.equal(f.calls.planNotifications[0].ownerId, null);
  assert.equal(f.calls.successionNotifications[0].ownerId, null);
  assert.equal(f.calls.audits.length, 1);
});

test("stale competing completion never queues reassessment or audit", async () => {
  for (const participant of [true, false]) {
    const f = fixture({ participant, stale: true });
    assert.equal((await f.complete()).status, 409);
    assert.equal(f.calls.planNotifications.length, 0);
    assert.equal(f.calls.successionNotifications.length, 0);
    assert.equal(f.calls.audits.length, 0);
  }
});
