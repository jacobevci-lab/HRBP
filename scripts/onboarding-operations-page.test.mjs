import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import ts from "typescript";
import * as query from "../lib/onboarding-operations-query.mjs";

const baseDate = "2026-10-02T08:00:00.000Z";
const task = (id, planId) => ({ id, planId, tenantId: "a", title: `Task ${id}`, ownerType: "IT", status: "COMPLETED", dueDate: new Date(baseDate), sensitive: false });
function plan(id, overrides = {}) {
  return { id, tenantId: "a", status: "IN_PROGRESS", targetStartDate: new Date(baseDate),
    personId: `person-${id}`, employmentId: `employment-${id}`,
    person: { givenName: `Name ${id}`, familyName: "Test", employeeNumber: `E-${id}` },
    employment: { status: "PREBOARDING", startDate: new Date(baseDate) },
    tasks: [task(`${id}-task`, id)], ...overrides };
}
const capability = (ctx, name) => ctx.capabilities.includes(name);
const ctx = { tenantId: "a", actorId: "actor", capabilities: ["onboarding:read", "onboarding:write", "people:write"], allowed: null };
const sources = await Promise.all(["lib/onboarding-operations-data.ts", "app/api/onboarding/operations/route.ts"].map((path) => readFile(path, "utf8")));
function compile(source, mocks) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Script(`(function(require,module,exports){${code}\n})`).runInNewContext({ Date, URL, URLSearchParams, Response, console: { error() {} } })((key) => {
    if (!(key in mocks)) throw new Error(`Unexpected dependency: ${key}`);
    return mocks[key];
  }, module, module.exports);
  return module.exports;
}
function match(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every((part) => match(row, part));
    if (key === "OR") return value.some((part) => match(row, part));
    if (key === "tasks") return row.tasks.some((item) => match(item, value.some));
    if (value instanceof Date) return row[key] instanceof Date && +row[key] === +value;
    if (value && typeof value === "object") {
      return Object.entries(value).every(([operator, operand]) => {
        if (operator === "is") return row[key] && match(row[key], operand);
        if (operator === "gt") return row[key] > operand;
        if (operator === "not") return row[key] !== operand;
        if (operator === "in") return operand.includes(row[key]);
        throw new Error(`Unexpected operator ${operator}`);
      });
    }
    return row[key] === value;
  });
}
function harness(rows = [], actor = ctx, fail = false) {
  const calls = [];
  let opened = 0;
  const client = {
    onboardingPlan: { findMany: async (args) => {
      calls.push({ kind: "plans", args });
      if (fail) throw new Error("SECRET SQL employee@example.test");
      return rows.filter((row) => match(row, args.where)).sort((a, b) => +a.targetStartDate - +b.targetStartDate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, args.take).map((row) => ({
        ...row, _count: { tasks: row.tasks.length }, tasks: row.tasks.slice(0, args.select.tasks.take)
      }));
    } },
    onboardingTask: { findFirst: async (args) => {
      calls.push({ kind: "task", args });
      return rows.flatMap((row) => row.tasks.map((item) => ({ ...item, plan: row }))).find((item) => match(item, args.where)) ?? null;
    } },
    $transaction: async (run, options) => { calls.push({ kind: "transaction", options }); return run(client); }
  };
  const data = compile(sources[0], {
    "@prisma/client": { EmploymentStatus: { PREBOARDING: "PREBOARDING" }, OnboardingStatus: { COMPLETED: "COMPLETED" }, Prisma: { TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" } } },
    "@/lib/authorization": { can: capability },
    "@/lib/db": { withDb: async (run) => { opened += 1; return run(client); } },
    "@/lib/onboarding-access": {
      resolveOnboardingPopulationScope: async (_db, context) => context.allowed,
      onboardingPlanPopulationFilter: (allowed) => allowed === null ? {} : { OR: [
        { employmentId: { in: allowed.map((id) => `employment-${id}`) } }, { personId: { in: allowed.map((id) => `person-${id}`) } }
      ] }
    },
    "@/lib/onboarding-readiness-view.mjs": { startRiskHours: (hours) => Math.min(336, Math.max(1, Math.floor(hours))) },
    "@/lib/onboarding-operations-query.mjs": query,
    "@/lib/runtime-env": { runtimeNumber: (_key, value) => value }
  });
  const route = compile(sources[1], {
    "@/lib/authorization": { can: capability },
    "@/lib/onboarding-operations-data": data,
    "@/lib/onboarding-operations-query.mjs": query,
    "@/lib/request-context": { getRequestContext: () => actor }
  });
  return { data, route, calls, opened: () => opened };
}
const page = (h, search = new URLSearchParams(), actor = ctx) => h.data.getOnboardingOperationsPage(actor, search);
const request = (h, search = "") => h.route.GET(new Request(`https://hrbp.test/api/onboarding/operations${search ? `?${search}` : ""}`));

test("cursor roundtrips unicode and separator-containing identities without adding filters", () => {
  const cursor = { date: baseDate, id: "örnek|id-/value" };
  assert.deepEqual(query.parseOnboardingCursor(query.encodeOnboardingCursor(cursor)), cursor);
});
for (const raw of ["", "not-json", "{}", "[1]", JSON.stringify([2, baseDate, "a"]), JSON.stringify([1, "2026-02-30T08:00:00.000Z", "a"]), JSON.stringify([1, baseDate, "a", "extra"]), JSON.stringify([1, baseDate, " x"]), JSON.stringify([1, baseDate, "\nsecret"]), "x".repeat(1025)]) {
  test(`invalid cursor rejected: ${raw.slice(0, 35)}`, () => assert.throws(() => query.parseOnboardingCursor(raw), RangeError));
}
for (const raw of ["plan=", "task=", "after=", "plan=x&plan=y", "task=x&task=x", "after=x&task=y", "tenantId=b", "limit=999999", "plan=x&unknown=1", `task=${"a".repeat(161)}`]) {
  test(`invalid selector rejected before opening database: ${raw.slice(0, 35)}`, async () => {
    const h = harness();
    await assert.rejects(page(h, new URLSearchParams(raw)));
    assert.equal(h.opened(), 0);
  });
}

test("keyset pages traverse 205 tied-start plans once with bounded payloads", async () => {
  const h = harness(Array.from({ length: 205 }, (_, i) => plan(`p${String(i).padStart(3, "0")}`)).reverse());
  const first = await page(h);
  const second = await page(h, new URLSearchParams({ after: first.page.nextCursor }));
  const third = await page(h, new URLSearchParams({ after: second.page.nextCursor }));
  assert.deepEqual([first.plans.length, second.plans.length, third.plans.length], [100, 100, 5]);
  assert.equal(new Set([...first.plans, ...second.plans, ...third.plans].map((p) => p.id)).size, 205);
  assert.equal(third.page.nextCursor, null);
  assert.equal(third.hasMorePlans, false);
  assert.equal(h.calls.find((c) => c.kind === "plans").args.take, 101);
  assert.equal(h.calls.find((c) => c.kind === "transaction").options.isolationLevel, "RepeatableRead");
});

test("deleted cursor anchor still permits positional continuation", async () => {
  const h = harness([plan("p101"), plan("p102")]);
  const data = await page(h, new URLSearchParams({ after: query.encodeOnboardingCursor({ date: baseDate, id: "p100" }) }));
  assert.deepEqual([...data.plans.map((p) => p.id)], ["p101", "p102"]);
});

test("every page intersects tenant, population and active queue predicates", async () => {
  const actor = { ...ctx, allowed: ["visible", "closed", "other-tenant"] };
  const h = harness([plan("hidden"), plan("other-tenant", { tenantId: "b" }), plan("closed", { status: "COMPLETED", employment: { status: "ACTIVE", startDate: new Date(baseDate) } }), plan("visible")]);
  const data = await page(h, new URLSearchParams(), actor);
  assert.deepEqual([...data.plans.map((p) => p.id)], ["visible"]);
  const where = h.calls.find((c) => c.kind === "plans").args.where;
  assert.equal(where.tenantId, "a");
  assert.equal(where.AND.length, 3);
});

test("a cursor never revives records outside a changed relationship scope", async () => {
  const h = harness([plan("b"), plan("c")]);
  const data = await page(h, new URLSearchParams({ after: query.encodeOnboardingCursor({ date: baseDate, id: "a" }) }), { ...ctx, allowed: [] });
  assert.equal(data.plans.length, 0);
});

test("empty plans remain visible and start-date/authority metadata survives", async () => {
  const h = harness([plan("empty", { tasks: [] })]);
  const data = await page(h, new URLSearchParams(), { ...ctx, capabilities: ["onboarding:read", "onboarding:write"] });
  assert.equal(data.plans[0].totalTasks, 0);
  assert.equal(data.plans[0].employmentStartDate, baseDate);
  assert.equal(data.canActivate, false);
});

test("exact plan focus bypasses page position but not access checks", async () => {
  const h = harness(Array.from({ length: 130 }, (_, i) => plan(`p${String(i).padStart(3, "0")}`)));
  const data = await page(h, new URLSearchParams({ plan: "p129" }));
  assert.deepEqual([...data.plans.map((p) => p.id)], ["p129"]);
  assert.equal(data.page.mode, "focus");
  assert.equal(data.page.resolved, true);
  assert.equal(data.page.nextCursor, null);
  assert.equal(h.calls.find((c) => c.kind === "plans").args.take, 1);
});

test("focus pins task 205 without hiding incompleteness or exceeding 200 tasks", async () => {
  const tasks = Array.from({ length: 205 }, (_, i) => task(`t${i}`, "long"));
  const h = harness([plan("long", { tasks })]);
  const data = await page(h, new URLSearchParams({ task: "t204" }));
  assert.equal(data.tasks.length, 200);
  assert.equal(data.plans[0].totalTasks, 205);
  assert.equal(data.tasks.at(-1).id, "t204");
  assert.equal(new Set(data.tasks.map((t) => t.id)).size, 200);
  const where = h.calls.find((c) => c.kind === "task").args.where;
  assert.equal(where.tenantId, "a");
  assert.equal(where.planId, "long");
  assert.equal(where.plan.is.tenantId, "a");
});

test("plan and task focus must refer to the same authorized plan", async () => {
  const h = harness([plan("a"), plan("b")]);
  const data = await page(h, new URLSearchParams({ plan: "a", task: "b-task" }));
  assert.equal(data.page.resolved, false);
  assert.equal(data.plans.length, 0);
  assert.equal(h.calls.filter((c) => c.kind === "plans").length, 1);
  assert.equal(h.calls.filter((c) => c.kind === "task").length, 0);
});

for (const name of ["missing", "outside-scope", "other-tenant", "inactive"]) {
  test(`unavailable focus returns identical 404 without fallback: ${name}`, async () => {
    const rows = [plan("visible"), plan("outside-scope"), plan("other-tenant", { tenantId: "b" }), plan("inactive", { status: "COMPLETED", employment: { status: "ACTIVE", startDate: new Date(baseDate) } })];
    const h = harness(rows, { ...ctx, allowed: ["visible", "other-tenant", "inactive"] });
    const response = await request(h, new URLSearchParams({ plan: name }).toString());
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "The requested record is not available in your active onboarding scope." });
    assert.equal(h.calls.filter((c) => c.kind === "plans").length, 1);
  });
}

