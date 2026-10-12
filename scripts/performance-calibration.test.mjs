import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

const prisma = {
  DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
  PerformanceBand: {
    NEEDS_IMPROVEMENT: "NEEDS_IMPROVEMENT",
    DEVELOPING: "DEVELOPING",
    MEETS: "MEETS",
    EXCEEDS: "EXCEEDS",
    OUTSTANDING: "OUTSTANDING"
  },
  ReviewCycleStatus: {
    DRAFT: "DRAFT",
    OPEN: "OPEN",
    CALIBRATION: "CALIBRATION",
    FINALIZED: "FINALIZED",
    CLOSED: "CLOSED"
  },
  ReviewStatus: {
    NOT_STARTED: "NOT_STARTED",
    SELF_REVIEW: "SELF_REVIEW",
    MANAGER_REVIEW: "MANAGER_REVIEW",
    CALIBRATION: "CALIBRATION",
    FINALIZED: "FINALIZED"
  }
};

function fixture({
  managerRating = "MEETS",
  currentFinalRating = null,
  updatedCount = 1
} = {}) {
  const calls = { updates: [], audits: [] };
  const updatedAt = new Date("2026-10-12T09:00:00.000Z");
  const baseReview = {
    id: "review-1",
    employmentId: "employment-1",
    status: "CALIBRATION",
    managerRating,
    finalRating: currentFinalRating,
    updatedAt,
    cycle: { status: "CALIBRATION", name: "2026 Annual Review" }
  };
  const tx = {
    performanceReview: {
      findFirst: async () => baseReview,
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        return { count: updatedCount };
      },
      findUnique: async () => ({ ...baseReview, status: "FINALIZED", ...(calls.updates.at(-1)?.data ?? {}) })
    }
  };
  const route = load("app/api/performance/reviews/[id]/transition/route.ts", {
    "@/lib/input-validation": {
      readJsonObject: async (request) => request.json()
    },
    "@prisma/client": prisma,
    "@/lib/db": {
      db: { $transaction: async (operation) => operation(tx) }
    },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/audit": {
      appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); }
    },
    "@/lib/employment-scope": {
      resolveEmploymentScope: async () => ({ mode: "ALL" }),
      canActOnEmployment: () => true
    },
    "@/lib/performance-notifications": {
      enqueuePerformanceParticipantNotification: async () => {}
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({
        tenantId: "tenant-1",
        actorId: "admin-1",
        role: "HRBP",
        employmentId: "admin-employment"
      }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized." }, { status: 401 })
    }
  });
  return { route, calls, updatedAt };
}

async function submit(route, body) {
  return route.POST(new Request("https://hrbp.example.test/api/performance/reviews/review-1/transition", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }), { params: Promise.resolve({ id: "review-1" }) });
}

test("calibration override requires meaningful justification", async () => {
  for (const calibrationNotes of [undefined, "", "too short"]) {
    const { route, calls } = fixture();
    const response = await submit(route, {
      status: "FINALIZED",
      finalRating: "EXCEEDS",
      ...(calibrationNotes === undefined ? {} : { calibrationNotes })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /requires a justification of at least 12 characters/i);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.audits.length, 0);
  }
});

test("same-as-manager final rating can finalize without calibration justification", async () => {
  const { route, calls, updatedAt } = fixture({ managerRating: "MEETS" });
  const response = await submit(route, { status: "FINALIZED", finalRating: "MEETS" });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].where, {
    id: "review-1",
    tenantId: "tenant-1",
    status: "CALIBRATION",
    updatedAt
  });
  assert.equal(calls.updates[0].data.finalRating, "MEETS");
  assert.equal(calls.updates[0].data.calibrationNotes, null);
  assert.equal(calls.audits.length, 1);
  assert.match(calls.audits[0].purpose, /manager=MEETS; final=MEETS; override=false; justificationRecorded=false/);
});

test("justified calibration override finalizes with bounded audit decision shape", async () => {
  const { route, calls } = fixture({ managerRating: "MEETS" });
  const response = await submit(route, {
    status: "FINALIZED",
    finalRating: "EXCEEDS",
    calibrationNotes: "Cross-functional impact and sustained delivery justify the calibrated rating."
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].data.finalRating, "EXCEEDS");
  assert.match(calls.updates[0].data.calibrationNotes, /Cross-functional impact/);
  assert.equal(calls.audits.length, 1);
  assert.match(calls.audits[0].purpose, /manager=MEETS; final=EXCEEDS; override=true; justificationRecorded=true/);
  assert.doesNotMatch(calls.audits[0].purpose, /Cross-functional impact/);
});

test("calibration notes reject non-text and overlong values instead of truncating silently", async () => {
  {
    const { route, calls } = fixture();
    const response = await submit(route, {
      status: "FINALIZED",
      finalRating: "MEETS",
      calibrationNotes: { unsafe: true }
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /must be text/i);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls } = fixture();
    const response = await submit(route, {
      status: "FINALIZED",
      finalRating: "MEETS",
      calibrationNotes: "x".repeat(4001)
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /must not exceed 4000 characters/i);
    assert.equal(calls.updates.length, 0);
  }
});

test("concurrent calibration finalization is rejected instead of overwriting another decision", async () => {
  const { route, calls } = fixture({ updatedCount: 0 });
  const response = await submit(route, {
    status: "FINALIZED",
    finalRating: "MEETS"
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed concurrently/i);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.audits.length, 0);
});
