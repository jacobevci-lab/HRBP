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
  PotentialBand: {
    LIMITED: "LIMITED",
    MODERATE: "MODERATE",
    HIGH: "HIGH"
  }
};

function fixture({ existing = null, scopeAllowed = true, createError = null } = {}) {
  const calls = { creates: [], audits: [], existingLookups: 0 };
  const tx = {
    employment: {
      findFirst: async () => ({ id: "employment-1" })
    },
    talentAssessment: {
      findUnique: async () => {
        calls.existingLookups += 1;
        return existing;
      },
      create: async ({ data }) => {
        if (createError) throw createError;
        calls.creates.push(data);
        return { id: "assessment-1", ...data, assessedAt: new Date("2026-10-13T08:00:00.000Z") };
      }
    }
  };

  const route = load("app/api/talent/assessments/route.ts", {
    "@/lib/input-validation": {
      asIdentifier: (value) => typeof value === "string" && value.trim() && value.trim().length <= 191 ? value.trim() : null,
      asText: (value, max) => typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null,
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
    "@/lib/db": { db: { $transaction: async (operation) => operation(tx) } },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/audit": {
      appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); }
    },
    "@/lib/employment-scope": {
      canActOnEmployment: () => scopeAllowed,
      employmentIdFilter: () => ({}),
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

async function post(route, body) {
  return route.POST(new Request("https://hrbp.example.test/api/talent/assessments", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }));
}

test("initial talent assessment is create-only, human-owned and audit logged", async () => {
  const { route, calls } = fixture();
  const response = await post(route, {
    employmentId: "employment-1",
    cycleLabel: "FY27 Talent Review",
    performance: "MEETS",
    potential: "HIGH",
    criticalTalent: true,
    notes: "Evidence discussed in the human talent review."
  });
  assert.equal(response.status, 201);
  assert.equal(calls.existingLookups, 1);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].assessedById, "talent-admin-1");
  assert.equal(calls.creates[0].criticalTalent, true);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "talent-assessment.recorded");
  assert.match(calls.audits[0].purpose, /cycle=FY27 Talent Review/);
  assert.match(calls.audits[0].purpose, /performance=MEETS/);
  assert.match(calls.audits[0].purpose, /potential=HIGH/);
  assert.doesNotMatch(calls.audits[0].purpose, /Evidence discussed/);
});

test("existing employee-cycle assessment cannot be overwritten through create endpoint", async () => {
  const { route, calls } = fixture({ existing: { id: "assessment-existing" } });
  const response = await post(route, {
    employmentId: "employment-1",
    cycleLabel: "FY27 Talent Review",
    performance: "EXCEEDS",
    potential: "HIGH",
    criticalTalent: true
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /governed correction workflow/i);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("concurrent duplicate insert is converted to bounded correction conflict", async () => {
  const error = { code: "P2002" };
  const { route, calls } = fixture({ createError: error });
  const response = await post(route, {
    employmentId: "employment-1",
    cycleLabel: "FY27 Talent Review",
    performance: "MEETS",
    potential: "MODERATE",
    criticalTalent: false
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already exists/i);
  assert.equal(calls.audits.length, 0);
});

test("talent creation rejects oversized or weakly typed inputs instead of coercing them", async () => {
  const cases = [
    {
      body: { employmentId: "employment-1", cycleLabel: "x".repeat(161), performance: "MEETS", potential: "MODERATE" },
      pattern: /cycleLabel up to 160/i
    },
    {
      body: { employmentId: "employment-1", cycleLabel: "FY27", performance: "MEETS", potential: "MODERATE", notes: "x".repeat(4001) },
      pattern: /notes must not exceed 4000/i
    },
    {
      body: { employmentId: "employment-1", cycleLabel: "FY27", performance: "MEETS", potential: "MODERATE", criticalTalent: "false" },
      pattern: /criticalTalent must be a boolean/i
    }
  ];
  for (const entry of cases) {
    const { route, calls } = fixture();
    const response = await post(route, entry.body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, entry.pattern);
    assert.equal(calls.creates.length, 0);
  }
});

test("talent creation remains relationship scoped", async () => {
  const { route, calls } = fixture({ scopeAllowed: false });
  const response = await post(route, {
    employmentId: "employment-1",
    cycleLabel: "FY27",
    performance: "MEETS",
    potential: "MODERATE"
  });
  assert.equal(response.status, 403);
  assert.equal(calls.creates.length, 0);
});