for (const [actor, status] of [[null, 401], [{ ...ctx, capabilities: ["onboarding:read"] }, 403], [{ ...ctx, capabilities: ["onboarding:write"] }, 403]]) {
  test(`HTTP ${status} is fail-closed and does not open database`, async () => {
    const h = harness([plan("x")], actor);
    const response = await request(h);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(h.opened(), 0);
  });
}

test("HTTP invalid query is sanitized and rejected before database work", async () => {
  const h = harness();
  const response = await request(h, "tenantId=SECRET");
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes("SECRET"));
  assert.equal(h.opened(), 0);
});

test("HTTP database failure does not leak SQL or substitute a healthy snapshot", async () => {
  const h = harness([], ctx, true);
  const response = await request(h);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.ok(!("data" in body));
  assert.ok(!JSON.stringify(body).includes("SECRET"));
});

test("HTTP success preserves no-store and current page protocol", async () => {
  const h = harness([plan("x")]);
  const response = await request(h);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { data } = await response.json();
  assert.equal(data.page.version, 1);
  assert.equal(data.plans[0].id, "x");
  assert.equal(data.tasks[0].planId, "x");
});

test("browser guards stale reads, cancels navigation reads and preserves the full readiness console", async () => {
  const source = await readFile("components/onboarding-operations-console.tsx", "utf8");
  assert.match(source, /result\.source === tasks && result\.query === selection\.query && result\.revision === revision/);
  assert.match(source, /live = false; controller\.abort\(\)/);
  assert.match(source, /if \(live\) setResult/);
  assert.match(source, /cache: "no-store", redirect: "error", signal: controller\.signal/);
  assert.match(source, /search\.getAll\(key\)/);
  assert.match(source, /data \? <ReadinessConsole/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(output.diagnostics?.length ?? 0, 0);
});
