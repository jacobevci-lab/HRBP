import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const routePath = "app/api/search/route.ts";
const plain = (value) => JSON.parse(JSON.stringify(value));

const labels = {
  "nav.dashboard": { en: "Dashboard", tr: "Ana Sayfa" },
  "nav.people": { en: "People", tr: "Çalışanlar" },
  "nav.positions": { en: "Positions", tr: "Pozisyonlar" }
};

const navigation = [{
  items: [
    { slug: "dashboard", labelKey: "nav.dashboard" },
    { slug: "people", labelKey: "nav.people", requiredCapability: "people:read" },
    { slug: "positions", labelKey: "nav.positions", requiredCapability: "positions:read" }
  ]
}];

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
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    decodeURIComponent,
    encodeURIComponent,
    console: { error() {} }
  }, { filename: routePath, timeout: 2000 });
  return module.exports;
}

function harness(options = {}) {
  const reads = [];
  const contextCalls = [];
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
        return options.peopleRows ?? [];
      }
    },
    position: {
      async findMany(query) {
        reads.push({ model: "position", query });
        return options.positionRows ?? [];
      }
    }
  };
  const route = loadRoute({
    "@prisma/client": { EmploymentStatus: { TERMINATED: "TERMINATED" } },
    "@/lib/authorization": {
      can(_ctx, capability) { return capabilities.has(capability); }
    },
    "@/lib/db": {
      async withDb(callback) {
        if (options.dbError) throw options.dbError;
        return callback(db);
      }
    },
    "@/lib/employment-scope": {
      async resolveEmploymentScope(receivedDb, receivedCtx) {
        scopeCalls.push({ db: receivedDb, ctx: receivedCtx });
        return scope;
      }
    },
    "@/lib/i18n": {
      isLocale(value) { return value === "en" || value === "tr"; },
      translate(locale, key) { return labels[key]?.[locale] ?? key; }
    },
    "@/lib/navigation": { navigation },
    "@/lib/request-context": {
      async getRequestContext(request) {
        contextCalls.push(request);
        return ctx;
      }
    }
  });
  return { ...route, reads, contextCalls, scopeCalls };
}

function request(query, headers) {
  return new Request(`https://hrbp.example.test/api/search?${query}`, { headers });
}

test("short global search queries return no data before identity or database work", async () => {
  const h = harness({ capabilities: ["people:read", "positions:read"] });
  const response = await h.GET(request("q=a"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { data: [] });
  assert.equal(h.contextCalls.length, 0);
  assert.equal(h.reads.length, 0);
});

test("public staging search exposes matching modules but never tenant records", async () => {
  const h = harness({ ctx: null, peopleRows: [{ id: "secret" }], positionRows: [{ id: "secret-position" }] });
  const response = await h.GET(request("q=people"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, [{
    type: "module",
    id: "people",
    title: "People",
    subtitle: "Read-only staging module",
    href: "/module/people"
  }]);
  assert.equal(h.contextCalls.length, 1);
  assert.equal(h.reads.length, 0);
  assert.equal(h.scopeCalls.length, 0);
});

test("authenticated search applies tenant and employment scope to people and capability gates positions", async () => {
  const h = harness({
    capabilities: ["people:read"],
    scope: ["emp-self", "emp-visible"],
    peopleRows: [{
      id: "person-1",
      givenName: "Sec",
      familyName: "User",
      employeeNumber: "E-42",
      employments: [{ position: { title: "Security Analyst" } }]
    }],
    positionRows: [{
      id: "position-secret",
      positionCode: "P-SECRET",
      title: "Should not appear",
      orgUnit: { name: "Hidden" }
    }]
  });
  const response = await h.GET(request("q=sec"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].type, "person");
  assert.equal(body.data[0].href, "/module/employee-360?person=person-1");

  assert.equal(h.scopeCalls.length, 1);
  assert.equal(h.reads.length, 1);
  const personQuery = h.reads[0].query;
  assert.equal(personQuery.where.tenantId, "tenant-a");
  assert.deepEqual(plain(personQuery.where.employments.some.id.in), ["emp-self", "emp-visible"]);
  assert.equal(personQuery.where.employments.some.tenantId, "tenant-a");
  assert.deepEqual(plain(personQuery.select.employments.where.id.in), ["emp-self", "emp-visible"]);
  assert.equal(personQuery.select.employments.where.tenantId, "tenant-a");
  assert.equal(personQuery.take, 8);
});

test("position matches use capability-gated tenant queries and deep-link to the matched position code", async () => {
  const h = harness({
    capabilities: ["positions:read"],
    positionRows: [{
      id: "position-1",
      positionCode: "P/SEC?1",
      title: "Security Architect",
      orgUnit: { name: "Security" }
    }]
  });
  const response = await h.GET(request("q=security"));
  assert.equal(response.status, 200);
  const body = await response.json();
  const position = body.data.find((item) => item.type === "position");
  assert.ok(position);
  assert.equal(position.href, "/module/positions?q=P%2FSEC%3F1");
  assert.equal(h.scopeCalls.length, 0);
  assert.equal(h.reads.length, 1);
  const query = h.reads[0].query;
  assert.equal(query.where.tenantId, "tenant-a");
  assert.equal(query.where.validTo, null);
  assert.equal(query.take, 8);
});

test("database degradation falls back to accessible module results without leaking live records", async () => {
  const h = harness({
    capabilities: ["people:read"],
    dbError: new Error("database unavailable")
  });
  const response = await h.GET(request("q=people"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.degraded, true);
  assert.deepEqual(body.data, [{
    type: "module",
    id: "people",
    title: "People",
    subtitle: "HRBP One workspace",
    href: "/module/people"
  }]);
  assert.equal(h.reads.length, 0);
});

test("locale cookie localizes public module results and matching uses Turkish labels", async () => {
  const h = harness({ ctx: null });
  const response = await h.GET(request("q=çalış", { cookie: "hrbp-locale=tr" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].title, "Çalışanlar");
  assert.equal(body.data[0].subtitle, "Salt-okunur staging modülü");
});

test("search input is bounded before database predicates are constructed", async () => {
  const h = harness({ capabilities: ["people:read"], peopleRows: [] });
  await h.GET(request("q=" + "x".repeat(120)));
  assert.equal(h.reads.length, 1);
  const personQuery = h.reads[0].query;
  for (const clause of personQuery.where.OR) {
    const field = Object.values(clause)[0];
    assert.equal(field.contains.length, 80);
  }
});
