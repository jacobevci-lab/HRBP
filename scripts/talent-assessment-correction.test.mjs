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

function fixture({ updateCount = 1 } = {}) {
  const calls = { updates: [], audits: [] };
  const assessedAt = new Date("2026-10-12T12:00:00.000Z");
  const assessment = {
    id: "assessment-1",
    employmentId: "employment-1",
    cycleLabel: "2026 Talent Review",
    performance: "MEETS",
    potential: "MODERATE",
    criticalTalent: false,
    assessedAt
  };
  const tx = {
    talentAssessment: {
      findFirst: async () => assessment,
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        return { count: updateCount };
      },
      findUnique: async () => ({ ...assessment, ...(calls.updates.at(-1)?.data ?? {}) })
    }
  };

  const route = load("app/api/talent/assessments/[id]/route.ts", {
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
  return { route, calls, assessedAt };
}

async function patch(route, body) {
  return route.PATCH(new Request("https://hrbp.example.test/api/talent/assessments/assessment-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }), { params: Promise.resolve({ id: "assessment-1" }) });
}

test("material talent correction requires reason and records human assessor provenance", async () => {
  const { route, calls, assessedAt } = fixture();
  const reason = "Validated succession evidence supports a higher potential assessment.";
  const response = await patch(route, {
    performance: "MEETS",
    potential: "HIGH",
    criticalTalent: true,
    correctionReason: reason,
    expectedAssessedAt: assessedAt.toISOString()
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].where, {
    id: "assessment-1",
    tenantId: "tenant-1",
    assessedAt
  });
  assert.equal(calls.updates[0].data.potential, "HIGH");
  assert.equal(calls.updates[0].data.criticalTalent, true);
  assert.equal(calls.updates[0].data.correctionReason, reason);
  assert.equal(calls.updates[0].data.assessedById, "talent-admin-1");
  assert.ok(calls.updates[0].data.assessedAt instanceof Date);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "talent-assessment.corrected");
  assert.match(calls.audits[0].purpose, /previous=MEETS\/MODERATE\/critical:false/);
  assert.match(calls.audits[0].purpose, /next=MEETS\/HIGH\/critical:true/);
  assert.match(calls.audits[0].purpose, /reasonRecorded=true/);
  assert.doesNotMatch(calls.audits[0].purpose, /Validated succession evidence/);
});

test("material talent decision change fails closed without a meaningful correction reason", async () => {
  for (const correctionReason of [undefined, "", "too short"]) {
    const { route, calls, assessedAt } = fixture();
    const response = await patch(route, {
      potential: "HIGH",
      ...(correctionReason === undefined ? {} : { correctionReason }),
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /requires a correction reason of at least 12 characters/i);
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.audits.length, 0);
  }
});

test("notes-only correction remains allowed without changing decision rationale", async () => {
  const { route, calls, assessedAt } = fixture();
  const response = await patch(route, {
    notes: "Updated supporting narrative only.",
    expectedAssessedAt: assessedAt.toISOString()
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].data.notes, "Updated supporting narrative only.");
  assert.equal(calls.updates[0].data.correctionReason, undefined);
  assert.equal(calls.audits.length, 1);
  assert.match(calls.audits[0].purpose, /decisionChanged=false; reasonRecorded=false/);
});

test("talent correction rejects stale request evidence and concurrent write races", async () => {
  {
    const { route, calls } = fixture();
    const response = await patch(route, {
      notes: "A valid notes-only update.",
      expectedAssessedAt: "2026-10-12T11:59:59.000Z"
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed concurrently/i);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls, assessedAt } = fixture({ updateCount: 0 });
    const response = await patch(route, {
      notes: "A valid notes-only update.",
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed concurrently/i);
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.audits.length, 0);
  }
});

test("talent correction rejects oversized text and non-boolean critical-talent input", async () => {
  {
    const { route, calls, assessedAt } = fixture();
    const response = await patch(route, {
      notes: "x".repeat(4001),
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /notes must not exceed 4000/);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls, assessedAt } = fixture();
    const response = await patch(route, {
      performance: "EXCEEDS",
      correctionReason: "This reason is long enough for validation.",
      criticalTalent: "false",
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /criticalTalent must be a boolean/);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls, assessedAt } = fixture();
    const response = await patch(route, {
      potential: "HIGH",
      correctionReason: "x".repeat(2001),
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /correctionReason must not exceed 2000/);
    assert.equal(calls.updates.length, 0);
  }
});
