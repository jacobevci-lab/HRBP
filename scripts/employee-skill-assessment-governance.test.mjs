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
  DataClassification: { CONFIDENTIAL: "CONFIDENTIAL", INTERNAL: "INTERNAL" },
  SkillProficiency: {
    AWARENESS: "AWARENESS",
    FOUNDATION: "FOUNDATION",
    PRACTITIONER: "PRACTITIONER",
    ADVANCED: "ADVANCED",
    EXPERT: "EXPERT"
  }
};

const inputValidation = {
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
};

function baseContextMocks(scopeAllowed = true) {
  return {
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
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
  };
}

function createFixture({ existing = null, createError = null, scopeAllowed = true } = {}) {
  const calls = { creates: [], audits: [] };
  const tx = {
    employment: { findFirst: async () => ({ id: "employment-1" }) },
    skill: {
      findFirst: async () => ({ id: "skill-1" }),
      create: async ({ data }) => ({ id: "skill-created", ...data })
    },
    employmentSkill: {
      findUnique: async () => existing,
      create: async ({ data }) => {
        if (createError) throw createError;
        calls.creates.push(data);
        return { id: "employment-skill-1", ...data };
      }
    }
  };
  const route = load("app/api/learning/skills/route.ts", {
    "@/lib/input-validation": inputValidation,
    "@prisma/client": prisma,
    "@/lib/db": { db: { $transaction: async (operation) => operation(tx), skill: { findMany: async () => [] } } },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); } },
    ...baseContextMocks(scopeAllowed)
  });
  return { route, calls };
}

async function postAssessment(route, body) {
  return route.POST(new Request("https://hrbp.example.test/api/learning/skills", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }));
}

test("initial employee skill assessment is create-only and reviewer-owned", async () => {
  const { route, calls } = createFixture();
  const response = await postAssessment(route, {
    employmentId: "employment-1",
    skillId: "skill-1",
    proficiency: "PRACTITIONER",
    source: "Manager review and certification evidence"
  });
  assert.equal(response.status, 201);
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.creates[0].assessedById, "talent-admin-1");
  assert.equal(calls.creates[0].proficiency, "PRACTITIONER");
  assert.equal(calls.creates[0].source, "Manager review and certification evidence");
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "employee-skill.assessed");
  assert.match(calls.audits[0].purpose, /proficiency=PRACTITIONER/);
  assert.doesNotMatch(calls.audits[0].purpose, /Manager review and certification evidence/);
});

