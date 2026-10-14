import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

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

const statuses = { DRAFT: "DRAFT", ACTIVE: "ACTIVE", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" };
const proficiency = { AWARENESS: "AWARENESS", FOUNDATION: "FOUNDATION", PRACTITIONER: "PRACTITIONER", ADVANCED: "ADVANCED", EXPERT: "EXPERT" };
const latestCompletion = new Date("2026-10-10T12:00:00.000Z");
const olderAssessment = new Date("2026-10-09T08:00:00.000Z");
const newerAssessment = new Date("2026-10-11T09:00:00.000Z");

function fixture({
  assessedAt = newerAssessment,
  assessedById = "human-assessor-1",
  level = "ADVANCED",
  completedAt = latestCompletion,
  openAssignments = 0,
  hasAssessment = true,
  currentStatus = "ACTIVE",
  updateCount = 1,
  dbFailure = null
} = {}) {
  const calls = { openReads: [], latestReads: [], skills: [], changes: [], audit: [], activation: [], isolation: null };
  const plan = {
    id: "plan-1", employmentId: "employment-1", title: "Security career",
    status: currentStatus,
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    targetAt: new Date("2027-06-01T00:00:00.000Z"),
    focusSkillId: "skill-1", targetProficiency: "ADVANCED",
    focusSkill: { code: "SEC-ARCH", name: "Security architecture" }
  };
  const tx = {
    developmentPlan: {
      findFirst: async args => {
        assert.equal(args.where.id, "plan-1");
        assert.equal(args.where.tenantId, "tenant-1");
        return plan;
      },
      updateMany: async args => {
        calls.changes.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.status, currentStatus);
        return { count: updateCount };
      },
      findUnique: async args => {
        assert.equal(args.where.id, "plan-1");
        return { id: "plan-1", status: calls.changes.at(-1)?.data.status };
      }
    },
    learningAssignment: {
      count: async args => {
        calls.openReads.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.developmentPlanId, "plan-1");
        return openAssignments;
      },
      findFirst: async args => {
        calls.latestReads.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.developmentPlanId, "plan-1");
        assert.equal(args.where.developmentSkillId, "skill-1");
        assert.equal(args.where.status, "COMPLETED");
        assert.deepEqual(args.where.completedAt, { not: null });
        assert.deepEqual(args.orderBy, [{ completedAt: "desc" }, { assignedAt: "desc" }]);
        assert.deepEqual(args.select, { completedAt: true });
        return completedAt ? { completedAt } : null;
      }
    },
    employmentSkill: {
      findFirst: async args => {
        calls.skills.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.employmentId, "employment-1");
        assert.equal(args.where.skillId, "skill-1");
        assert.equal(args.select.proficiency, true);
        assert.equal(args.select.assessedAt, true);
        assert.equal(args.select.assessedById, true);
        return hasAssessment ? { proficiency: level, assessedAt, assessedById } : null;
      }
    }
  };
  const mocks = {
    "@prisma/client": {
      DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
      DevelopmentPlanStatus: statuses,
      LearningAssignmentStatus: { ASSIGNED: "ASSIGNED", IN_PROGRESS: "IN_PROGRESS", OVERDUE: "OVERDUE", COMPLETED: "COMPLETED", WAIVED: "WAIVED" },
      SkillProficiency: proficiency,
      Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } }
    },
    "@/lib/input-validation": { readJsonObject: async request => request.json() },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, event) => calls.audit.push(event) },
    "@/lib/authorization": {
      can: () => true,
      forbidden: message => Response.json({ error: message ?? "Forbidden" }, { status: 403 })
    },
    "@/lib/db": {
      db: { $transaction: async (fn, options) => {
        calls.isolation = options?.isolationLevel ?? null;
        if (dbFailure) throw { code: dbFailure };
        return fn(tx);
      } }
    },
    "@/lib/development-plan-notifications": {
      enqueueDevelopmentPlanActivated: async (_tx, event) => calls.activation.push(event)
    },
    "@/lib/employment-scope": {
      resolveEmploymentScope: async () => null,
      canActOnEmployment: () => true
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({ tenantId: "tenant-1", actorId: "talent-owner-1" }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  };
  const { PATCH } = load("app/api/talent/development-plans/[id]/route.ts", mocks);
  async function patch(payload = { status: "COMPLETED", outcomeNotes: "Human verified the development target with current evidence." }) {
    return PATCH(new Request("https://hrbp.invalid/api/talent/development-plans/plan-1", {
      method: "PATCH", headers: { "content-type": "application/json", origin: "https://hrbp.invalid" },
      body: JSON.stringify(payload)
    }), { params: Promise.resolve({ id: "plan-1" }) });
  }
  return { patch, calls };
}

