import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  }).outputText;
}

function loadPlain(path) {
  const module = { exports: {} };
  new Function("module", "exports", compile(path))(module, module.exports);
  return module.exports;
}

const validation = loadPlain("lib/input-validation.ts");

function loadRoute(path, mocks) {
  const module = { exports: {} };
  new Function("module", "exports", "require", compile(path))(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    throw new Error("Unexpected dependency " + name);
  });
  return module.exports;
}

const prisma = {
  DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
  EmploymentStatus: { TERMINATED: "TERMINATED", PREBOARDING: "PREBOARDING", ACTIVE: "ACTIVE" },
  LifecycleEventType: { HIRED: "HIRED" },
  PositionStatus: { OPEN: "OPEN", PLANNED: "PLANNED", FILLED: "FILLED" }
};

function peopleFixture() {
  const calls = {
    transactions: 0, personCreates: [], employmentCreates: [], positionUpdates: [],
    lifecycleCreates: [], onboardingCreates: [], audits: []
  };
  const tx = {
    position: {
      findFirst: async () => ({ id: "position-1", title: "Security Engineer", status: "OPEN", employments: [] }),
      update: async (input) => { calls.positionUpdates.push(input); return input; }
    },
    person: {
      findFirst: async () => null,
      create: async ({ data }) => { calls.personCreates.push(data); return { id: "person-1", ...data }; }
    },
    employment: {
      create: async ({ data }) => { calls.employmentCreates.push(data); return { id: "employment-1", ...data }; }
    },
    employeeLifecycleEvent: {
      create: async ({ data }) => { calls.lifecycleCreates.push(data); return { id: "life-1", ...data }; }
    },
    onboardingPlan: {
      create: async ({ data }) => { calls.onboardingCreates.push(data); return { id: "onboarding-1", ...data }; }
    }
  };
  const route = loadRoute("app/api/people/route.ts", {
    "@/lib/input-validation": validation,
    "@prisma/client": prisma,
    "@/lib/db": {
      db: {},
      withDb: async (operation) => {
        calls.transactions += 1;
        return operation({ $transaction: async (work) => work(tx) });
      }
    },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/employment-scope": {
      employmentPrimaryKeyFilter: () => ({}),
      resolveEmploymentScope: async () => null
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({ tenantId: "tenant-1", actorId: "hr-ops-1", role: "HR_OPERATIONS" }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized." }, { status: 401 })
    },
    "@/lib/audit": {
      appendAudit: async (_tx, _ctx, entry) => { calls.audits.push(entry); }
    },
    "@/lib/workforce-master-data-access": { canCreateEmployeeMasterRecord: () => true }
  });
  return { route, calls };
}

function positionFixture() {
  const calls = { transactions: 0, creates: [], audits: [] };
  const tx = {
    organizationUnit: { findFirst: async () => ({ id: "org-1" }) },
    position: {
      findFirst: async () => null,
      create: async ({ data }) => { calls.creates.push(data); return { id: "position-1", ...data }; }
    }
  };
  const route = loadRoute("app/api/positions/route.ts", {
    "@/lib/input-validation": validation,
    "@prisma/client": prisma,
    "@/lib/db": {
      db: {},
      withDb: async (operation) => {
        calls.transactions += 1;
        return operation({ $transaction: async (work) => work(tx) });
      }
    },
    "@/lib/authorization": {
      can: () => true,
      forbidden: (message = "Forbidden.") => Response.json({ error: message }, { status: 403 })
    },
    "@/lib/request-context": {
      getRequestContext: async () => ({ tenantId: "tenant-1", actorId: "hr-ops-1", role: "HR_OPERATIONS" }),
      mutationOriginAllowed: () => true,
      unauthorized: () => Response.json({ error: "Unauthorized." }, { status: 401 })
    },
    "@/lib/audit": {
      appendAudit: async (_tx, _ctx, entry) => { calls.audits.push(entry); }
    }
  });
  return { route, calls };
}

async function post(route, path, body) {
  return route.POST(new Request("https://hrbp.example.test" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hrbp.example.test" },
    body: JSON.stringify(body)
  }));
}

