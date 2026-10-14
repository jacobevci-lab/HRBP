import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const learningStatuses = {
  ASSIGNED: "ASSIGNED", IN_PROGRESS: "IN_PROGRESS", OVERDUE: "OVERDUE",
  COMPLETED: "COMPLETED", WAIVED: "WAIVED"
};
const prisma = {
  DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
  EmploymentStatus: { TERMINATED: "TERMINATED" },
  DevelopmentPlanStatus: { DRAFT: "DRAFT", ACTIVE: "ACTIVE", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" },
  LearningAssignmentStatus: learningStatuses,
  SkillProficiency: {
    AWARENESS: "AWARENESS", FOUNDATION: "FOUNDATION", PRACTITIONER: "PRACTITIONER",
    ADVANCED: "ADVANCED", EXPERT: "EXPERT"
  },
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } }
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

const routes = [
  {
    domain: "development-plan",
    path: "app/api/talent/development-plans/[id]/learning-assignment/route.ts",
    recordId: "development-plan-1",
    duplicateAction: "DUPLICATE_OPEN_ASSIGNMENT",
    auditCount: 2
  },
  {
    domain: "succession",
    path: "app/api/succession/candidates/[id]/development-assignment/route.ts",
    recordId: "candidate-1",
    duplicateAction: "DUPLICATE_OPEN_PLAN",
    auditCount: 3
  }
];

function fixture(spec, { openAssignment = false, existingClosed = null, dbFailure = null } = {}) {
  const calls = {
    duplicates: [], creates: [], plans: [], audits: [], notifications: [],
    isolation: null, transactionCalls: 0
  };
  const tx = {
    developmentPlan: {
      findFirst: async args => {
        if (args.where.id) {
          assert.equal(args.where.tenantId, "tenant-1");
          return {
            id: "development-plan-1", employmentId: "employee-1", title: "Security development",
            status: "ACTIVE", targetAt: new Date("2099-12-31T00:00:00.000Z"),
            focusSkillId: "skill-1", targetProficiency: "ADVANCED"
          };
        }
        assert.equal(args.where.tenantId, "tenant-1");
        return null;
      },
      create: async args => {
        calls.plans.push(args);
        return { id: "development-plan-created" };
      },
      update: async () => { throw new Error("unexpected existing-plan mutation"); }
    },
    successionCandidate: {
      findFirst: async args => {
        assert.equal(args.where.tenantId, "tenant-1");
        return {
          id: "candidate-1", employmentId: "employee-1", developmentGap: "Improve skill", active: true,
          plan: { id: "succession-plan-1", positionId: "position-1", active: true, ownerId: "owner-1" }
        };
      }
    },
    employment: {
      findFirst: async args => {
        assert.equal(args.where.tenantId, "tenant-1");
        return { id: "employee-1" };
      }
    },
    position: { findFirst: async args => {
      assert.equal(args.where.tenantId, "tenant-1");
      return { positionCode: "POS-1", title: "Security Lead" };
    } },
    employmentSkill: { findFirst: async () => null },
    learningCourse: {
      findFirst: async args => {
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.active, true);
        return { id: "course-1", code: "SEC-101", title: "Secure Development" };
      }
    },
    skill: {
      findFirst: async args => {
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.active, true);
        return { id: "skill-1", code: "SK-1", name: "Cloud Security" };
      }
    },
    talentAssessment: { findFirst: async () => ({ id: "talent-1" }) },
    learningAssignment: {
      findFirst: async args => {
        calls.duplicates.push(args.where);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.employmentId, "employee-1");
        assert.equal(args.where.courseId, "course-1");
        assert.deepEqual(args.where.status.in, ["ASSIGNED", "IN_PROGRESS", "OVERDUE"]);
        assert.equal(Object.hasOwn(args.where, "developmentPlanId"), false);
        assert.equal(Object.hasOwn(args.where, "successionCandidateId"), false);
        assert.equal(Object.hasOwn(args.where, "developmentSkillId"), false);
        return openAssignment ? { id: "another-source-open-assignment" } :
          existingClosed && args.where.status.in.includes(existingClosed) ? { id: "closed" } : null;
      },
      create: async args => {
        calls.creates.push(args.data);
        return { id: "created-assignment-1", ...args.data };
      }
    }
  };
  const db = {
    $transaction: async (fn, options) => {
      calls.transactionCalls++;
      calls.isolation = options?.isolationLevel ?? null;
      if (dbFailure) throw { code: dbFailure };
      return fn(tx);
    }
  };
  const mocks = {
    "@prisma/client": prisma,
    "@/lib/input-validation": { readJsonObject: async request => {
      const data = await request.json();
      return data && typeof data === "object" ? data : null;
    } },
    "@/lib/authorization": {
      can: () => true,
      forbidden: reason => Response.json({ error: reason ?? "Forbidden" }, { status: 403 })
    },
    "@/lib/db": { db },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, entry) => calls.audits.push(entry) },
    "@/lib/employment-scope": {
      resolveEmploymentScope: async () => null,
      canActOnEmployment: () => true,
      employmentPrimaryKeyFilter: () => ({})
    },
    "@/lib/learning-notifications": {
      enqueueLearningAssignmentNotification: async (_tx, notification) => calls.notifications.push(notification)
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({ tenantId: "tenant-1", actorId: "reviewer-1" }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  };
  const { POST } = load(spec.path, mocks);
  async function post() {
    const payload = spec.domain === "development-plan"
      ? { courseId: "course-1", dueAt: "2099-11-14" }
      : { courseId: "course-1", skillId: "skill-1", targetProficiency: "ADVANCED", dueAt: "2099-11-14" };
    return POST(new Request("https://hrbp.invalid/api/test", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://hrbp.invalid" },
      body: JSON.stringify(payload)
    }), { params: Promise.resolve({ id: spec.recordId }) });
  }
  return { post, calls };
}