test("plan may close only after a named human reassessment newer than latest completed training", async () => {
  const f = fixture();
  const response = await f.patch();
  assert.equal(response.status, 200);
  assert.equal(f.calls.isolation, "Serializable");
  assert.equal(f.calls.openReads.length, 1);
  assert.equal(f.calls.latestReads.length, 1);
  assert.equal(f.calls.skills.length, 1);
  assert.equal(f.calls.changes.length, 1);
  assert.equal(f.calls.changes[0].data.status, "COMPLETED");
  assert.ok(f.calls.changes[0].data.completedAt instanceof Date);
  assert.equal(f.calls.audit.length, 1);
  assert.equal(f.calls.audit[0].action, "development-plan.transition.active.completed");
});

test("a proficiency level recorded before course completion is insufficient for plan closure", async () => {
  const f = fixture({ assessedAt: olderAssessment });
  const response = await f.patch();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /new human reassessment after/);
  assert.equal(f.calls.latestReads.length, 1);
  assert.equal(f.calls.changes.length, 0);
  assert.equal(f.calls.audit.length, 0);
});

test("same-millisecond and unassigned assessments cannot be used as post-learning human approval", async () => {
  for (const options of [
    { assessedAt: latestCompletion },
    { assessedById: null }
  ]) {
    const f = fixture(options);
    const response = await f.patch();
    assert.equal(response.status, 409);
    assert.equal(f.calls.changes.length, 0);
  }
});

test("the human assessment must still meet the plan target after learning", async () => {
  for (const options of [
    { hasAssessment: false },
    { level: "PRACTITIONER" }
  ]) {
    const f = fixture(options);
    const response = await f.patch();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /target skill proficiency/);
    assert.equal(f.calls.changes.length, 0);
  }
});

test("waived-only and no-learning plans preserve existing human outcome completion behavior", async () => {
  const f = fixture({ completedAt: null, assessedAt: olderAssessment, assessedById: null });
  const response = await f.patch();
  assert.equal(response.status, 200);
  assert.equal(f.calls.changes.length, 1);
  assert.equal(f.calls.audit.length, 1);
});

test("open linked learning remains a prerequisite and blocks closing before assessment checks", async () => {
  const f = fixture({ openAssignments: 2 });
  const response = await f.patch();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /2 learning actions remain open/);
  assert.equal(f.calls.latestReads.length, 0);
  assert.equal(f.calls.changes.length, 0);
});

test("completed plans still require human outcome notes", async () => {
  const f = fixture();
  const response = await f.patch({ status: "COMPLETED" });
  assert.equal(response.status, 400);
  assert.equal(f.calls.latestReads.length, 0);
  assert.equal(f.calls.changes.length, 0);
});

test("a stale plan transition is rejected without audit or activation notifications", async () => {
  const f = fixture({ updateCount: 0 });
  const response = await f.patch();
  assert.equal(response.status, 409);
  assert.equal(f.calls.audit.length, 0);
  assert.equal(f.calls.activation.length, 0);
});

test("transaction serialization collisions produce safe 409 outcomes", async () => {
  const f = fixture({ dbFailure: "P2034" });
  const response = await f.patch();
  assert.equal(response.status, 409);
  assert.equal(f.calls.isolation, "Serializable");
  assert.equal(f.calls.audit.length, 0);
});

test("draft-to-active lifecycle keeps its existing owner-notification behavior", async () => {
  const f = fixture({ currentStatus: "DRAFT" });
  const response = await f.patch({ status: "ACTIVE" });
  assert.equal(response.status, 200);
  assert.equal(f.calls.openReads.length, 0);
  assert.equal(f.calls.latestReads.length, 0);
  assert.equal(f.calls.activation.length, 1);
  assert.equal(f.calls.activation[0].tenantId, "tenant-1");
  assert.equal(f.calls.audit.length, 1);
});

test("production source locks the post-learning skill evidence to this tenant, employee and focus skill", () => {
  const src = readFileSync("app/api/talent/development-plans/[id]/route.ts", "utf8");
  assert.match(src, /employmentId: plan\.employmentId, skillId: plan\.focusSkillId/);
  assert.match(src, /developmentPlanId: id,[\s\S]*developmentSkillId: plan\.focusSkillId/);
  assert.match(src, /orderBy: \[\{ completedAt: "desc" \}, \{ assignedAt: "desc" \}\]/);
  assert.match(src, /current\.assessedAt <= latestCompletedLearning\.completedAt/);
  assert.match(src, /POST_LEARNING_REASSESSMENT_REQUIRED/);
});