test("invalid employee master data is rejected before any database transaction", async () => {
  const cases = [
    { employeeNumber: "E-1", givenName: "Ada", familyName: "Example", workEmail: "bad email@example.com", positionId: "position-1", startDate: "2027-01-01" },
    { employeeNumber: "E-1", givenName: "Ada", familyName: "Example", workEmail: "ada@example.com", positionId: "position-1", startDate: "2026-02-31" },
    { employeeNumber: "x".repeat(65), givenName: "Ada", familyName: "Example", workEmail: "ada@example.com", positionId: "position-1", startDate: "2027-01-01" },
    { employeeNumber: "E-1", givenName: "x".repeat(101), familyName: "Example", workEmail: "ada@example.com", positionId: "position-1", startDate: "2027-01-01" }
  ];
  for (const body of cases) {
    const { route, calls } = peopleFixture();
    const response = await post(route, "/api/people", body);
    assert.equal(response.status, 400);
    assert.equal(calls.transactions, 0);
    assert.equal(calls.audits.length, 0);
  }
});

test("valid employee create normalizes identity fields and preserves atomic lifecycle writes", async () => {
  const { route, calls } = peopleFixture();
  const response = await post(route, "/api/people", {
    employeeNumber: " E-100 ",
    givenName: " Ada ",
    familyName: " Example ",
    workEmail: " ADA@Example.COM ",
    positionId: " position-1 ",
    startDate: "2099-02-28"
  });
  assert.equal(response.status, 201);
  assert.equal(calls.transactions, 1);
  assert.equal(calls.personCreates[0].employeeNumber, "E-100");
  assert.equal(calls.personCreates[0].givenName, "Ada");
  assert.equal(calls.personCreates[0].familyName, "Example");
  assert.equal(calls.personCreates[0].workEmail, "ada@example.com");
  assert.equal(calls.employmentCreates[0].positionId, "position-1");
  assert.equal(calls.employmentCreates[0].status, "PREBOARDING");
  assert.equal(calls.employmentCreates[0].startDate.toISOString(), "2099-02-28T00:00:00.000Z");
  assert.equal(calls.positionUpdates[0].data.status, "FILLED");
  assert.equal(calls.lifecycleCreates.length, 1);
  assert.equal(calls.onboardingCreates.length, 1);
  assert.equal(calls.audits.length, 2);
});

test("invalid position master data is rejected before any database transaction", async () => {
  const base = { positionCode: "SEC-004", title: "Security Engineer", orgUnitId: "org-1", status: "OPEN", critical: false };
  const cases = [
    { ...base, positionCode: "x".repeat(65) },
    { ...base, title: "x".repeat(161) },
    { ...base, jobFamily: "x".repeat(101) },
    { ...base, status: "CLOSED" },
    { ...base, critical: "true" }
  ];
  for (const body of cases) {
    const { route, calls } = positionFixture();
    const response = await post(route, "/api/positions", body);
    assert.equal(response.status, 400);
    assert.equal(calls.transactions, 0);
    assert.equal(calls.audits.length, 0);
  }
});

test("valid position create normalizes bounded fields and keeps audit inside the transaction", async () => {
  const { route, calls } = positionFixture();
  const response = await post(route, "/api/positions", {
    positionCode: " sec-004 ",
    title: " Senior Security Engineer ",
    orgUnitId: " org-1 ",
    jobFamily: " Security ",
    grade: " IC4 ",
    location: " Istanbul / Remote EU ",
    status: "planned",
    critical: true
  });
  assert.equal(response.status, 201);
  assert.equal(calls.transactions, 1);
  assert.equal(calls.creates[0].positionCode, "SEC-004");
  assert.equal(calls.creates[0].title, "Senior Security Engineer");
  assert.equal(calls.creates[0].orgUnitId, "org-1");
  assert.equal(calls.creates[0].jobFamily, "Security");
  assert.equal(calls.creates[0].grade, "IC4");
  assert.equal(calls.creates[0].location, "Istanbul / Remote EU");
  assert.equal(calls.creates[0].status, "PLANNED");
  assert.equal(calls.creates[0].critical, true);
  assert.equal(calls.audits.length, 1);
});
