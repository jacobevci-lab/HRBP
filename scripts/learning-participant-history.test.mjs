import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const sourcePath = "lib/learning-participant-data.ts";
const statuses = {
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  OVERDUE: "OVERDUE",
  COMPLETED: "COMPLETED",
  WAIVED: "WAIVED"
};

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency: " + name);
  });
  return module.exports;
}

function record(id, status, options = {}) {
  const { ...overrides } = options;
  return {
    id, status,
    dueAt: new Date("2026-10-15T00:00:00.000Z"),
    assignedAt: new Date("2026-10-01T00:00:00.000Z"),
    completedAt: null,
    waivedAt: null,
    score: null,
    certificateReference: null,
    successionCandidateId: null,
    developmentPlanId: null,
    developmentPlan: null,
    targetProficiency: null,
    developmentSkill: null,
    course: { code: "SEC-101", title: "Security training", provider: "Internal", mandatory: true },
    ...overrides
  };
}

function fixture({ permitted = true, employmentId = "employment-1", focused = null, allowFocus = true } = {}) {
  const queries = { list: [], focus: [], dbVisits: 0 };
  const active = record("active-1", "IN_PROGRESS");
  const completed = record("completed-1", "COMPLETED", {
    completedAt: new Date("2026-10-12T18:00:00.000Z"),
    score: { toString: () => "97.50" },
    certificateReference: "CERT-REF-1",
    developmentPlanId: "plan-1",
    developmentPlan: { title: "Cloud security skills" }
  });
  const waived = record("waived-1", "WAIVED", {
    waivedAt: new Date("2026-10-12T20:00:00.000Z"),
    certificateReference: null
  });
  const list = [active, completed, waived];
  const db = {
    learningAssignment: {
      findMany: async args => {
        queries.list.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.employmentId, "employment-1");
        assert.equal(args.take, 100);
        assert.equal(args.select.completedAt, true);
        assert.equal(args.select.certificateReference, true);
        assert.equal(args.select.waivedAt, true);
        return list.filter(x => args.where.status.in.includes(x.status));
      },
      findFirst: async args => {
        queries.focus.push(args);
        assert.equal(args.where.tenantId, "tenant-1");
        assert.equal(args.where.employmentId, "employment-1");
        assert.ok(args.where.status.in.includes("WAIVED"));
        assert.ok(args.where.status.in.includes("COMPLETED"));
        return allowFocus ? focused : null;
      }
    }
  };
  const mocks = {
    "@prisma/client": { LearningAssignmentStatus: statuses },
    "@/lib/authorization": { can: () => permitted },
    "@/lib/db": { withDb: async callback => { queries.dbVisits++; return callback(db); } }
  };
  const module = load(sourcePath, mocks);
  const ctx = { tenantId: "tenant-1", employmentId };
  return { queries, ctx, get: focusId => module.getLearningParticipantData(ctx, focusId) };
}

test("employee sees active actions and a separate, bounded completed/waived history", async () => {
  const f = fixture();
  const items = await f.get();
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(x => x.status), ["IN_PROGRESS", "COMPLETED", "WAIVED"]);
  assert.equal(f.queries.list.length, 2);
  assert.deepEqual(f.queries.list[0].where.status.in, ["ASSIGNED", "IN_PROGRESS", "OVERDUE"]);
  assert.deepEqual(f.queries.list[1].where.status.in, ["COMPLETED", "WAIVED"]);
  assert.deepEqual(f.queries.list[1].orderBy, [{ assignedAt: "desc" }, { id: "desc" }]);
  assert.equal(f.queries.focus.length, 0);
  assert.equal(items[1].certificateReference, "CERT-REF-1");
  assert.equal(items[1].score, "97.50");
  assert.equal(items[1].completedAt, "2026-10-12T18:00:00.000Z");
  assert.equal(items[1].developmentPlanTitle, "Cloud security skills");
  assert.equal(items[2].waivedAt, "2026-10-12T20:00:00.000Z");
  assert.equal(items[2].certificateReference, null);
});

test("exact focused closed record can be shown outside recent history without expanding identity scope", async () => {
  const closed = record("historic-900", "COMPLETED", {
    completedAt: new Date("2025-01-01T12:00:00Z"), certificateReference: "OLD-CERT"
  });
  const f = fixture({ focused: closed });
  const items = await f.get("historic-900");
  assert.equal(f.queries.focus.length, 1);
  assert.equal(f.queries.focus[0].where.id, "historic-900");
  assert.equal(items.filter(x => x.focused).length, 1);
  assert.equal(items[0].id, "historic-900");
  assert.equal(items[0].certificateReference, "OLD-CERT");
  assert.equal(items.length, 4);
});

test("out-of-scope focus has no fallback, even when the caller knows an assignment id", async () => {
  const f = fixture({ allowFocus: false });
  const items = await f.get("someone-elses-assignment");
  assert.equal(items.some(x => x.focused), false);
  assert.equal(items.length, 3);
  assert.equal(f.queries.focus[0].where.employmentId, "employment-1");
});

test("missing employment identity or self-progress permission returns no learning records", async () => {
  for (const options of [{ employmentId: null }, { permitted: false }]) {
    const f = fixture(options);
    assert.deepEqual(await f.get(), []);
    assert.equal(f.queries.dbVisits, 0);
  }
});

test("participant JSX only submits active learning, and renders history as read-only articles", () => {
  const ui = readFileSync("components/learning-participant-console.tsx", "utf8");
  assert.match(ui, /const actionable = assignments\.filter/);
  assert.match(ui, /const history = assignments\.filter/);
  assert.match(ui, /actionable\.length \? actionable\.map\(\(assignment\) => <form/);
  assert.match(ui, /history\.length \? history\.map\(\(assignment\) => <article/);
  assert.match(ui, /assignment\.certificateReference/);
  assert.match(ui, /dateOnly\(assignment\.completedAt\)/);
  assert.match(ui, /dateOnly\(assignment\.waivedAt\)/);
  assert.doesNotMatch(ui, /history\.length \? history\.map\(\(assignment\) => <form/);
});
