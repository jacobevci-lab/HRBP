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

function futureIso(days = 60) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function fixture({ existing = null, scope = null, scopedIncumbent = { id: "employment-1" }, createError = null } = {}) {
  const calls = { creates: [], audits: [], existingLookups: 0, scopeLookups: 0 };
  const tx = {
    position: {
      findFirst: async () => ({ id: "position-1" })
    },
    employment: {
      findFirst: async () => {
        calls.scopeLookups += 1;
        return scopedIncumbent;
      }
    },
    successionPlan: {
      findUnique: async () => {
        calls.existingLookups += 1;
        return existing;
      },
      create: async ({ data }) => {
        if (createError) throw createError;
        calls.creates.push(data);
        return { id: "plan-1", ...data };
      }
    }
  };

  const route = load("app/api/succession/plans/route.ts", {
    "@/lib/input-validation": {
      asIdentifier: (value) => typeof value === "string" && value.trim() && value.trim().length <= 191 ? value.trim() : null,
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
    "@prisma/client": {
      DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
      EmploymentStatus: { TERMINATED: "TERMINATED" }
    },
    "@/lib/db": { db: { $transaction: async (operation) => operation(tx) } },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/audit": {
      appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); }
    },
    "@/lib/employment-scope": {
      employmentIdFilter: () => ({}),
      employmentPrimaryKeyFilter: () => ({}),
      resolveEmploymentScope: async () => scope
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

async function post(route, body) {
  return route.POST(new Request("https://hrbp.example.test/api/succession/plans", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }));
}

test("succession plan creation is create-only, owner-bound and review-bound", async () => {
  const { route, calls } = fixture();
  const response = await post(route, {
    positionId: "position-1",
    name: "VP Engineering continuity",
    reviewDueAt: futureIso(90)
  });
  assert.equal(response.status, 201);
  assert.equal(calls.existingLookups, 1);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].tenantId, "tenant-1");
  assert.equal(calls.creates[0].positionId, "position-1");
  assert.equal(calls.creates[0].ownerId, "talent-admin-1");
  assert.equal(calls.creates[0].active, true);
  assert.ok(calls.creates[0].reviewDueAt instanceof Date);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "succession-plan.created");
  assert.match(calls.audits[0].purpose, /Human-owned succession plan created/);
});

test("existing position plan cannot be recreated or silently reactivated through create endpoint", async () => {
  const { route, calls } = fixture({ existing: { id: "plan-existing" } });
  const response = await post(route, {
    positionId: "position-1",
    name: "Replacement plan",
    reviewDueAt: futureIso(60)
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /governed plan maintenance and review workflow/i);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("concurrent duplicate creation returns the same bounded conflict", async () => {
  const { route, calls } = fixture({ createError: { code: "P2002" } });
  const response = await post(route, {
    positionId: "position-1",
    reviewDueAt: futureIso(60)
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already exists/i);
  assert.equal(calls.audits.length, 0);
});

test("succession plan creation requires bounded name and future review date within two years", async () => {
  const cases = [
    { body: { positionId: "position-1", reviewDueAt: "" }, pattern: /future date within 730 days/i },
    { body: { positionId: "position-1", reviewDueAt: new Date(Date.now() - 60_000).toISOString() }, pattern: /future date within 730 days/i },
    { body: { positionId: "position-1", reviewDueAt: futureIso(731) }, pattern: /future date within 730 days/i },
    { body: { positionId: "position-1", name: "x".repeat(181), reviewDueAt: futureIso(60) }, pattern: /name must not exceed 180/i }
  ];
  for (const entry of cases) {
    const { route, calls } = fixture();
    const response = await post(route, entry.body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, entry.pattern);
    assert.equal(calls.creates.length, 0);
  }
});

test("succession plan creation remains relationship scoped", async () => {
  const { route, calls } = fixture({ scope: { mode: "SCOPED" }, scopedIncumbent: null });
  const response = await post(route, {
    positionId: "position-1",
    reviewDueAt: futureIso(60)
  });
  assert.equal(response.status, 403);
  assert.equal(calls.scopeLookups, 1);
  assert.equal(calls.creates.length, 0);
});
