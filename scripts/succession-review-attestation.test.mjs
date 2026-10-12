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

function fixture({
  active = true,
  updateCount = 1,
  scope = null,
  scopedIncumbent = { id: "employment-1" }
} = {}) {
  const calls = { updates: [], audits: [], employmentLookups: 0 };
  const updatedAt = new Date("2026-10-12T09:00:00.000Z");
  const tx = {
    successionPlan: {
      findFirst: async () => ({
        id: "plan-1",
        positionId: "position-1",
        active,
        updatedAt,
        _count: { candidates: 3 }
      }),
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        return { count: updateCount };
      },
      findUnique: async () => ({
        id: "plan-1",
        tenantId: "tenant-1",
        positionId: "position-1",
        active: true,
        updatedAt: new Date(),
        ...(calls.updates.at(-1)?.data ?? {})
      })
    },
    employment: {
      findFirst: async () => {
        calls.employmentLookups += 1;
        return scopedIncumbent;
      }
    }
  };

  const route = load("app/api/succession/plans/[id]/review/route.ts", {
    "@prisma/client": {
      DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
      EmploymentStatus: { TERMINATED: "TERMINATED" }
    },
    "@/lib/audit": {
      appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); }
    },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/db": {
      db: { $transaction: async (operation) => operation(tx) }
    },
    "@/lib/employment-scope": {
      employmentPrimaryKeyFilter: () => ({ id: { in: ["employment-1"] } }),
      resolveEmploymentScope: async () => scope
    },
    "@/lib/input-validation": {
      asIdentifier: (value) => typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : null,
      asText: (value, max) => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed && trimmed.length <= max ? trimmed : null;
      },
      readJsonObject: async (request) => {
        const value = await request.json();
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
      }
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

function futureIso(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function submit(route, body) {
  return route.POST(new Request("https://hrbp.example.test/api/succession/plans/plan-1/review", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }), { params: Promise.resolve({ id: "plan-1" }) });
}

test("succession review attestation records reviewer, timestamp, next review and bounded audit evidence", async () => {
  const { route, calls, updatedAt } = fixture();
  const summary = "Reviewed all successor candidates and refreshed readiness evidence.";
  const response = await submit(route, {
    summary,
    expectedUpdatedAt: updatedAt.toISOString(),
    nextReviewDueAt: futureIso(45)
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].where, {
    id: "plan-1",
    tenantId: "tenant-1",
    active: true,
    updatedAt
  });
  assert.equal(calls.updates[0].data.lastReviewedById, "talent-admin-1");
  assert.equal(calls.updates[0].data.lastReviewSummary, summary);
  assert.ok(calls.updates[0].data.lastReviewedAt instanceof Date);
  assert.ok(calls.updates[0].data.reviewDueAt instanceof Date);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "succession-plan.review-attested");
  assert.match(calls.audits[0].purpose, /candidates=3/);
  assert.match(calls.audits[0].purpose, /summaryRecorded=true/);
  assert.doesNotMatch(calls.audits[0].purpose, /Reviewed all successor candidates/);
});

test("succession review requires a meaningful bounded summary and future review date", async () => {
  const { route, calls, updatedAt } = fixture();
  for (const body of [
    { summary: "too short", expectedUpdatedAt: updatedAt.toISOString(), nextReviewDueAt: futureIso(30) },
    { summary: "x".repeat(2001), expectedUpdatedAt: updatedAt.toISOString(), nextReviewDueAt: futureIso(30) },
    { summary: "Valid succession review summary.", expectedUpdatedAt: updatedAt.toISOString(), nextReviewDueAt: new Date(Date.now() - 60_000).toISOString() },
    { summary: "Valid succession review summary.", expectedUpdatedAt: updatedAt.toISOString(), nextReviewDueAt: futureIso(731) }
  ]) {
    const response = await submit(route, body);
    assert.equal(response.status, 400);
  }
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("succession review rejects inactive and stale plans", async () => {
  {
    const { route, calls, updatedAt } = fixture({ active: false });
    const response = await submit(route, {
      summary: "Valid human review summary for inactive plan.",
      expectedUpdatedAt: updatedAt.toISOString(),
      nextReviewDueAt: futureIso(30)
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Inactive succession plans/);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls } = fixture();
    const response = await submit(route, {
      summary: "Valid human review summary for stale plan.",
      expectedUpdatedAt: "2026-10-11T09:00:00.000Z",
      nextReviewDueAt: futureIso(30)
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed concurrently/);
    assert.equal(calls.updates.length, 0);
  }
});

test("succession review uses optimistic state evidence to prevent concurrent overwrite", async () => {
  const { route, calls, updatedAt } = fixture({ updateCount: 0 });
  const response = await submit(route, {
    summary: "Valid review summary that loses a concurrency race.",
    expectedUpdatedAt: updatedAt.toISOString(),
    nextReviewDueAt: futureIso(30)
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed concurrently/);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.audits.length, 0);
});

test("relationship-scoped reviewer cannot attest a succession plan outside authorized scope", async () => {
  const { route, calls, updatedAt } = fixture({ scope: { mode: "SCOPED" }, scopedIncumbent: null });
  const response = await submit(route, {
    summary: "Valid review summary outside authorized scope.",
    expectedUpdatedAt: updatedAt.toISOString(),
    nextReviewDueAt: futureIso(30)
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /outside your authorized relationship scope/);
  assert.equal(calls.employmentLookups, 1);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.audits.length, 0);
});
