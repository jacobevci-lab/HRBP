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
const privateResponse = loadPlain("lib/private-json.ts");

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
  PositionStatus: { OPEN: "OPEN", PLANNED: "PLANNED", FILLED: "FILLED" },
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } }
};

function peopleFixture({ positionStatus = "OPEN", claimCount = 1, transactionError = null } = {}) {
  const calls = {
    transactions: 0, transactionOptions: [], personCreates: [], employmentCreates: [], positionUpdates: [],
    lifecycleCreates: [], onboardingCreates: [], audits: []
  };
  const tx = {
    position: {
      findFirst: async () => ({ id: "position-1", title: "Security Engineer", status: positionStatus, employments: [] }),
      updateMany: async (input) => { calls.positionUpdates.push(input); return { count: claimCount }; }
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
        return operation({ $transaction: async (work, options) => {
          calls.transactionOptions.push(options);
          if (transactionError) throw transactionError;
          return work(tx);
        }});
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
    "@/lib/workforce-master-data-access": { canCreateEmployeeMasterRecord: () => true },
    "@/lib/private-json": privateResponse
  });
  return { route, calls };
}

function positionFixture({ transactionError = null } = {}) {
  const calls = { transactions: 0, transactionOptions: [], creates: [], audits: [] };
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
        return operation({ $transaction: async (work, options) => {
          calls.transactionOptions.push(options);
          if (transactionError) throw transactionError;
          return work(tx);
        }});
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
    },
    "@/lib/private-json": privateResponse
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

test("employee create refuses PLANNED positions until the seat is OPEN", async () => {
  const { route, calls } = peopleFixture({ positionStatus: "PLANNED" });
  const response = await post(route, "/api/people", {
    employeeNumber: "E-PLANNED",
    givenName: "Ada",
    familyName: "Example",
    workEmail: "planned@example.com",
    positionId: "position-1",
    startDate: "2099-01-01"
  });
  assert.equal(response.status, 409);
  assert.equal(calls.personCreates.length, 0);
  assert.equal(calls.employmentCreates.length, 0);
  assert.equal(calls.positionUpdates.length, 0);
  assert.equal(calls.lifecycleCreates.length, 0);
  assert.equal(calls.onboardingCreates.length, 0);
  assert.equal(calls.audits.length, 0);
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
  assert.equal(calls.positionUpdates[0].where.status, "OPEN");
  assert.equal(calls.positionUpdates[0].where.validTo, null);
  assert.equal(calls.positionUpdates[0].data.status, "FILLED");
  assert.equal(calls.transactionOptions[0].isolationLevel, "Serializable");
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
  assert.equal(calls.transactionOptions[0].isolationLevel, "Serializable");
  assert.equal(calls.audits.length, 1);
});


test("Core HR master-data responses are explicitly private and nosniff", async () => {
  const peopleFixtureResult = peopleFixture();
  const peoplePost = await post(peopleFixtureResult.route, "/api/people", {
    employeeNumber: "E-200",
    givenName: "Ada",
    familyName: "Example",
    workEmail: "ada200@example.com",
    positionId: "position-1",
    startDate: "2099-01-01"
  });
  assert.equal(peoplePost.headers.get("cache-control"), "no-store");
  assert.equal(peoplePost.headers.get("x-content-type-options"), "nosniff");

  const positionFixtureResult = positionFixture();
  const positionPost = await post(positionFixtureResult.route, "/api/positions", {
    positionCode: "SEC-200",
    title: "Security Engineer",
    orgUnitId: "org-1",
    status: "OPEN",
    critical: false
  });
  assert.equal(positionPost.headers.get("cache-control"), "no-store");
  assert.equal(positionPost.headers.get("x-content-type-options"), "nosniff");
});


test("employee create fails closed when the OPEN seat claim loses a race", async () => {
  const { route, calls } = peopleFixture({ claimCount: 0 });
  const response = await post(route, "/api/people", {
    employeeNumber: "E-RACE",
    givenName: "Ada",
    familyName: "Race",
    workEmail: "race@example.com",
    positionId: "position-1",
    startDate: "2099-01-01"
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed concurrently/i);
  assert.equal(calls.positionUpdates.length, 1);
  assert.equal(calls.personCreates.length, 0);
  assert.equal(calls.employmentCreates.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("serializable transaction conflicts become bounded 409 responses", async () => {
  for (const [fixture, path, body] of [
    [
      () => peopleFixture({ transactionError: { code: "P2034" } }),
      "/api/people",
      { employeeNumber: "E-SERIAL", givenName: "Ada", familyName: "Serial", workEmail: "serial@example.com", positionId: "position-1", startDate: "2099-01-01" }
    ],
    [
      () => positionFixture({ transactionError: { code: "P2034" } }),
      "/api/positions",
      { positionCode: "SER-1", title: "Serialized Position", orgUnitId: "org-1", status: "OPEN", critical: false }
    ]
  ]) {
    const { route, calls } = fixture();
    const response = await post(route, path, body);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /concurrently/i);
    assert.equal(calls.transactions, 1);
    assert.equal(calls.audits.length, 0);
  }
});
