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
const apiPagination = loadPlain("lib/api-pagination.ts");

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

function peopleFixture({ positionStatus = "OPEN", claimCount = 1, transactionError = null, peopleRows = [], peopleTotal = peopleRows.length } = {}) {
  const calls = {
    transactions: 0, transactionOptions: [], personCreates: [], employmentCreates: [], positionUpdates: [],
    lifecycleCreates: [], onboardingCreates: [], audits: [], peopleReads: [], peopleCounts: []
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
      db: {
        person: {
          findMany: async (options) => { calls.peopleReads.push(options); return peopleRows; },
          count: async (options) => { calls.peopleCounts.push(options); return peopleTotal; }
        }
      },
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
    "@/lib/private-json": privateResponse,
    "@/lib/api-pagination": apiPagination
  });
  return { route, calls };
}

function positionFixture({ transactionError = null, positionRows = [], positionTotal = positionRows.length } = {}) {
  const calls = { transactions: 0, transactionOptions: [], creates: [], audits: [], positionReads: [], positionCounts: [] };
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
      db: {
        position: {
          findMany: async (options) => { calls.positionReads.push(options); return positionRows; },
          count: async (options) => { calls.positionCounts.push(options); return positionTotal; }
        }
      },
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
    "@/lib/private-json": privateResponse,
    "@/lib/api-pagination": apiPagination
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


async function get(route, path) {
  return route.GET(new Request("https://hrbp.example.test" + path));
}

test("Core HR read APIs expose bounded pagination metadata while preserving data arrays", async () => {
  const peopleRows = [{ id: "person-26" }];
  const peopleFixtureResult = peopleFixture({ peopleRows, peopleTotal: 61 });
  const peopleResponse = await get(peopleFixtureResult.route, "/api/people?page=2&limit=25");
  assert.equal(peopleResponse.status, 200);
  assert.deepEqual(await peopleResponse.json(), {
    data: peopleRows,
    meta: { page: 2, limit: 25, total: 61, pageCount: 3, hasMore: true }
  });
  assert.equal(peopleFixtureResult.calls.peopleReads[0].skip, 25);
  assert.equal(peopleFixtureResult.calls.peopleReads[0].take, 25);
  assert.deepEqual(peopleFixtureResult.calls.peopleReads[0].orderBy, [
    { familyName: "asc" }, { givenName: "asc" }, { id: "asc" }
  ]);
  assert.deepEqual(peopleFixtureResult.calls.peopleReads[0].select.employments.orderBy, [
    { startDate: "desc" }, { id: "desc" }
  ]);
  assert.deepEqual(peopleFixtureResult.calls.peopleCounts[0].where, peopleFixtureResult.calls.peopleReads[0].where);

  const positionRows = [{ id: "position-1" }];
  const positionFixtureResult = positionFixture({ positionRows, positionTotal: 201 });
  const positionResponse = await get(positionFixtureResult.route, "/api/positions");
  assert.equal(positionResponse.status, 200);
  assert.deepEqual(await positionResponse.json(), {
    data: positionRows,
    meta: { page: 1, limit: 200, total: 201, pageCount: 2, hasMore: true }
  });
  assert.equal(positionFixtureResult.calls.positionReads[0].skip, 0);
  assert.equal(positionFixtureResult.calls.positionReads[0].take, 200);
  assert.deepEqual(positionFixtureResult.calls.positionReads[0].orderBy, [
    { positionCode: "asc" }, { id: "asc" }
  ]);
  assert.deepEqual(positionFixtureResult.calls.positionCounts[0].where, positionFixtureResult.calls.positionReads[0].where);
});

test("invalid or ambiguous Core HR pagination fails before database reads", async () => {
  for (const [factory, path, readKey, countKey] of [
    [peopleFixture, "/api/people?limit=201", "peopleReads", "peopleCounts"],
    [peopleFixture, "/api/people?page=0", "peopleReads", "peopleCounts"],
    [peopleFixture, "/api/people?page=1&page=2", "peopleReads", "peopleCounts"],
    [positionFixture, "/api/positions?limit=abc", "positionReads", "positionCounts"],
    [positionFixture, "/api/positions?page=10001", "positionReads", "positionCounts"]
  ]) {
    const result = factory();
    const response = await get(result.route, path);
    assert.equal(response.status, 400);
    assert.equal(result.calls[readKey].length, 0);
    assert.equal(result.calls[countKey].length, 0);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("Core HR pagination helper retains the historical 200-row People default and bounds offsets", () => {
  const parsed = apiPagination.parseApiPagination(new Request("https://hrbp.example.test/api/people"));
  assert.deepEqual(parsed, { page: 1, limit: 200, skip: 0 });
  assert.equal(apiPagination.parseApiPagination(new Request("https://hrbp.example.test/api/people?limit=0")), null);
  assert.equal(apiPagination.parseApiPagination(new Request("https://hrbp.example.test/api/people?limit=201")), null);
  assert.deepEqual(
    apiPagination.paginationMeta(3, 25, 61),
    { page: 3, limit: 25, total: 61, pageCount: 3, hasMore: false }
  );
});
