import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const ctx = { tenantId: "tenant-a", actorId: "actor-a", role: "HR_OPERATIONS", employmentId: "employee-a" };
const createInput = () => ({ title: "Prepare workstation", ownerType: "IT", sensitive: false,
  dueDate: "2026-10-03T09:30:00.000Z", reason: "Required equipment for day one", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedPlanStatus: "NOT_STARTED" });
const deadlineInput = () => ({ dueDate: "2026-10-03T09:30:00.000Z", reason: "Set the missing control deadline", expectedPlanStatus: "NOT_STARTED", expectedTaskStatus: "NOT_STARTED" });
class KnownError extends Error { constructor(code) { super("private database detail"); this.code = code; } }
const status = Object.fromEntries(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED", "WAIVED", "PREBOARDING", "ACTIVE", "TERMINATED", "RESTRICTED", "CONFIDENTIAL"].map((key) => [key, key]));
function compile(path, mocks) {
  const result = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(result.diagnostics, []);
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputText)(module, module.exports, (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error(`Unexpected unmocked dependency: ${name}`);
    return require(name);
  });
  return module.exports;
}
// Compile once; each fixture supplies isolated auth/database state through the bindings.
const implementation = ts.transpileModule(readFileSync("lib/onboarding-task-planning.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
function fixture(options = {}) {
  let state = {
    plan: { id: "plan-a", tenantId: "tenant-a", personId: "person-a", employmentId: "employment-a", status: "NOT_STARTED",
      employment: { tenantId: "tenant-a", personId: "person-a", status: "PREBOARDING" }, ...options.plan },
    tasks: options.tasks ?? [{ id: "task-a", tenantId: "tenant-a", planId: "plan-a", status: "NOT_STARTED", dueDate: null, sensitive: false }],
    audit: []
  };
  const calls = [];
  const matches = (row, where) => row && Object.entries(where).every(([key, value]) => row[key] === value);
  const tx = {
    onboardingPlan: { findFirst: async (query) => { calls.push(["plan-read", query]); return matches(state.plan, query.where) ? structuredClone(state.plan) : null; } },
    onboardingTask: {
      findFirst: async (query) => { calls.push(["task-read", query]); return structuredClone(state.tasks.find((row) => matches(row, query.where)) ?? null); },
      create: async (query) => {
        calls.push(["create", query]);
        if (options.writeError) throw new KnownError(options.writeError);
        if (state.tasks.some((row) => row.id === query.data.id)) throw new KnownError("P2002");
        state.tasks.push(structuredClone(query.data));
        return { id: query.data.id, status: query.data.status };
      },
      updateMany: async (query) => {
        calls.push(["update", query]);
        if (options.writeError) throw new KnownError(options.writeError);
        if (options.race) return { count: 0 };
        const row = state.tasks.find((item) => matches(item, query.where));
        if (!row) return { count: 0 };
        Object.assign(row, query.data);
        return { count: 1 };
      }
    }
  };
  const mocks = {
    "@prisma/client": { DataClassification: status, EmploymentStatus: status, OnboardingStatus: status, OnboardingTaskStatus: status,
      Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" }, PrismaClientKnownRequestError: KnownError } },
    "@/lib/audit": { appendAudit: async (client, actor, entry) => {
      assert.equal(client, tx); assert.equal(actor.tenantId, ctx.tenantId);
      if (options.auditFailure) throw new Error("secret audit connection string");
      state.audit.push(entry);
    } },
    "@/lib/authorization": { can: (_actor, capability) => !(options.deny ?? []).includes(capability) },
    "@/lib/db": { withDb: async (operation) => {
      calls.push(["db"]);
      return operation({ $transaction: async (run, transactionOptions) => {
        calls.push(["transaction", transactionOptions]);
        const previous = structuredClone(state);
        try { return await run(tx); } catch (error) { state = previous; throw error; }
      } });
    } },
    "@/lib/onboarding-access": {
      resolveOnboardingPopulationScope: async (client, actor) => { assert.equal(client, tx); calls.push(["scope", actor]); return options.outOfScope ? [] : ["person-a"]; },
      canAccessOnboardingPlan: (scope, plan) => scope.includes(plan.personId)
    },
    "@/lib/request-context": { getRequestContext: () => options.anonymous ? null : { ...ctx, ...options.ctx }, mutationOriginAllowed: () => !options.crossOrigin }
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", implementation)(module, module.exports, (name) => mocks[name] ?? require(name));
  const path = options.mode === "deadline" ? "app/api/onboarding/tasks/[id]/deadline/route.ts" : "app/api/onboarding/plans/[id]/tasks/route.ts";
  const route = compile(path, { "@/lib/onboarding-task-planning": module.exports });
  return { calls, state: () => state, async invoke(body = options.mode === "deadline" ? deadlineInput() : createInput(), requestOptions = {}) {
    const request = new Request("https://hrbp.test/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...requestOptions });
    const response = await route.POST(request, { params: Promise.resolve({ id: options.id ?? (options.mode === "deadline" ? "task-a" : "plan-a") }) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json() };
  } };
}

test("new control is created unstarted, tenant-bound and audited without activating employment", async () => {
  const f = fixture(); const result = await f.invoke();
  assert.equal(result.status, 201);
  const task = f.state().tasks.at(-1);
  assert.equal(task.status, "NOT_STARTED"); assert.equal(task.tenantId, ctx.tenantId); assert.equal(task.planId, "plan-a");
  assert.equal(task.title, createInput().title); assert.equal(task.ownerType, "IT"); assert.equal(task.sensitive, false);
  assert.equal(task.dueDate.toISOString(), createInput().dueDate);
  assert.equal(f.state().plan.status, "NOT_STARTED"); assert.equal(f.state().plan.employment.status, "PREBOARDING");
  assert.equal(f.state().audit[0].action, "onboarding-task.created");
  assert.equal(JSON.parse(f.state().audit[0].purpose).reason, createInput().reason);
  assert.equal(f.state().audit[0].classification, "CONFIDENTIAL");
  assert.deepEqual(f.calls.find(([name]) => name === "transaction")[1], { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
});
test("sensitive creation uses restricted audit classification", async () => {
  const f = fixture(); assert.equal((await f.invoke({ ...createInput(), sensitive: true })).status, 201);
  assert.equal(f.state().audit[0].classification, "RESTRICTED");
});
test("creation retries with the same scoped request ID cannot duplicate a task or audit event", async () => {
  const f = fixture(); const first = await f.invoke(); const second = await f.invoke();
  assert.equal(first.status, 201); assert.equal(second.status, 409); assert.equal(f.state().tasks.length, 2); assert.equal(f.state().audit.length, 1);
});
test("a replay with altered content still cannot reuse the task identity", async () => {
  const f = fixture(); await f.invoke(); assert.equal((await f.invoke({ ...createInput(), title: "Changed replay" })).status, 409);
  assert.equal(f.state().tasks.at(-1).title, createInput().title);
});
test("distinct explicitly requested task IDs can create separate controls", async () => {
  const f = fixture(); await f.invoke(); assert.equal((await f.invoke({ ...createInput(), requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).status, 201);
  assert.equal(f.state().audit.length, 2);
});
test("missing deadline is set with compare-and-swap and before/after audit evidence", async () => {
  const f = fixture({ mode: "deadline" }); const result = await f.invoke(); assert.equal(result.status, 200);
  const update = f.calls.find(([name]) => name === "update")[1];
  assert.deepEqual(update.where, { id: "task-a", tenantId: "tenant-a", planId: "plan-a", status: "NOT_STARTED", dueDate: null });
  assert.deepEqual(Object.keys(update.data), ["dueDate"]);
  assert.equal(f.state().tasks[0].status, "NOT_STARTED");
  assert.deepEqual(JSON.parse(f.state().audit[0].purpose), { reason: deadlineInput().reason, previousDueDate: null, dueDate: deadlineInput().dueDate });
});
test("setting the deadline again is rejected, including the same value", async () => {
  const f = fixture({ mode: "deadline" }); await f.invoke(); const repeated = await f.invoke();
  assert.equal(repeated.status, 409); assert.equal(repeated.body.code, "DEADLINE_EXISTS"); assert.equal(f.state().audit.length, 1);
});
test("past missing deadline stays in the past instead of moving the target forward", async () => {
  const f = fixture({ mode: "deadline" }); const input = { ...deadlineInput(), dueDate: "2020-01-01T00:00:00.000Z" };
  assert.equal((await f.invoke(input)).status, 200); assert.equal(f.state().tasks[0].dueDate.toISOString(), input.dueDate);
});
for (const mode of ["create", "deadline"]) {
  for (const [name, options, expected] of [
    ["anonymous", { anonymous: true }, 401], ["cross-origin", { crossOrigin: true }, 403],
    ["missing read authority", { deny: ["onboarding:read"] }, 403], ["missing write authority", { deny: ["onboarding:write"] }, 403],
    ["invalid identifier", { id: "\u0000bad" }, 400]
  ]) test(`${mode}: ${name} fails before database access`, async () => {
    const f = fixture({ mode, ...options }); assert.equal((await f.invoke()).status, expected); assert.equal(f.calls.length, 0);
  });
  for (const [name, options, code] of [
    ["different tenant", { ctx: { tenantId: "tenant-b" } }, "NOT_FOUND"],
    ["outside population scope", { outOfScope: true }, "NOT_FOUND"],
    ["unknown record", { id: "unknown" }, "NOT_FOUND"],
    ["closed plan", { plan: { status: "COMPLETED" } }, "PLAN_LOCKED"],
    ["unlinked plan", { plan: { employmentId: null } }, "PLAN_LOCKED"],
    ["active employment", { plan: { employment: { tenantId: "tenant-a", personId: "person-a", status: "ACTIVE" } } }, "PLAN_LOCKED"],
    ["inconsistent person linkage", { plan: { employment: { tenantId: "tenant-a", personId: "person-b", status: "PREBOARDING" } } }, "PLAN_LOCKED"],
    ["cross-tenant employment linkage", { plan: { employment: { tenantId: "tenant-b", personId: "person-a", status: "PREBOARDING" } } }, "PLAN_LOCKED"],
    ["plan state changed", { plan: { status: "IN_PROGRESS" } }, "CONFLICT"]
  ]) test(`${mode}: ${name} cannot write`, async () => {
    const f = fixture({ mode, ...options }); const result = await f.invoke();
    assert.equal(result.body.code, code); assert.equal(result.status, code === "NOT_FOUND" ? 404 : 409);
    assert.equal(f.calls.some(([name]) => ["update", "create"].includes(name)), false); assert.equal(f.state().audit.length, 0);
  });
}
for (const taskStatus of ["COMPLETED", "WAIVED"]) test(`terminal ${taskStatus} task cannot acquire a deadline`, async () => {
  const f = fixture({ mode: "deadline", tasks: [{ id: "task-a", tenantId: "tenant-a", planId: "plan-a", status: taskStatus, dueDate: null }] });
  assert.equal((await f.invoke()).body.code, "TASK_LOCKED"); assert.equal(f.state().audit.length, 0);
});
test("changed task state is rejected without a write", async () => {
  const f = fixture({ mode: "deadline", tasks: [{ id: "task-a", tenantId: "tenant-a", planId: "plan-a", status: "BLOCKED", dueDate: null }] });
  assert.equal((await f.invoke()).body.code, "CONFLICT"); assert.equal(f.state().audit.length, 0);
});
test("a blocked task can receive its missing deadline without clearing the blocker", async () => {
  const f = fixture({ mode: "deadline", tasks: [{ id: "task-a", tenantId: "tenant-a", planId: "plan-a", status: "BLOCKED", dueDate: null, sensitive: true }] });
  assert.equal((await f.invoke({ ...deadlineInput(), expectedTaskStatus: "BLOCKED" })).status, 200);
  assert.equal(f.state().tasks[0].status, "BLOCKED"); assert.equal(f.state().audit[0].classification, "RESTRICTED");
});
for (const [name, changes] of [
  ["short reason", { reason: "no" }], ["long reason", { reason: "x".repeat(501) }], ["long title", { title: "x".repeat(201) }],
  ["no title", { title: " " }], ["non-boolean sensitive", { sensitive: "false" }], ["unknown team", { ownerType: "ADMIN" }],
  ["non-UUID request", { requestId: "id" }], ["completed desired plan", { expectedPlanStatus: "COMPLETED" }],
  ["caller tenant", { tenantId: "tenant-b" }], ["caller status", { status: "COMPLETED" }], ["caller assignment", { ownerId: "admin" }],
  ["date without timezone", { dueDate: "2026-10-03T09:30" }], ["invalid calendar date", { dueDate: "2026-02-30T00:00:00.000Z" }],
  ["date with offset", { dueDate: "2026-10-03T09:30:00.000+03:00" }], ["null date", { dueDate: null }]
]) test(`input rejects ${name} before database access`, async () => {
  const f = fixture(); assert.equal((await f.invoke({ ...createInput(), ...changes })).status, 400); assert.equal(f.calls.length, 0);
});
for (const body of [[], null, "text", 42]) test(`non-object JSON rejected: ${JSON.stringify(body)}`, async () => {
  const f = fixture(); assert.equal((await f.invoke(body)).status, 400); assert.equal(f.calls.length, 0);
});
test("malformed and oversized JSON fail before a database connection", async () => {
  for (const [body, expected] of [["{", 400], [JSON.stringify({ ...createInput(), reason: "x".repeat(9000) }), 413]]) {
    const f = fixture(); assert.equal((await f.invoke({}, { body })).status, expected); assert.equal(f.calls.length, 0);
  }
});
test("content type and UTF-8 decoding are enforced", async () => {
  const f = fixture(); assert.equal((await f.invoke(createInput(), { headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await f.invoke({}, { body: new Uint8Array([0xff, 0xfe]) })).status, 400); assert.equal(f.calls.length, 0);
});
test("deadline mode cannot smuggle title/status/sensitivity edits", async () => {
  const f = fixture({ mode: "deadline" }); assert.equal((await f.invoke({ ...deadlineInput(), sensitive: false })).status, 400); assert.equal(f.calls.length, 0);
});
test("compare-and-swap race yields conflict without audit", async () => {
  const f = fixture({ mode: "deadline", race: true }); assert.equal((await f.invoke()).body.code, "CONFLICT"); assert.equal(f.state().audit.length, 0);
});
for (const mode of ["create", "deadline"]) {
  test(`${mode}: audit failure rolls back the domain write and returns no private error`, async () => {
    const f = fixture({ mode, auditFailure: true }); const before = structuredClone(f.state()); const result = await f.invoke();
    assert.equal(result.status, 500); assert.deepEqual(f.state(), before); assert.ok(!JSON.stringify(result).includes("secret"));
  });
  test(`${mode}: serializable conflict is controlled without automatic retry`, async () => {
    const f = fixture({ mode, writeError: "P2034" }); const result = await f.invoke(); assert.equal(result.status, 409);
    assert.equal(f.calls.filter(([name]) => name === "transaction").length, 1);
    assert.equal(f.state().audit.length, 0); assert.ok(!JSON.stringify(result).includes("private database"));
  });
}
test("form and browser keep planning on the current authorized page with explicit safeguards", () => {
  const ui = readFileSync("components/onboarding-task-planning-console.tsx", "utf8");
  const browser = readFileSync("components/onboarding-operations-console.tsx", "utf8");
  const result = ts.transpileModule(ui, { fileName: "planner.tsx", reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(result.diagnostics, []);
  for (const text of ["window.crypto.randomUUID()", "expectedPlanStatus", "expectedTaskStatus", "dueDate === null", "setLocked(true)", "onSaved()", "credentials: \"same-origin\"", "redirect: \"error\"", "type=\"datetime-local\"", "minLength={10}", "maxLength={500}"]) assert.ok(ui.includes(text), text);
  assert.match(browser, /data \? <OnboardingTaskPlanningConsole[\s\S]*snapshot=\{data\}/);
  assert.match(browser, /onSaved=\{\(\) => setRevision\(\(value\) => value \+ 1\)\}/);
  assert.match(browser, /<fieldset disabled=\{planning\}/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|\.retry\(/);
});