test("existing employee-skill record cannot be overwritten through create endpoint", async () => {
  const { route, calls } = createFixture({ existing: { id: "employment-skill-existing" } });
  const response = await postAssessment(route, {
    employmentId: "employment-1",
    skillId: "skill-1",
    proficiency: "EXPERT"
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /governed reassessment workflow/i);
  assert.equal(calls.creates.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("concurrent duplicate employee-skill creation returns bounded conflict", async () => {
  const { route, calls } = createFixture({ createError: { code: "P2002" } });
  const response = await postAssessment(route, {
    employmentId: "employment-1",
    skillId: "skill-1",
    proficiency: "FOUNDATION"
  });
  assert.equal(response.status, 409);
  assert.equal(calls.audits.length, 0);
});

test("initial employee-skill assessment rejects oversized source and remains relationship scoped", async () => {
  {
    const { route, calls } = createFixture();
    const response = await postAssessment(route, {
      employmentId: "employment-1",
      skillId: "skill-1",
      proficiency: "FOUNDATION",
      source: "x".repeat(501)
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /source must not exceed 500/);
    assert.equal(calls.creates.length, 0);
  }
  {
    const { route, calls } = createFixture({ scopeAllowed: false });
    const response = await postAssessment(route, {
      employmentId: "employment-1",
      skillId: "skill-1",
      proficiency: "FOUNDATION"
    });
    assert.equal(response.status, 403);
    assert.equal(calls.creates.length, 0);
  }
});

function reassessFixture({ updateCount = 1, scopeAllowed = true } = {}) {
  const calls = { updates: [], audits: [] };
  const assessedAt = new Date("2026-10-13T08:00:00.000Z");
  const record = {
    id: "employment-skill-1",
    employmentId: "employment-1",
    proficiency: "FOUNDATION",
    source: "Initial manager review",
    assessedAt
  };
  const tx = {
    employmentSkill: {
      findFirst: async () => record,
      updateMany: async ({ where, data }) => {
        calls.updates.push({ where, data });
        return { count: updateCount };
      },
      findUnique: async () => ({ ...record, ...(calls.updates.at(-1)?.data ?? {}) })
    }
  };
  const route = load("app/api/learning/employment-skills/[id]/route.ts", {
    "@/lib/input-validation": inputValidation,
    "@prisma/client": prisma,
    "@/lib/db": { db: { $transaction: async (operation) => operation(tx) } },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, input) => { calls.audits.push(input); } },
    ...baseContextMocks(scopeAllowed)
  });
  return { route, calls, assessedAt };
}

async function patchAssessment(route, body) {
  return route.PATCH(new Request("https://hrbp.example.test/api/learning/employment-skills/employment-skill-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }), { params: Promise.resolve({ id: "employment-skill-1" }) });
}

test("proficiency change requires human reason and persists reviewer provenance", async () => {
  const { route, calls, assessedAt } = reassessFixture();
  const reason = "Observed production delivery and validated certification evidence.";
  const response = await patchAssessment(route, {
    proficiency: "PRACTITIONER",
    source: "Manager review and certification",
    assessmentReason: reason,
    expectedAssessedAt: assessedAt.toISOString()
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].where, {
    id: "employment-skill-1",
    tenantId: "tenant-1",
    assessedAt
  });
  assert.equal(calls.updates[0].data.proficiency, "PRACTITIONER");
  assert.equal(calls.updates[0].data.assessmentReason, reason);
  assert.equal(calls.updates[0].data.assessedById, "talent-admin-1");
  assert.ok(calls.updates[0].data.assessedAt instanceof Date);
  assert.equal(calls.audits.length, 1);
  assert.match(calls.audits[0].purpose, /previous=FOUNDATION; next=PRACTITIONER; changed=true; reasonRecorded=true/);
  assert.doesNotMatch(calls.audits[0].purpose, /Observed production delivery/);
});

test("proficiency change fails closed without meaningful reason", async () => {
  for (const assessmentReason of [undefined, "", "too short"]) {
    const { route, calls, assessedAt } = reassessFixture();
    const response = await patchAssessment(route, {
      proficiency: "ADVANCED",
      ...(assessmentReason === undefined ? {} : { assessmentReason }),
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /requires a human assessment reason of at least 12 characters/i);
    assert.equal(calls.updates.length, 0);
  }
});

test("source-only reassessment remains allowed but is concurrency safe", async () => {
  const { route, calls, assessedAt } = reassessFixture();
  const response = await patchAssessment(route, {
    source: "Updated certification registry evidence",
    expectedAssessedAt: assessedAt.toISOString()
  });
  assert.equal(response.status, 200);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].data.assessmentReason, undefined);
  assert.equal(calls.updates[0].data.assessedById, "talent-admin-1");
  assert.equal(calls.audits.length, 1);
  assert.match(calls.audits[0].purpose, /changed=false; reasonRecorded=false; sourceRecorded=true/);
});

test("stale and concurrent proficiency reassessments cannot overwrite newer decisions", async () => {
  {
    const { route, calls } = reassessFixture();
    const response = await patchAssessment(route, {
      source: "Updated evidence",
      expectedAssessedAt: "2026-10-13T07:59:59.000Z"
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed concurrently/i);
    assert.equal(calls.updates.length, 0);
  }
  {
    const { route, calls, assessedAt } = reassessFixture({ updateCount: 0 });
    const response = await patchAssessment(route, {
      source: "Updated evidence",
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 409);
    assert.equal(calls.updates.length, 1);
    assert.equal(calls.audits.length, 0);
  }
});

test("proficiency reassessment rejects oversized source and rationale", async () => {
  const { route, calls, assessedAt } = reassessFixture();
  {
    const response = await patchAssessment(route, {
      source: "x".repeat(501),
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /source must not exceed 500/);
  }
  {
    const response = await patchAssessment(route, {
      proficiency: "PRACTITIONER",
      assessmentReason: "x".repeat(2001),
      expectedAssessedAt: assessedAt.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /assessmentReason must not exceed 2000/);
  }
  assert.equal(calls.updates.length, 0);
});
