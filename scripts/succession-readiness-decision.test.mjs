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
  EmploymentStatus: { TERMINATED: "TERMINATED" },
  SuccessionReadiness: {
    READY_NOW: "READY_NOW",
    READY_LT_1_YEAR: "READY_LT_1_YEAR",
    READY_1_2_YEARS: "READY_1_2_YEARS",
    READY_2_PLUS_YEARS: "READY_2_PLUS_YEARS"
  }
};

function fixture({ updateCount = 1, currentReadiness = "READY_1_2_YEARS" } = {}) {
  const calls = { updates: [], audits: [], collisions: 0 };
  const updatedAt = new Date("2026-10-12T12:00:00.000Z");
  const candidate = {
    id: "candidate-1",
    planId: "plan-1",
    employmentId: "employment-1",
    readiness: currentReadiness,
    updatedAt,
    plan: { positionId: "position-1", active: true }
  };
  const tx = {
    successionCandidate: {
      findFirst: async ({ where }) => {
        if (Object.prototype.hasOwnProperty.call(where, "rank")) {
          calls.collisions += 1;
          return null;
        }
        return candidate;
      },
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        return { count: updateCount };
      },
      findUnique: async () => ({ ...candidate, ...(calls.updates.at(-1)?.data ?? {}) })
    },
    employment: { findFirst: async () => ({ id: "employment-1" }) }
  };

  const route = load("app/api/succession/candidates/[id]/route.ts", {
    "@/lib/input-validation": {
      asIdentifier: (value) => typeof value === "string" && value.trim() ? value.trim() : null,
      asOptionalText: (value, max) => {
        if (value === undefined || value === null || value === "") return undefined;
        if (typeof value !== "string") return null;
        const normalized = value.trim();
        if (!normalized || normalized.length > max) return null;
        return normalized;
      },
      readJsonObject: async (request) => {
        const value = await request.json();
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
      }
    },
    "@prisma/client": prisma,
    "@/lib/audit": {
      appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); }
    },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/db": { db: { $transaction: async (operation) => operation(tx) } },
    "@/lib/employment-scope": {
      canActOnEmployment: () => true,
      employmentPrimaryKeyFilter: () => ({}),
      resolveEmploymentScope: async () => null
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({
        tenantId: "tenant-1",
        actorId: "talent-admin-1",
        role: "TALENT_ADMIN",
        employmentId: "admin-employment"
      }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized." }, { status: 401 })
    }
  });

  return { route, calls, updatedAt };
}

async function patch(route, body) {
  return route.PATCH(new Request("https://hrbp.example.test/api/succession/candidates/candidate-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }), { params: Promise.resolve({ id: "candidate-1" }) });
}

test("readiness change requires human reason and records reviewer provenance", async () => {
  const { route, calls, updatedAt } = fixture();
  const reason = "Evidence shows sustained readiness after completed development actions.";
  const response = await patch(route, {
    readiness: "READY_LT_1_YEAR",
    readinessReason: reason,
    expectedUpdatedAt: updatedAt.toISOString()
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].where, {
    id: "candidate-1",
    tenantId: "tenant-1",
    updatedAt
  });
  assert.equal(calls.updates[0].data.readiness, "READY_LT_1_YEAR");
  assert.equal(calls.updates[0].data.readinessReason, reason);
  assert.equal(calls.updates[0].data.readinessReviewedById, "talent-admin-1");
  assert.ok(calls.updates[0].data.readinessReviewedAt instanceof Date);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "succession-candidate.readiness-reviewed");
  assert.match(calls.audits[0].purpose, /previous=READY_1_2_YEARS; next=READY_LT_1_YEAR; reasonRecorded=true/);
  assert.doesNotMatch(calls.audits[0].purpose, /Evidence shows sustained readiness/);
});

test("readiness change fails closed without a meaningful reason", async () => {
  for (const reason of [undefined, "", "too short"]) {
    const { route, calls, updatedAt } = fixture();
    const response = await patch(route, {
      readiness: "READY_NOW",
      ...(reason === undefined ? {} : { readinessReason: reason }),
      expectedUpdatedAt: updatedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /requires a human decision reason of at least 12 characters/i);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.audits.length, 0);
  }
});

test("non-readiness candidate maintenance stays allowed but remains concurrency-safe", async () => {
  const { route, calls, updatedAt } = fixture();
  const response = await patch(route, {
    readiness: "READY_1_2_YEARS",
    rank: 2,
    developmentGap: "Expand enterprise architecture exposure.",
    expectedUpdatedAt: updatedAt.toISOString()
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].data.readinessReason, undefined);
  assert.equal(calls.updates[0].data.readinessReviewedById, undefined);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "succession-candidate.updated");
});

test("candidate updates reject stale request evidence and concurrent write races", async () => {
  {
    const { route, calls } = fixture();
    const response = await patch(route, {
      rank: 3,
      expectedUpdatedAt: "2026-10-12T11:59:59.000Z"
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed concurrently/i);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls, updatedAt } = fixture({ updateCount: 0 });
    const response = await patch(route, {
      rank: 3,
      expectedUpdatedAt: updatedAt.toISOString()
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed concurrently/i);
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.audits.length, 0);
  }
});

test("candidate decision and development text are rejected when oversized instead of silently truncated", async () => {
  {
    const { route, calls, updatedAt } = fixture();
    const response = await patch(route, {
      readiness: "READY_NOW",
      readinessReason: "x".repeat(2001),
      expectedUpdatedAt: updatedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /readinessReason must not exceed 2000/);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls, updatedAt } = fixture();
    const response = await patch(route, {
      developmentGap: "x".repeat(2001),
      expectedUpdatedAt: updatedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /developmentGap must not exceed 2000/);
    assert.equal(calls.updates.length, 0);
  }
});
