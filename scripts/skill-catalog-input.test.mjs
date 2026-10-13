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

const validatedText = (value, max) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
};
function fixture({ createError = null } = {}) {
  const calls = { creates: [], audits: [], reads: [] };
  const skills = {
    create: async ({ data }) => {
      if (createError) throw createError;
      calls.creates.push(data);
      return { id: "skill-1", ...data };
    },
    findMany: async (options) => {
      calls.reads.push(options);
      return [{ id: "skill-1", code: "CLOUD", active: true }];
    }
  };
  const route = load("app/api/learning/skills/route.ts", {
    "@/lib/input-validation": {
      asIdentifier: (value) => validatedText(value, 191),
      asOptionalText: (value, max) => {
        if (value === undefined || value === null || value === "") return undefined;
        return validatedText(value, max);
      },
      asText: validatedText,
      readJsonObject: async (request) => {
        const parsed = await request.json();
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      }
    },
    "@prisma/client": {
      DataClassification: { INTERNAL: "INTERNAL", CONFIDENTIAL: "CONFIDENTIAL" },
      SkillProficiency: {
        AWARENESS: "AWARENESS", FOUNDATION: "FOUNDATION",
        PRACTITIONER: "PRACTITIONER", ADVANCED: "ADVANCED", EXPERT: "EXPERT"
      }
    },
    "@/lib/db": { db: { skill: skills, $transaction: async (operation) => operation({ skill: skills }) } },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/audit": { appendAudit: async (_tx, _ctx, input) => calls.audits.push(input) },
    "@/lib/employment-scope": {
      canActOnEmployment: () => true,
      employmentIdFilter: () => ({}),
      resolveEmploymentScope: async () => null
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({
        tenantId: "tenant-1", actorId: "talent-admin-1",
        role: "TALENT_ADMIN", employmentId: "employment-admin"
      }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized." }, { status: 401 })
    }
  });
  return { route, calls };
}

async function post(route, value) {
  return route.POST(new Request("https://hrbp.example.test/api/learning/skills", {
    method: "POST",
    headers: { origin: "https://hrbp.example.test", "content-type": "application/json" },
    body: JSON.stringify(value)
  }));
}

test("new catalog skill is normalized, tenant-scoped and audit-traced", async () => {
  const { route, calls } = fixture();
  const response = await post(route, {
    code: " cloud-security ", name: "Cloud Security", category: "Infrastructure", critical: false
  });
  assert.equal(response.status, 201);
  assert.equal(calls.creates.length, 1);
  assert.deepEqual(calls.creates[0], {
    tenantId: "tenant-1", code: "CLOUD-SECURITY", name: "Cloud Security",
    category: "Infrastructure", critical: false
  });
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].action, "skill.created");
});

test("catalog creation rejects ambiguous booleans and unbounded attributes without mutation", async () => {
  for (const [value, error] of [
    [{ code: "CLOUD", name: "Cloud", critical: "false" }, /critical must be a boolean/],
    [{ code: "CLOUD", name: "Cloud", critical: 0 }, /critical must be a boolean/],
    [{ code: "BAD CODE", name: "Cloud", critical: true }, /code must be/],
    [{ code: "x".repeat(65), name: "Cloud" }, /code must be/],
    [{ code: "CLOUD", name: "x".repeat(181) }, /name must be/],
    [{ code: "CLOUD", name: "Cloud", category: "x".repeat(121) }, /category must not exceed 120/],
    [{ code: "CLOUD", name: { unsafe: true } }, /name must be/]
  ]) {
    const { route, calls } = fixture();
    const response = await post(route, value);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, error);
    assert.equal(calls.creates.length, 0);
    assert.equal(calls.audits.length, 0);
  }
});

test("concurrent duplicate catalog skill creation yields bounded conflict without audit evidence", async () => {
  const { route, calls } = fixture({ createError: { code: "P2002" } });
  const response = await post(route, { code: "CLOUD", name: "Cloud" });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already exists in the tenant/);
  assert.equal(calls.audits.length, 0);
});

test("catalog list is tenant-scoped, limited to active skills and never cached", async () => {
  const { route, calls } = fixture();
  const response = await route.GET(new Request("https://hrbp.example.test/api/learning/skills"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.reads.length, 1);
  assert.deepEqual(calls.reads[0].where, { tenantId: "tenant-1", active: true });
  assert.equal(calls.reads[0].take, 300);
  assert.equal((await response.json()).data.length, 1);
});
