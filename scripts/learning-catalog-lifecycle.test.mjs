import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, name => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency: " + name);
  });
  return module.exports;
}

const input = {
  asIdentifier: value => typeof value === "string" && value.trim().length <= 191 ? value.trim() || null : null,
  asText: (value, max) => typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null,
  asOptionalText: (value, max) => value === undefined || value === null || value === "" ? undefined :
    typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null,
  readJsonObject: async request => {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
};

function fixture({ stale = false, updateCount = 1, duplicateCreate = false } = {}) {
  const stamp = new Date("2026-10-13T08:00:00.000Z");
  const calls = { skillUpdates: [], courseUpdates: [], courseCreates: [], courseReads: [], audit: [] };
  const skill = {
    findFirst: async () => ({ id: "skill-1", active: true, updatedAt: stamp }),
    updateMany: async payload => {
      calls.skillUpdates.push(payload);
      return { count: updateCount };
    },
    findUnique: async () => ({
      id: "skill-1", active: calls.skillUpdates.at(-1)?.data.active ?? true
    })
  };
  const course = {
    findFirst: async () => ({ id: "course-1", active: true, updatedAt: stamp }),
    updateMany: async payload => {
      calls.courseUpdates.push(payload);
      return { count: updateCount };
    },
    findUnique: async () => ({
      id: "course-1", active: calls.courseUpdates.at(-1)?.data.active ?? true
    }),
    create: async ({ data }) => {
      if (duplicateCreate) throw { code: "P2002" };
      calls.courseCreates.push(data);
      return { id: "course-1", ...data };
    },
    findMany: async payload => {
      calls.courseReads.push(payload);
      return [{ id: "course-1", active: true }];
    }
  };
  const db = { skill, learningCourse: course, $transaction: async work => work({ skill, learningCourse: course }) };
  const mocks = {
    "@/lib/input-validation": input,
    "@prisma/client": { DataClassification: { INTERNAL: "INTERNAL" } },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, event) => { calls.audit.push(event); } },
    "@/lib/authorization": { can: () => true, forbidden: () => Response.json({ error: "Forbidden" }, { status: 403 }) },
    "@/lib/db": { db },
    "@/lib/employment-scope": { employmentIdFilter: () => ({}), resolveEmploymentScope: async () => null },
    "@/lib/request-context": {
      getRequestContext: async () => ({ tenantId: "tenant-1", actorId: "admin-1", role: "TALENT_ADMIN" }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  };
  const skillRoute = load("app/api/learning/skills/[id]/route.ts", mocks);
  const courseRoute = load("app/api/learning/courses/[id]/route.ts", mocks);
  const courseCatalog = load("app/api/learning/courses/route.ts", mocks);
  async function patch(route, id, payload) {
    return route.PATCH(new Request("https://hrbp.invalid/api/learning/catalog", {
      method: "PATCH", headers: { origin: "https://hrbp.invalid", "content-type": "application/json" },
      body: JSON.stringify(payload)
    }), { params: Promise.resolve({ id }) });
  }
  async function post(payload) {
    return courseCatalog.POST(new Request("https://hrbp.invalid/api/learning/courses", {
      method: "POST", headers: { origin: "https://hrbp.invalid", "content-type": "application/json" },
      body: JSON.stringify(payload)
    }));
  }
  return { skillRoute, courseRoute, courseCatalog, calls, stamp, patch, post };
}

test("skill deactivation is scoped, concurrency-safe and audited", async () => {
  const f = fixture();
  const response = await f.patch(f.skillRoute, "skill-1", {
    active: false, expectedUpdatedAt: f.stamp.toISOString()
  });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.skillUpdates[0].where, {
    id: "skill-1", tenantId: "tenant-1", updatedAt: f.stamp
  });
  assert.equal(f.calls.skillUpdates[0].data.active, false);
  assert.equal(f.calls.audit[0].action, "skill.deactivated");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("skill update rejects coerced booleans, oversize text and stale versions", async () => {
  for (const [input, expected] of [
    [{ active: "false" }, /active must be a boolean/],
    [{ critical: "false" }, /critical must be a boolean/],
    [{ name: "x".repeat(181) }, /name must be/],
    [{ category: "x".repeat(121) }, /category must not exceed/],
    [{ active: false, expectedUpdatedAt: "2026-10-12T08:00:00.000Z" }, /changed concurrently/]
  ]) {
    const f = fixture();
    const response = await f.patch(f.skillRoute, "skill-1", {
      ...input, expectedUpdatedAt: input.expectedUpdatedAt ?? f.stamp.toISOString()
    });
    assert.equal(response.status, expected.source.includes("concurrently") ? 409 : 400);
    assert.match((await response.json()).error, expected);
    assert.equal(f.calls.skillUpdates.length, 0);
    assert.equal(f.calls.audit.length, 0);
  }
});

test("skill update detects a write race without emitting audit evidence", async () => {
  const f = fixture({ updateCount: 0 });
  const response = await f.patch(f.skillRoute, "skill-1", {
    name: "Network Architecture", expectedUpdatedAt: f.stamp.toISOString()
  });
  assert.equal(response.status, 409);
  assert.equal(f.calls.audit.length, 0);
});

test("course update rejects boolean coercion, oversized attributes and invalid validity", async () => {
  for (const [field, value, error] of [
    ["mandatory", "false", /mandatory must be a boolean/],
    ["active", 0, /active must be a boolean/],
    ["title", "x".repeat(251), /title must be/],
    ["provider", "x".repeat(251), /provider must not exceed/],
    ["validityMonths", 121, /validityMonths must be/],
    ["validityMonths", "1e2", /validityMonths must be/]
  ]) {
    const f = fixture();
    const response = await f.patch(f.courseRoute, "course-1", {
      [field]: value, expectedUpdatedAt: f.stamp.toISOString()
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, error);
    assert.equal(f.calls.courseUpdates.length, 0);
  }
});

test("course reconfiguration uses versioned update and lifecycle audit", async () => {
  const f = fixture();
  const response = await f.patch(f.courseRoute, "course-1", {
    active: false, mandatory: false, validityMonths: "12",
    provider: "Internal", expectedUpdatedAt: f.stamp.toISOString()
  });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.courseUpdates[0].where, {
    id: "course-1", tenantId: "tenant-1", updatedAt: f.stamp
  });
  assert.equal(f.calls.courseUpdates[0].data.mandatory, false);
  assert.equal(f.calls.courseUpdates[0].data.validityMonths, 12);
  assert.equal(f.calls.audit[0].action, "learning-course.deactivated");
});

test("course update rejects a concurrent catalog write with no audit", async () => {
  const f = fixture({ updateCount: 0 });
  const response = await f.patch(f.courseRoute, "course-1", {
    title: "Revised Security Training", expectedUpdatedAt: f.stamp.toISOString()
  });
  assert.equal(response.status, 409);
  assert.equal(f.calls.audit.length, 0);
});

test("course creation normalizes bounded inputs and rejects ambiguous attributes", async () => {
  const f = fixture();
  const response = await f.post({
    code: " secure-101 ", title: "Secure Development", mandatory: false,
    provider: "Internal", validityMonths: "12"
  });
  assert.equal(response.status, 201);
  assert.deepEqual(f.calls.courseCreates[0], {
    tenantId: "tenant-1", code: "SECURE-101", title: "Secure Development",
    provider: "Internal", mandatory: false, validityMonths: 12
  });
  assert.equal(f.calls.audit[0].action, "learning-course.created");

  for (const [payload, pattern] of [
    [{ code: "COURSE", title: "Course", mandatory: "false" }, /mandatory must be/],
    [{ code: "COURSE", title: "Course", validityMonths: 500 }, /validityMonths must be/],
    [{ code: "COURSE", title: "x".repeat(251) }, /title must be/],
    [{ code: "BAD CODE", title: "Course" }, /code must be/]
  ]) {
    const x = fixture();
    const failure = await x.post(payload);
    assert.equal(failure.status, 400);
    assert.match((await failure.json()).error, pattern);
    assert.equal(x.calls.courseCreates.length, 0);
  }
});

test("duplicate course creation is a bounded conflict", async () => {
  const f = fixture({ duplicateCreate: true });
  const response = await f.post({ code: "CLOUD", title: "Cloud Security" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already exists/);
  assert.equal(f.calls.audit.length, 0);
});

test("active course catalog GET remains tenant scoped, bounded and uncached", async () => {
  const f = fixture();
  const response = await f.courseCatalog.GET(new Request("https://hrbp.invalid/api/learning/courses"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.calls.courseReads[0].take, 300);
  assert.deepEqual(f.calls.courseReads[0].where, { tenantId: "tenant-1", active: true });
});
