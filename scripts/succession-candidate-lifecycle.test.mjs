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

const inputValidation = {
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
};

function detailFixture({
  active = true,
  updateCount = 1,
  currentReadiness = "READY_1_2_YEARS"
} = {}) {
  const calls = { updates: [], audits: [], deletes: 0 };
  const updatedAt = new Date("2026-10-12T13:00:00.000Z");
  const candidate = {
    id: "candidate-1",
    planId: "plan-1",
    employmentId: "employment-1",
    readiness: currentReadiness,
    active,
    updatedAt,
    plan: { positionId: "position-1", active: true }
  };
  const tx = {
    successionCandidate: {
      findFirst: async ({ where }) => {
        if (Object.prototype.hasOwnProperty.call(where, "rank")) return null;
        return candidate;
      },
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        return { count: updateCount };
      },
      findUnique: async () => ({ ...candidate, ...(calls.updates.at(-1)?.data ?? {}) }),
      delete: async () => {
        calls.deletes += 1;
        throw new Error("HARD_DELETE_CALLED");
      }
    },
    employment: { findFirst: async () => ({ id: "employment-1" }) }
  };

  const route = load("app/api/succession/candidates/[id]/route.ts", {
    "@/lib/input-validation": inputValidation,
    "@prisma/client": prisma,
    "@/lib/audit": { appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); } },
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

async function remove(route, body) {
  return route.DELETE(new Request("https://hrbp.example.test/api/succession/candidates/candidate-1", {
    method: "DELETE",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }), { params: Promise.resolve({ id: "candidate-1" }) });
}

test("candidate removal preserves history and records bounded removal provenance", async () => {
  const { route, calls, updatedAt } = detailFixture();
  const reason = "Role coverage strategy changed after the latest workforce review.";
  const response = await remove(route, {
    removalReason: reason,
    expectedUpdatedAt: updatedAt.toISOString()
  });
  assert.equal(response.status, 200);
  assert.equal(calls.deletes, 0);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].where, {
    id: "candidate-1",
    tenantId: "tenant-1",
    active: true,
    updatedAt
  });
  assert.equal(calls.updates[0].data.active, false);
  assert.equal(calls.updates[0].data.removedById, "talent-admin-1");
  assert.equal(calls.updates[0].data.removalReason, reason);
  assert.ok(calls.updates[0].data.removedAt instanceof Date);
  assert.equal(calls.updates[0].data.rank, null);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "succession-candidate.removed");
  assert.match(calls.audits[0].purpose, /historyPreserved=true/);
  assert.doesNotMatch(calls.audits[0].purpose, /Role coverage strategy changed/);
});

test("candidate removal requires reason and optimistic concurrency evidence", async () => {
  const { route, calls, updatedAt } = detailFixture();
  for (const body of [
    { expectedUpdatedAt: updatedAt.toISOString() },
    { removalReason: "too short", expectedUpdatedAt: updatedAt.toISOString() },
    { removalReason: "A sufficiently long removal rationale." }
  ]) {
    const response = await remove(route, body);
    assert.equal(response.status, 400);
  }
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.deletes, 0);
});

test("removed candidates are immutable and stale removal cannot overwrite newer governance", async () => {
  {
    const { route, calls, updatedAt } = detailFixture({ active: false });
    const response = await route.PATCH(new Request("https://hrbp.example.test/api/succession/candidates/candidate-1", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
      body: JSON.stringify({ rank: 2, expectedUpdatedAt: updatedAt.toISOString() })
    }), { params: Promise.resolve({ id: "candidate-1" }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /read-only until explicitly reactivated/i);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls, updatedAt } = detailFixture({ updateCount: 0 });
    const response = await remove(route, {
      removalReason: "A valid removal reason that loses a concurrent race.",
      expectedUpdatedAt: updatedAt.toISOString()
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed concurrently/i);
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.audits.length, 0);
    assert.equal(calls.deletes, 0);
  }
});

function createFixture({ existingActive = false } = {}) {
  const calls = { upserts: [], audits: [], rankWhere: null };
  const existing = { id: "candidate-1", active: existingActive, updatedAt: new Date("2026-10-12T12:00:00.000Z") };
  const tx = {
    successionPlan: {
      findFirst: async () => ({ id: "plan-1", positionId: "position-1", active: true })
    },
    employment: {
      findFirst: async ({ where }) => where.positionId ? ({ id: "manager-scope-1" }) : ({ id: "employment-1" })
    },
    successionCandidate: {
      findUnique: async () => existing,
      findFirst: async ({ where }) => {
        calls.rankWhere = where;
        return null;
      },
      upsert: async (input) => {
        calls.upserts.push(input);
        return { id: "candidate-1", ...input.update };
      }
    }
  };
  const route = load("app/api/succession/candidates/route.ts", {
    "@/lib/input-validation": inputValidation,
    "@prisma/client": prisma,
    "@/lib/db": { db: { $transaction: async (operation) => operation(tx) } },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); } },
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
  return { route, calls };
}

async function create(route, body) {
  return route.POST(new Request("https://hrbp.example.test/api/succession/candidates", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }));
}

test("re-adding a removed candidate reactivates the same record and clears removal state", async () => {
  const { route, calls } = createFixture({ existingActive: false });
  const response = await create(route, {
    planId: "plan-1",
    employmentId: "employment-1",
    readiness: "READY_1_2_YEARS",
    readinessReason: "Reactivated after the successor pool was formally reassessed.",
    rank: 2,
    developmentGap: "Broaden cross-functional leadership exposure."
  });
  assert.equal(response.status, 201);
  assert.equal(calls.upserts.length, 1);
  const update = calls.upserts[0].update;
  assert.equal(update.active, true);
  assert.equal(update.removedAt, null);
  assert.equal(update.removedById, null);
  assert.equal(update.removalReason, null);
  assert.equal(update.readinessReviewedById, "talent-admin-1");
  assert.ok(update.readinessReviewedAt instanceof Date);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "succession-candidate.reactivated");
  assert.equal(calls.rankWhere.active, true);
});

test("candidate addition requires bounded human readiness rationale", async () => {
  const { route, calls } = createFixture({ existingActive: false });
  const response = await create(route, {
    planId: "plan-1",
    employmentId: "employment-1",
    readiness: "READY_1_2_YEARS",
    readinessReason: "short",
    rank: null
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /readiness reason of at least 12 characters/i);
  assert.equal(calls.upserts.length, 0);
});
