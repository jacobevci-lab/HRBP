import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const routePath = "app/api/core-hr/export/route.ts";

function loadRoute(dependencies) {
  const compiled = ts.transpileModule(readFileSync(routePath, "utf8"), {
    fileName: routePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  });
  assert.equal((compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected application dependency: ${name}`);
      return dependencies[name];
    },
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    Date
  }, { filename: routePath, timeout: 2000 });
  return module.exports;
}

const enums = {
  DataClassification: { CONFIDENTIAL: "CONFIDENTIAL" },
  EmploymentStatus: { ACTIVE: "ACTIVE", PREBOARDING: "PREBOARDING", LEAVE: "LEAVE", TERMINATED: "TERMINATED" },
  PositionStatus: { OPEN: "OPEN", PLANNED: "PLANNED", FILLED: "FILLED", FROZEN: "FROZEN", CLOSED: "CLOSED" }
};

function harness(options = {}) {
  const reads = [];
  const audits = [];
  const scopeCalls = [];
  const capabilities = new Set(options.capabilities ?? []);
  const ctx = Object.hasOwn(options, "ctx") ? options.ctx : {
    tenantId: "tenant-a",
    actorId: "user-a",
    role: "HRBP",
    employmentId: "emp-self"
  };
  const scope = Object.hasOwn(options, "scope") ? options.scope : ["emp-self", "emp-visible"];
  const db = {
    person: {
      async findMany(query) {
        reads.push({ model: "person", query });
        return typeof options.peopleRows === "function" ? options.peopleRows(query) : (options.peopleRows ?? []);
      }
    },
    position: {
      async findMany(query) {
        reads.push({ model: "position", query });
        return typeof options.positionRows === "function" ? options.positionRows(query) : (options.positionRows ?? []);
      }
    }
  };
  const route = loadRoute({
    "@prisma/client": enums,
    "@/lib/audit": {
      async recordAudit(input) {
        audits.push(input);
        if (options.auditError) throw options.auditError;
      }
    },
    "@/lib/authorization": {
      can(_ctx, capability) { return capabilities.has(capability); },
      forbidden() { return Response.json({ error: "Access denied by policy." }, { status: 403 }); }
    },
    "@/lib/db": { db },
    "@/lib/employment-scope": {
      employmentPrimaryKeyFilter(value) { return value === null ? {} : { id: { in: value } }; },
      async resolveEmploymentScope(receivedDb, receivedCtx) {
        scopeCalls.push({ db: receivedDb, ctx: receivedCtx });
        return scope;
      }
    },
    "@/lib/request-context": {
      async getRequestContext() { return ctx; },
      unauthorized() { return Response.json({ error: "Authenticated identity context is required." }, { status: 401 }); }
    }
  });
  return { ...route, db, reads, audits, scopeCalls };
}

function request(query) {
  return new Request(`https://hrbp.example.test/api/core-hr/export?${query}`);
}

test("export requires authenticated identity before database access", async () => {
  const h = harness({ ctx: null, capabilities: ["people:read"] });
  const response = await h.GET(request("module=people"));
  assert.equal(response.status, 401);
  assert.equal(h.reads.length, 0);
  assert.equal(h.audits.length, 0);
});

test("module capabilities fail closed before scoped export queries", async () => {
  for (const moduleKey of ["people", "positions"]) {
    const h = harness({ capabilities: [] });
    const response = await h.GET(request(`module=${moduleKey}`));
    assert.equal(response.status, 403);
    assert.equal(h.reads.length, 0);
    assert.equal(h.scopeCalls.length, 0);
    assert.equal(h.audits.length, 0);
  }
});

test("people CSV preserves filter, sort, visible columns, employment scope and spreadsheet safety", async () => {
  const h = harness({
    capabilities: ["people:read"],
    scope: ["emp-self", "emp-visible"],
    peopleRows: [{
      employeeNumber: "=E001",
      givenName: "=Formula",
      familyName: "Doe",
      workEmail: "@mail.example",
      employments: [{
        status: "ACTIVE",
        startDate: new Date("2026-10-01T00:00:00Z"),
        position: {
          positionCode: "+P-1",
          title: "=Analyst",
          location: "Istanbul",
          orgUnit: { name: "Finance" }
        }
      }]
    }]
  });
  const response = await h.GET(request("module=people&q=fin&status=ACTIVE&sort=employeeNumber&dir=desc&columnsMode=custom&columns=position&columns=status&columns=bogus"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="hrbp-people-\d{4}-\d{2}-\d{2}\.csv"$/);

  const csv = await response.text();
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Employee ID","Name","Work email","Position","Position code","Status"'));
  assert.ok(!csv.includes('"Department"'));
  assert.ok(!csv.includes('"Location"'));
  assert.ok(!csv.includes('"Start date"'));
  assert.ok(csv.includes('"\'=E001"'));
  assert.ok(csv.includes('"\'=Formula Doe"'));
  assert.ok(csv.includes('"\'@mail.example"'));
  assert.ok(csv.includes('"\'=Analyst"'));
  assert.ok(csv.includes('"\'+P-1"'));

  assert.equal(h.reads.length, 1);
  const query = h.reads[0].query;
  assert.equal(query.where.tenantId, "tenant-a");
  assert.deepEqual(query.where.employments.some.id.in, ["emp-self", "emp-visible"]);
  assert.equal(query.where.employments.some.status, "ACTIVE");
  assert.equal(query.where.OR.length, 4);
  assert.equal(query.orderBy[0].employeeNumber, "desc");
  assert.equal(query.take, 5001);
  assert.deepEqual(query.select.employments.where.id.in, ["emp-self", "emp-visible"]);

  assert.equal(h.scopeCalls.length, 1);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].action, "PEOPLE_REGISTER_EXPORTED");
  assert.equal(h.audits[0].resourceType, "PeopleRegister");
  assert.equal(h.audits[0].classification, "CONFIDENTIAL");
});

test("positions export cannot disclose incumbent identity without people read capability", async () => {
  const h = harness({
    capabilities: ["positions:read"],
    positionRows(query) {
      assert.deepEqual(query.select.employments.where.id.in, []);
      return [{
        positionCode: "P-100",
        title: "Security Architect",
        grade: "G7",
        location: "Istanbul",
        status: "OPEN",
        critical: true,
        orgUnit: { name: "Security" },
        employments: []
      }];
    }
  });
  const response = await h.GET(request("module=positions"));
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(csv.includes('"Incumbent"'));
  assert.ok(!csv.includes("Secret Person"));
  assert.equal(h.scopeCalls.length, 0);
  assert.equal(h.audits[0].action, "POSITIONS_REGISTER_EXPORTED");
});

test("positions export forwards the caller's people scope when incumbent data is allowed", async () => {
  const h = harness({
    capabilities: ["positions:read", "people:read"],
    scope: ["emp-visible"],
    positionRows(query) {
      assert.deepEqual(query.select.employments.where.id.in, ["emp-visible"]);
      return [{
        positionCode: "P-200",
        title: "Platform Engineer",
        grade: "G6",
        location: "Ankara",
        status: "FILLED",
        critical: false,
        orgUnit: { name: "Technology" },
        employments: [{ person: { givenName: "Visible", familyName: "Person" } }]
      }];
    }
  });
  const response = await h.GET(request("module=positions&columnsMode=custom&columns=incumbent&columns=status"));
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(csv.includes('"Position code","Title","Incumbent","Status"'));
  assert.ok(csv.includes('"Visible Person"'));
  assert.equal(h.scopeCalls.length, 1);
});

test("oversized exports fail explicitly and never create misleading audit evidence", async () => {
  const h = harness({
    capabilities: ["people:read"],
    peopleRows: Array.from({ length: 5001 }, () => ({ employments: [] }))
  });
  const response = await h.GET(request("module=people"));
  assert.equal(response.status, 422);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.match(body.error, /exceeds 5000 rows/);
  assert.equal(h.audits.length, 0);
});

test("an audit-ledger failure prevents an otherwise successful export from being returned", async () => {
  const h = harness({
    capabilities: ["people:read"],
    peopleRows: [],
    auditError: new Error("audit unavailable")
  });
  await assert.rejects(h.GET(request("module=people")), /audit unavailable/);
});

test("unknown export modules are rejected without data access", async () => {
  const h = harness({ capabilities: ["people:read", "positions:read"] });
  const response = await h.GET(request("module=unknown"));
  assert.equal(response.status, 400);
  assert.equal(h.reads.length, 0);
  assert.equal(h.audits.length, 0);
});
