import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load() {
  const path = "lib/time-client-action.ts";
  const code = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require() { throw new Error("Unexpected import"); }, Response, AbortController, TextDecoder, setTimeout, clearTimeout, URL, fetch });
  return module.exports;
}
const api = load();
const stamp = "2026-10-06T08:00:00.000Z";
const create = { kind: "create", input: { employmentId: "emp-1", workDate: "2026-10-06", startAt: "2026-10-06T08:00:00.000Z", endAt: "2026-10-06T16:00:00.000Z", minutes: "480", overtimeMinutes: "30" } };
const created = { id: "time-1", employmentId: "emp-1", workDate: "2026-10-06T00:00:00.000Z", startAt: "2026-10-06T08:00:00.000Z", endAt: "2026-10-06T16:00:00.000Z", minutes: 480, overtimeMinutes: 30, status: "DRAFT", updatedAt: stamp };
const json = (body, status = 200) => Response.json(body, { status });

test("verified create receipt is accepted exactly once", async () => {
  let calls = 0;
  const result = await api.submitTimeAction(create, { fetchImpl: async (url, init) => {
    calls++; assert.equal(url, "/api/time/entries"); assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    return json({ data: created }, 201);
  }});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { outcome: "saved", id: "time-1", status: "DRAFT" });
  assert.equal(calls, 1);
});
for (const [name, change] of [
  ["employment", { employmentId: "other" }], ["date", { workDate: "2026-10-05T00:00:00.000Z" }],
  ["minutes", { minutes: 479 }], ["overtime", { overtimeMinutes: 31 }], ["status", { status: "SUBMITTED" }],
  ["start", { startAt: "2026-10-06T08:01:00.000Z" }], ["id", { id: "" }], ["updatedAt", { updatedAt: "bad" }]
]) test(`create mismatched ${name} receipt is unknown`, async () => {
  const result = await api.submitTimeAction(create, { fetchImpl: async () => json({ data: { ...created, ...change } }, 201) });
  assert.equal(result.outcome, "unknown");
});
for (const status of ["DRAFT","SUBMITTED","APPROVED","REJECTED","LOCKED"]) test(`verified ${status} transition accepted`, async () => {
  const result = await api.submitTimeAction({ kind: "transition", entryId: "time-1", status }, { fetchImpl: async (url, init) => {
    assert.equal(url, "/api/time/entries/time-1/transition"); assert.deepEqual(JSON.parse(init.body), { status });
    return json({ data: { ...created, status } });
  }});
  assert.equal(result.outcome, "saved"); assert.equal(result.status, status);
});
for (const data of [{ ...created, id: "time-2", status: "APPROVED" }, { ...created, status: "REJECTED" }, { data: created }, null]) test("wrong transition receipt is unknown", async () => {
  const result = await api.submitTimeAction({ kind: "transition", entryId: "time-1", status: "APPROVED" }, { fetchImpl: async () => json({ data }) });
  assert.equal(result.outcome, "unknown");
});
for (const status of [400,401,403,404,409,422,429]) test(`controlled ${status} is rejected without raw text`, async () => {
  const result = await api.submitTimeAction({ kind: "transition", entryId: "time-1", status: "SUBMITTED" }, { fetchImpl: async () => json({ error: "private upstream detail" }, status) });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { outcome: "rejected", status });
  assert.ok(!JSON.stringify(result).includes("private"));
});
test("500, HTML and malformed JSON are unknown and never retried", async () => {
  for (const response of [
    () => json({ error: "private" }, 500),
    () => new Response("<html>private</html>", { status: 200, headers: { "content-type": "text/html" } }),
    () => new Response("{", { status: 200, headers: { "content-type": "application/json" } })
  ]) {
    let calls = 0; const result = await api.submitTimeAction({ kind: "transition", entryId: "time-1", status: "SUBMITTED" }, { fetchImpl: async () => { calls++; return response(); } });
    assert.equal(result.outcome, "unknown"); assert.equal(calls, 1);
  }
});
test("oversized receipt is unknown", async () => {
  const result = await api.submitTimeAction({ kind: "transition", entryId: "time-1", status: "SUBMITTED" }, { fetchImpl: async () => Response.json({ data: { ...created, status: "SUBMITTED" }, pad: "x".repeat(70000) }) });
  assert.equal(result.outcome, "unknown");
});
test("timeout and pre-abort are unknown without retry", async () => {
  let calls = 0;
  const result = await api.submitTimeAction({ kind: "transition", entryId: "time-1", status: "SUBMITTED" }, { timeoutMs: 5, fetchImpl: async (_u, init) => {
    calls++; return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  }});
  assert.equal(result.outcome, "unknown"); assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  const before = await api.submitTimeAction({ kind: "transition", entryId: "time-1", status: "SUBMITTED" }, { signal: controller.signal, fetchImpl: async () => { throw new Error("must not run"); } });
  assert.equal(before.outcome, "unknown");
});
for (const action of [
  { kind: "transition", entryId: "", status: "SUBMITTED" },
  { kind: "transition", entryId: "..", status: "SUBMITTED" },
  { kind: "transition", entryId: "x", status: "BAD" },
  { kind: "create", input: { ...create.input, minutes: "0" } },
  { kind: "create", input: { ...create.input, overtimeMinutes: "481" } },
  { kind: "create", input: { ...create.input, endAt: undefined } }
]) test("invalid client target is rejected before IO", async () => {
  let calls = 0; const result = await api.submitTimeAction(action, { fetchImpl: async () => { calls++; return json({}); } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { outcome: "rejected", status: 400 }); assert.equal(calls, 0);
});
for (const locale of ["en","tr"]) test(`${locale} messages distinguish unknown from rejection`, () => {
  assert.notEqual(api.timeActionMessage({ outcome: "unknown" }, locale), api.timeActionMessage({ outcome: "rejected", status: 409 }, locale));
});
test("notification acknowledgement validates response shape", async () => {
  assert.equal(await api.acknowledgeTimeNotification("time-1", { fetchImpl: async () => json({ data: { updated: 1, unreadCount: 0 } }) }), true);
  assert.equal(await api.acknowledgeTimeNotification("time-1", { fetchImpl: async () => json({ data: {} }) }), false);
});
test("both time UI surfaces use the checked client action and participant keeps uncertain drafts", () => {
  const participant = readFileSync("components/time-participant-console.tsx", "utf8");
  const buttons = readFileSync("components/time-entry-transition-buttons.tsx", "utf8");
  assert.match(participant, /submitTimeAction\(action\)/);
  assert.match(participant, /if \(result\.outcome === "unknown"\) setUncertain\(true\)/);
  assert.match(participant, /if \(ok\) form\.reset\(\)/);
  assert.match(participant, /disabled=\{pending !== null \|\| uncertain\}/);
  assert.match(buttons, /submitTimeAction\(\{ kind: "transition", entryId, status \}\)/);
  assert.match(buttons, /window\.confirm/);
  assert.match(buttons, /setUncertain\(true\)/);
});
