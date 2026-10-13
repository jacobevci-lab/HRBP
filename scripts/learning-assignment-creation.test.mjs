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

function fixture({ existing = false, conflict = false, allowed = true, employmentPresent = true } = {}) {
  const calls = { assignments: [], audits: [], notifications: [], readQueries: [], duplicateQuery: null, isolation: null };
  const statuses = { ASSIGNED: "ASSIGNED", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED", OVERDUE: "OVERDUE", WAIVED: "WAIVED" };
  const tx = {
    employment: {
      findFirst: async args => {
        assert.equal(args.where.status.not, "TERMINATED");
        return employmentPresent ? { id: "employment-1" } : null;
      }
    },
    learningCourse: {
      findFirst: async args => {
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.active, true);
        return { id: "course-1", code: "SEC-101", title: "Secure Development" };
      }
    },
    learningAssignment: {
      findFirst: async args => {
        calls.duplicateQuery = args.where;
        return existing ? { id: "open-1" } : null;
      },
      create: async args => {
        calls.assignments.push(args.data);
        return { id: "assignment-1", ...args.data };
      },
      findMany: async args => {
        calls.readQueries.push(args);
        return [{ id: "assignment-1" }];
      }
    }
  };
  const db = {
    learningAssignment: tx.learningAssignment,
    $transaction: async (work, options) => {
      calls.isolation = options?.isolationLevel;
      if (conflict) throw { code: "P2034" };
      return work(tx);
    }
  };
  const mocks = {
    "@/lib/input-validation": {
      asIdentifier: v => typeof v === "string" && v.trim() && v.trim().length <= 191 ? v.trim() : null,
      readJsonObject: async request => {
        const value = await request.json();
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
      }
    },
    "@prisma/client": {
      DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
      EmploymentStatus: { TERMINATED: "TERMINATED" },
      LearningAssignmentStatus: statuses,
      Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } }
    },
    "@/lib/db": { db },
    "@/lib/authorization": {
      can: () => true,
      forbidden: message => Response.json({ error: message || "Forbidden" }, { status: 403 })
    },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, input) => calls.audits.push(input) },
    "@/lib/employment-scope": {
      resolveEmploymentScope: async () => null,
      employmentIdFilter: () => ({}),
      canActOnEmployment: () => allowed
    },
    "@/lib/learning-notifications": {
      enqueueLearningAssignmentNotification: async (_tx, input) => calls.notifications.push(input)
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({ tenantId: "tenant-1", actorId: "admin-1", role: "TALENT_ADMIN" }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  };
  const route = load("app/api/learning/assignments/route.ts", mocks);
  async function post(payload) {
    return route.POST(new Request("https://hrbp.invalid/api/learning/assignments", {
      method: "POST",
      headers: { origin: "https://hrbp.invalid", "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
  }
  return { route, calls, post };
}

test("normal learning assignment creation is atomic, tenant-scoped and notifies once", async () => {
  const f = fixture();
  const response = await f.post({
    employmentId: "employment-1", courseId: "course-1", dueAt: null
  });
  assert.equal(response.status, 201);
  assert.equal(f.calls.isolation, "Serializable");
  assert.deepEqual(f.calls.duplicateQuery, {
    tenantId: "tenant-1",
    employmentId: "employment-1",
    courseId: "course-1",
    status: { in: ["ASSIGNED", "IN_PROGRESS", "OVERDUE"] }
  });
  assert.equal(f.calls.assignments.length, 1);
  assert.equal(f.calls.assignments[0].status, "ASSIGNED");
  assert.equal(f.calls.audits.length, 1);
  assert.equal(f.calls.audits[0].action, "learning-assignment.created");
  assert.equal(f.calls.notifications.length, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("duplicate open employee-course assignments cannot be created or notified twice", async () => {
  const f = fixture({ existing: true });
  const response = await f.post({ employmentId: "employment-1", courseId: "course-1" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /open learning assignment already exists/);
  assert.equal(f.calls.assignments.length, 0);
  assert.equal(f.calls.notifications.length, 0);
  assert.equal(f.calls.audits.length, 0);
});

test("serializable write collisions yield a bounded conflict", async () => {
  const f = fixture({ conflict: true });
  const response = await f.post({ employmentId: "employment-1", courseId: "course-1" });
  assert.equal(response.status, 409);
  assert.equal(f.calls.isolation, "Serializable");
  assert.equal(f.calls.notifications.length, 0);
});

test("terminated employment and out-of-scope target cannot receive new learning obligations", async () => {
  for (const options of [{ employmentPresent: false }, { allowed: false }]) {
    const f = fixture(options);
    const response = await f.post({ employmentId: "employment-1", courseId: "course-1" });
    assert.equal(response.status, options.allowed === false ? 403 : 404);
    assert.equal(f.calls.assignments.length, 0);
  }
});

test("invalid identifiers and past or invalid due dates are rejected before any transaction", async () => {
  for (const payload of [
    { employmentId: { id: "object" }, courseId: "course-1" },
    { employmentId: "employment-1", courseId: 42 },
    { employmentId: "employment-1", courseId: "course-1", dueAt: "invalid-date" },
    { employmentId: "employment-1", courseId: "course-1", dueAt: "2020-01-01" }
  ]) {
    const f = fixture();
    const response = await f.post(payload);
    assert.equal(response.status, 400);
    assert.equal(f.calls.isolation, null);
    assert.equal(f.calls.assignments.length, 0);
  }
});

test("active assignment reads remain bounded and tenant scoped", async () => {
  const f = fixture();
  const response = await f.route.GET(new Request("https://hrbp.invalid/api/learning/assignments"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.calls.readQueries[0].where, { tenantId: "tenant-1" });
  assert.equal(f.calls.readQueries[0].take, 300);
});