for (const spec of routes) {
  test(spec.domain + ": prevents open obligations created by any other learning source", async () => {
    const f = fixture(spec, { openAssignment: true });
    const response = await f.post();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /open learning assignment already exists/);
    assert.equal(f.calls.isolation, "Serializable");
    assert.equal(f.calls.duplicates.length, 1);
    assert.equal(f.calls.creates.length, 0);
    assert.equal(f.calls.plans.length, 0);
    assert.equal(f.calls.audits.length, 0);
    assert.equal(f.calls.notifications.length, 0);
  });

  test(spec.domain + ": creates one atomic assignment, audit and notification when course is not open", async () => {
    const f = fixture(spec);
    const response = await f.post();
    assert.equal(response.status, 201);
    assert.equal(f.calls.isolation, "Serializable");
    assert.equal(f.calls.duplicates.length, 1);
    assert.equal(f.calls.creates.length, 1);
    assert.equal(f.calls.creates[0].employmentId, "employee-1");
    assert.equal(f.calls.creates[0].courseId, "course-1");
    assert.equal(f.calls.audits.length, spec.auditCount);
    assert.equal(f.calls.notifications.length, 1);
    assert.equal(f.calls.notifications[0].tenantId, "tenant-1");
    assert.equal(f.calls.notifications[0].employmentId, "employee-1");
  });

  test(spec.domain + ": permits a new learning cycle when only completed or waived history exists", async () => {
    for (const closed of ["COMPLETED", "WAIVED"]) {
      const f = fixture(spec, { existingClosed: closed });
      assert.equal((await f.post()).status, 201);
      assert.equal(f.calls.creates.length, 1);
      assert.equal(f.calls.duplicates.length, 1);
    }
  });

  test(spec.domain + ": maps concurrent serializable and uniqueness conflicts to bounded 409", async () => {
    for (const dbFailure of ["P2034", "P2002"]) {
      const f = fixture(spec, { dbFailure });
      const response = await f.post();
      assert.equal(response.status, 409);
      assert.equal(f.calls.isolation, "Serializable");
      assert.equal(f.calls.creates.length, 0);
      assert.equal(f.calls.notifications.length, 0);
      assert.equal(f.calls.audits.length, 0);
    }
  });
}

test("standard learning POST still enforces the same employee-course open obligation scope", () => {
  const src = readFileSync("app/api/learning/assignments/route.ts", "utf8");
  assert.match(src, /employmentId,[\s\S]*courseId,[\s\S]*status: \{ in: openStatuses \}/);
  assert.match(src, /TransactionIsolationLevel\.Serializable/);
  assert.match(src, /DUPLICATE_OPEN_ASSIGNMENT/);
});
