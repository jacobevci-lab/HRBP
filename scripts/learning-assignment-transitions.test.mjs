import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const statuses = { ASSIGNED: "ASSIGNED", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED", OVERDUE: "OVERDUE", WAIVED: "WAIVED" };

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency: " + name);
  });
  return module.exports;
}

function fixture({ participant = false, status = "ASSIGNED", allowed = true, ownEmployment = true, stale = false } = {}) {
  const calls = { writes: [], audits: [], transactions: 0 };
  const assignment = {
    id: "assignment-1", employmentId: "employment-1", status, completedAt: null,
    course: { code: "SEC-101", title: "Secure Development" }, targetProficiency: null,
    developmentSkill: null, developmentPlan: null, successionCandidate: null
  };
  const tx = {
    learningAssignment: {
      findFirst: async (args) => {
        assert.equal(args.where.tenantId, "tenant-1");
        return { ...assignment };
      },
      updateMany: async (args) => {
        if (stale) return { count: 0 };
        calls.writes.push(args);
        Object.assign(assignment, args.data);
        return { count: 1 };
      },
      findUnique: async (args) => args.where.id === assignment.id ? { ...assignment } : null
    }
  };
  const mocks = {
    "@/lib/input-validation": {
      asIdentifier: (v) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= 191 ? v.trim() : null,
      asEnumValue: (v, allowedValues) => typeof v === "string" && allowedValues.includes(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null,
      asOptionalText: (v, limit) => {
        if (v === null || v === undefined || v === "") return undefined;
        return typeof v === "string" && v.trim().length > 0 && v.trim().length <= limit ? v.trim() : null;
      },
      asDecimalInput: (v) => {
        if (typeof v !== "number" && typeof v !== "string") return null;
        const raw = String(v).trim();
        return /^-?[0-9]{1,3}([.][0-9]{1,2})?$/.test(raw) ? raw : null;
      },
      readJsonObject: async (request) => request.json()
    },
    "@prisma/client": { DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" }, LearningAssignmentStatus: statuses },
    "@/lib/db": { db: { $transaction: async (fn) => { calls.transactions++; return fn(tx); } } },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message) => Response.json({ error: message ?? "Forbidden" }, { status: 403 })
    },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, audit) => { calls.audits.push(audit); } },
    "@/lib/employment-scope": { resolveEmploymentScope: async () => null, canActOnEmployment: () => allowed },
    "@/lib/request-context": {
      getRequestContext: async () => ({
        tenantId: "tenant-1", actorId: "reviewer-1", employmentId: ownEmployment ? "employment-1" : "employment-other"
      }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 })
    },
    "@/lib/development-plan-notifications": { enqueueDevelopmentPlanReassessment: async () => null },
    "@/lib/succession-development-notifications": { enqueueSuccessionDevelopmentReassessment: async () => null }
  };
  const path = participant
    ? "app/api/learning/assignments/[id]/self-transition/route.ts"
    : "app/api/learning/assignments/[id]/transition/route.ts";
  const route = load(path, mocks);
  async function post(payload, id = "assignment-1") {
    const request = new Request("https://hrbp.invalid/api/learning/assignments/" + id + "/transition", {
      method: "POST",
      headers: { origin: "https://hrbp.invalid", "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    return route.POST(request, { params: Promise.resolve({ id }) });
  }
  return { calls, post };
}

test("administrator waiver requires a bounded human reason and preserves provenance", async () => {
  for (const reason of [undefined, "short", "a".repeat(2001), 42, { value: "fake" }]) {
    const f = fixture();
    const response = await f.post({ status: "WAIVED", waiverReason: reason });
    assert.equal(response.status, 400);
    assert.equal(f.calls.transactions, 0);
    assert.equal(f.calls.writes.length, 0);
  }
  const f = fixture();
  const response = await f.post({ status: "WAIVED", waiverReason: "  Employee has a valid exemption certificate.  " });
  assert.equal(response.status, 200);
  assert.equal(f.calls.writes.length, 1);
  assert.equal(f.calls.writes[0].where.tenantId, "tenant-1");
  assert.equal(f.calls.writes[0].where.status, "ASSIGNED");
  assert.equal(f.calls.writes[0].data.status, "WAIVED");
  assert.equal(f.calls.writes[0].data.waivedById, "reviewer-1");
  assert.equal(f.calls.writes[0].data.waiverReason, "Employee has a valid exemption certificate.");
  assert.ok(f.calls.writes[0].data.waivedAt instanceof Date);
  assert.equal(f.calls.audits.length, 1);
  assert.match(f.calls.audits[0].action, /learning-assignment.transition.assigned.waived/);
});

test("admin transitions reject coercion, precision loss, unbounded text and evidence on non-completion", async () => {
  for (const payload of [
    { status: 12 },
    { status: "IN_PROGRESS", score: "90" },
    { status: "IN_PROGRESS", certificateReference: "fake" },
    { status: "IN_PROGRESS", waiverReason: "reason meant for waiver" },
    { status: "WAIVED", waiverReason: "Valid exemption reason.", score: 75 },
    { status: "COMPLETED", score: true },
    { status: "COMPLETED", score: "97.123" },
    { status: "COMPLETED", score: "-0.01" },
    { status: "COMPLETED", score: "100.01" },
    { status: "COMPLETED", certificateReference: 123 },
    { status: "COMPLETED", certificateReference: "A".repeat(501) }
  ]) {
    const f = fixture({ status: "IN_PROGRESS" });
    const response = await f.post(payload);
    assert.equal(response.status, 400);
    assert.equal(f.calls.transactions, 0);
  }
  const f = fixture({ status: "IN_PROGRESS" });
  const response = await f.post({ status: "COMPLETED", score: "98.50", certificateReference: "CERT-2026-13" });
  assert.equal(response.status, 200);
  assert.equal(f.calls.writes[0].data.score, 98.5);
  assert.equal(f.calls.writes[0].data.certificateReference, "CERT-2026-13");
  assert.ok(f.calls.writes[0].data.completedAt instanceof Date);
  assert.equal(f.calls.audits.length, 1);
});

test("participant completion validates evidence and remains employment-bound", async () => {
  for (const payload of [
    { status: "IN_PROGRESS", score: 40 },
    { status: "COMPLETED", score: "12.345" },
    { status: "COMPLETED", certificateReference: "X".repeat(501) },
    { status: "COMPLETED", certificateReference: ["forged"] },
    { status: "COMPLETED", waiverReason: "employee self exemption" }
  ]) {
    const f = fixture({ participant: true, status: "IN_PROGRESS" });
    const response = await f.post(payload);
    assert.equal(response.status, 400);
    assert.equal(f.calls.writes.length, 0);
  }
  const f = fixture({ participant: true, status: "IN_PROGRESS" });
  const response = await f.post({ status: "COMPLETED", score: "100.00", certificateReference: "CERT-OK" });
  assert.equal(response.status, 200);
  assert.equal(f.calls.writes[0].where.employmentId, "employment-1");
  assert.equal(f.calls.writes[0].data.score, 100);
  assert.equal(f.calls.writes[0].data.certificateReference, "CERT-OK");
  assert.equal(f.calls.audits.length, 1);
});

test("participant cannot waive or change another employee's learning assignment", async () => {
  const waive = fixture({ participant: true });
  const rejectedWaive = await waive.post({ status: "WAIVED" });
  assert.equal(rejectedWaive.status, 409);
  assert.equal(waive.calls.writes.length, 0);

  const wrongIdentity = fixture({ participant: true, ownEmployment: false });
  const response = await wrongIdentity.post({ status: "IN_PROGRESS" });
  assert.equal(response.status, 403);
  assert.equal(wrongIdentity.calls.writes.length, 0);
});

test("governed updates preserve optimistic state comparison and bounded ids", async () => {
  for (const participant of [false, true]) {
    const stale = fixture({ participant, stale: true });
    assert.equal((await stale.post({ status: "IN_PROGRESS" })).status, 409);
    assert.equal(stale.calls.audits.length, 0);
    const invalidId = fixture({ participant });
    assert.equal((await invalidId.post({ status: "IN_PROGRESS" }, "z".repeat(192))).status, 400);
    assert.equal(invalidId.calls.transactions, 0);
  }
  const outOfScope = fixture({ allowed: false });
  assert.equal((await outOfScope.post({ status: "IN_PROGRESS" })).status, 403);
});
