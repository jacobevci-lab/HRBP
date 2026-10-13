import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const statuses = {
  ASSIGNED: "ASSIGNED", IN_PROGRESS: "IN_PROGRESS", OVERDUE: "OVERDUE",
  COMPLETED: "COMPLETED", WAIVED: "WAIVED"
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

function item(id, status, extra = {}) {
  return {
    id, employmentId: "employment-1", status,
    assignedAt: new Date("2026-10-01T00:00:00Z"),
    dueAt: new Date("2026-10-12T00:00:00Z"),
    completedAt: null,
    score: null,
    certificateReference: null,
    waivedAt: null,
    waivedById: null,
    waiverReason: null,
    successionCandidateId: null,
    developmentPlanId: null,
    developmentPlan: null,
    targetProficiency: null,
    developmentSkill: null,
    course: { code: "SEC-101", title: "Secure Development", mandatory: true },
    ...extra
  };
}

function fixture({ permitted = true } = {}) {
  const log = { learning: [], names: [], scopes: 0, db: 0 };
  const active = item("active-1", "IN_PROGRESS");
  const completed = item("completed-1", "COMPLETED", {
    completedAt: new Date("2026-10-12T14:00:00Z"),
    score: { toString: () => "95.50" },
    certificateReference: "CERT-EMPLOYEE-1",
    developmentPlanId: "development-1",
    developmentPlan: { title: "Cloud security" }
  });
  const waived = item("waived-1", "WAIVED", {
    waivedAt: new Date("2026-10-12T13:00:00Z"),
    waivedById: "reviewer-1",
    waiverReason: "Existing equivalent certified training is recognized."
  });
  const data = [active, completed, waived];
  const db = {
    learningAssignment: {
      findMany: async args => {
        log.learning.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.deepEqual(args.where.employmentId, { in: ["employment-1"] });
        assert.equal(args.select.certificateReference, true);
        assert.equal(args.select.waiverReason, true);
        assert.equal(args.select.waivedById, true);
        return data.filter(row => args.where.status.in.includes(row.status));
      }
    },
    employment: {
      findMany: async args => {
        log.names.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.deepEqual(args.where.id.in, ["employment-1"]);
        return [{
          id: "employment-1",
          person: { givenName: "Ada", familyName: "Security", employeeNumber: "E-1001" }
        }];
      }
    }
  };
  const mocks = {
    "@prisma/client": { BenefitEnrollmentStatus: { PENDING: "PENDING" }, LearningAssignmentStatus: statuses },
    "@/lib/authorization": { can: (_ctx, capability) => capability === "learning:write" && permitted },
    "@/lib/db": { withDb: async callback => { log.db++; return callback(db); } },
    "@/lib/employment-scope": {
      resolveEmploymentScope: async () => { log.scopes++; return "scoped"; },
      employmentIdFilter: scope => { assert.equal(scope, "scoped"); return { employmentId: { in: ["employment-1"] } }; }
    }
  };
  const { getLearningAssignmentOperationsData } = load("lib/growth-lifecycle-data.ts", mocks);
  return { log, get: () => getLearningAssignmentOperationsData({ tenantId: "tenant-1", actorId: "admin-1" }) };
}

test("scoped learning administrators can read active obligations and bounded closed history", async () => {
  const f = fixture();
  const rows = await f.get();
  assert.deepEqual(rows.map(row => row.status), ["IN_PROGRESS", "COMPLETED", "WAIVED"]);
  assert.equal(f.log.scopes, 1);
  assert.equal(f.log.learning.length, 2);
  assert.deepEqual(f.log.learning[0].where.status.in, ["ASSIGNED", "IN_PROGRESS", "OVERDUE"]);
  assert.equal(f.log.learning[0].take, 200);
  assert.deepEqual(f.log.learning[1].where.status.in, ["COMPLETED", "WAIVED"]);
  assert.equal(f.log.learning[1].take, 100);
  assert.deepEqual(f.log.learning[1].orderBy, [{ assignedAt: "desc" }, { id: "desc" }]);
  assert.equal(rows[1].score, "95.50");
  assert.equal(rows[1].certificateReference, "CERT-EMPLOYEE-1");
  assert.equal(rows[1].completedAt, "2026-10-12T14:00:00.000Z");
  assert.equal(rows[1].developmentPlanTitle, "Cloud security");
  assert.equal(rows[2].waivedById, "reviewer-1");
  assert.equal(rows[2].waiverReason, "Existing equivalent certified training is recognized.");
  assert.equal(rows[2].waivedAt, "2026-10-12T13:00:00.000Z");
  assert.equal(rows[2].person, "Ada Security");
  assert.equal(rows[2].employeeNumber, "E-1001");
  assert.equal(f.log.names.length, 1);
});

test("learning history with waiver reasons is inaccessible without learning write permission", async () => {
  const f = fixture({ permitted: false });
  assert.deepEqual(await f.get(), []);
  assert.equal(f.log.db, 0);
  assert.equal(f.log.scopes, 0);
  assert.equal(f.log.learning.length, 0);
  assert.equal(f.log.names.length, 0);
});

test("admin historical decisions appear only as read-only articles", () => {
  const ui = readFileSync("components/growth-lifecycle-console.tsx", "utf8");
  assert.match(ui, /const actionable = rows\.filter/);
  assert.match(ui, /const history = rows\.filter/);
  assert.match(ui, /actionable\.length \? actionable\.map\(\(row\) => <article/);
  assert.match(ui, /history\.length \? history\.map\(\(row\) => <article/);
  assert.match(ui, /row\.waiverReason/);
  assert.match(ui, /row\.waivedById/);
  assert.match(ui, /row\.certificateReference/);
  assert.doesNotMatch(ui, /history\.length \? history\.map\(\(row\) => <form/);
});
