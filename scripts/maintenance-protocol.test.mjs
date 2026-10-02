import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { MAINTENANCE_JOBS, MAINTENANCE_PROTOCOL_VERSION, selectMaintenanceJobs, executeMaintenanceJobs } from "../lib/maintenance-protocol.mjs";
import { runMaintenance, validateConfiguration, markdownSummary } from "./run-operational-maintenance.mjs";

const url = "https://hrbp.example/api/internal/maintenance";
const token = "test-internal-token-with-32-characters";
const config = { url, token };
const capabilities = () => Response.json({ data: { protocolVersion: MAINTENANCE_PROTOCOL_VERSION, jobs: MAINTENANCE_JOBS } });
function result(job, status = "success", overrides = {}) {
  return { data: {}, execution: { protocolVersion: 1, mode: "single", jobs: [{ job, status, durationMs: 1 }] }, ...overrides };
}
function fakeTransport(responder = (job) => Response.json(result(job))) {
  const calls = [];
  const fetchImpl = async (target, options) => {
    calls.push({ method: options.method, job: target.searchParams.get("job") });
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.ok(options.signal instanceof AbortSignal);
    return options.method === "GET" ? capabilities() : responder(target.searchParams.get("job"), options);
  };
  return { calls, fetchImpl };
}

test("manifest contains eleven unique jobs and immutable execution order", () => {
  assert.equal(MAINTENANCE_JOBS.length, 11);
  assert.equal(new Set(MAINTENANCE_JOBS).size, 11);
  assert.ok(Object.isFrozen(MAINTENANCE_JOBS));
  assert.equal(MAINTENANCE_JOBS.at(-1), "operational-maintenance");
});

test("absent selector preserves all jobs and every valid selector selects exactly one", () => {
  assert.deepEqual(selectMaintenanceJobs(new URLSearchParams()), MAINTENANCE_JOBS);
  for (const job of MAINTENANCE_JOBS) assert.deepEqual(selectMaintenanceJobs(new URLSearchParams({ job })), [job]);
});

for (const query of ["job=", "job=all", "job=unknown", "job=__proto__", "job=toString", "job=benefits-lifecycle&job=benefits-lifecycle", "job=%20benefits-lifecycle"]) {
  test(`reject selector without falling back to all jobs: ${query}`, () => {
    assert.throws(() => selectMaintenanceJobs(new URLSearchParams(query)), RangeError);
  });
}

test("single job execution never calls unrelated domains and supplies bounded telemetry", async () => {
  const calls = [];
  let clock = 1_000;
  const report = await executeMaintenanceJobs(["learning-lifecycle"], async (job) => { calls.push(job); return { updated: 2 }; }, () => clock += 5);
  assert.deepEqual(calls, ["learning-lifecycle"]);
  assert.deepEqual(report.results, { learningLifecycle: { updated: 2 } });
  assert.deepEqual(report.failures, []);
  assert.equal(report.execution.mode, "single");
  assert.equal(report.execution.jobs[0].durationMs, 5);
  assert.equal(report.execution.durationMs, 15);
});

test("all execution remains serial, preserves order and operational response key", async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const report = await executeMaintenanceJobs(MAINTENANCE_JOBS, async (job) => {
    active += 1; maxActive = Math.max(maxActive, active); calls.push(job);
    await tick(); active -= 1;
    return job === "operational-maintenance" ? { notifications: { delivered: 1 } } : { scanned: 0 };
  });
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, MAINTENANCE_JOBS);
  assert.equal(report.execution.mode, "all");
  assert.deepEqual(report.results.operational, { notifications: { delivered: 1 } });
});

test("a failed domain does not suppress later jobs or leak arbitrary exception messages", async () => {
  const secret = "private-sql-and-person-data";
  const report = await executeMaintenanceJobs(["benefits-lifecycle", "learning-lifecycle"], async (job) => {
    if (job === "benefits-lifecycle") throw Object.assign(new Error(secret), { code: "P2028" });
    return { updated: 1 };
  });
  assert.deepEqual(report.failures, [{ job: "benefits-lifecycle", type: "Error", code: "P2028" }]);
  assert.equal(report.results.benefitsLifecycle, null);
  assert.deepEqual(report.results.learningLifecycle, { updated: 1 });
  assert.equal(report.execution.jobs[1].status, "success");
  assert.ok(!JSON.stringify(report).includes(secret));
});

test("machine diagnostics reject unbounded and multiline exception properties", async () => {
  const report = await executeMaintenanceJobs(["audit-integrity"], async () => {
    throw { name: "sensitive\nname", code: "x".repeat(100), message: token };
  });
  assert.deepEqual(report.failures, [{ job: "audit-integrity", type: "Error" }]);
  assert.ok(!JSON.stringify(report).includes(token));
});

test("invalid or duplicate execution lists are rejected before any work", async () => {
  for (const jobs of [[], ["unknown"], ["toString"], ["audit-integrity", "audit-integrity"]]) {
    let calls = 0;
    await assert.rejects(executeMaintenanceJobs(jobs, async () => { calls += 1; }), RangeError);
    assert.equal(calls, 0);
  }
});

test("scheduler preflights, then runs each job exactly once in serial order", async () => {
  let active = 0;
  let maxActive = 0;
  const transport = fakeTransport(async (job) => {
    active += 1; maxActive = Math.max(maxActive, active);
    await tick(); active -= 1;
    return Response.json(result(job));
  });
  const report = await runMaintenance({ ...config, fetchImpl: transport.fetchImpl });
  assert.equal(report.success, true);
  assert.equal(maxActive, 1);
  assert.equal(transport.calls.length, 12);
  assert.equal(transport.calls[0].method, "GET");
  assert.deepEqual(transport.calls.slice(1).map((call) => call.job), MAINTENANCE_JOBS);
});

test("manual rerun selects only the requested domain", async () => {
  const transport = fakeTransport();
  const report = await runMaintenance({ ...config, job: "onboarding-readiness", fetchImpl: transport.fetchImpl });
  assert.equal(report.success, true);
  assert.deepEqual(transport.calls, [{ method: "GET", job: null }, { method: "POST", job: "onboarding-readiness" }]);
});

for (const variant of ["legacy", "wrong-version", "wrong-order", "empty-list"]) {
  test(`preflight blocks incompatible deployments without POST: ${variant}`, async () => {
    const calls = [];
    const report = await runMaintenance({ ...config, fetchImpl: async (_target, options) => {
      calls.push(options.method);
      if (variant === "legacy") return new Response("old deployment", { status: 405 });
      return Response.json({ data: { protocolVersion: variant === "wrong-version" ? 2 : 1,
        jobs: variant === "wrong-order" ? [...MAINTENANCE_JOBS].reverse() : [] } });
    } });
    assert.deepEqual(calls, ["GET"]);
    assert.equal(report.success, false);
    assert.equal(report.stopped, true);
    assert.equal(report.results[0].code, "PROTOCOL_UNAVAILABLE_DEPLOY_REQUIRED");
  });
}

test("known domain failure stays red but later domains still run", async () => {
  const transport = fakeTransport((job) => job === "learning-lifecycle"
    ? Response.json(result(job, "failed", { failures: [{ job, type: "Error", code: "P2028" }] }), { status: 500 })
    : Response.json(result(job)));
  const report = await runMaintenance({ ...config, fetchImpl: transport.fetchImpl });
  assert.equal(report.success, false);
  assert.equal(report.stopped, false);
  assert.equal(transport.calls.length, 12);
  assert.equal(report.results[1].code, "JOB_FAILED");
  assert.equal(report.results.at(-1).status, "success");
});

test("Cloudflare 1102 is attributed to its domain without retrying it or suppressing later jobs", async () => {
  const transport = fakeTransport((job) => job === "benefits-lifecycle"
    ? new Response("error code: 1102", { status: 503 }) : Response.json(result(job)));
  const report = await runMaintenance({ ...config, fetchImpl: transport.fetchImpl });
  assert.equal(report.success, false);
  assert.equal(report.stopped, false);
  assert.equal(report.results[0].code, "WORKER_RESOURCE_LIMIT_1102");
  assert.equal(transport.calls.filter((call) => call.job === "benefits-lifecycle").length, 1);
  assert.equal(report.results.at(-1).status, "success");
});

for (const variant of ["html", "unauthorized", "all-mode", "wrong-job", "missing-data", "bad-duration", "failed-with-200", "unexpected-failures"]) {
  test(`unsafe response stops subsequent jobs: ${variant}`, async () => {
    const transport = fakeTransport((job) => {
      if (variant === "html") return new Response("HTML containing private data");
      if (variant === "unauthorized") return Response.json({ error: "unauthorized" }, { status: 401 });
      const body = result(job);
      if (variant === "all-mode") body.execution.mode = "all";
      if (variant === "wrong-job") body.execution.jobs[0].job = "audit-integrity";
      if (variant === "missing-data") delete body.data;
      if (variant === "bad-duration") body.execution.jobs[0].durationMs = -1;
      if (variant === "failed-with-200") body.execution.jobs[0].status = "failed";
      if (variant === "unexpected-failures") body.failures = { private: token };
      return Response.json(body);
    });
    const report = await runMaintenance({ ...config, fetchImpl: transport.fetchImpl });
    assert.equal(report.success, false);
    assert.equal(report.stopped, true);
    assert.equal(transport.calls.length, 2);
    assert.ok(!JSON.stringify(report).includes(token));
  });
}

test("unknown transport outcome stops without retry and does not leak the exception", async () => {
  const logged = [];
  const transport = fakeTransport(() => { throw new Error(`Connection failed ${token}`); });
  const report = await runMaintenance({ ...config, fetchImpl: transport.fetchImpl, log: (entry) => logged.push(entry) });
  assert.equal(transport.calls.length, 2);
  assert.equal(report.stopped, true);
  assert.equal(report.results[0].code, "OUTCOME_UNKNOWN_CHECK_BEFORE_RETRY");
  assert.ok(!JSON.stringify(logged).includes(token));
});

test("timeout aborts the current request and never retries a potentially committed write", async () => {
  const transport = fakeTransport((_job, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }));
  const report = await runMaintenance({ ...config, fetchImpl: transport.fetchImpl, timeoutMs: 10 });
  assert.equal(report.stopped, true);
  assert.equal(transport.calls.length, 2);
});

test("oversized response is rejected without logging its content", async () => {
  const transport = fakeTransport(() => new Response("x".repeat(65 * 1024) + token));
  const report = await runMaintenance({ ...config, fetchImpl: transport.fetchImpl });
  assert.equal(report.stopped, true);
  assert.equal(transport.calls.length, 2);
  assert.ok(!JSON.stringify(report).includes(token));
});

test("invalid configuration prevents requests and local smoke is limited to explicit loopback", () => {
  for (const value of ["http://hrbp.example/api/internal/maintenance", "https://user:password@hrbp.example/api/internal/maintenance", `${url}?job=x`, `${url}#fragment`, `${url}/`, "file:///api/internal/maintenance"]) {
    assert.throws(() => validateConfiguration({ ...config, url: value }));
  }
  for (const value of ["short", `${token}\n`, undefined]) assert.throws(() => validateConfiguration({ ...config, token: value }));
  assert.throws(() => validateConfiguration({ ...config, job: "__proto__" }));
  assert.throws(() => validateConfiguration({ ...config, url: "http://10.0.0.1/api/internal/maintenance", localSmoke: true }));
  assert.throws(() => validateConfiguration({ ...config, url: "http://127.0.0.1:8787/api/internal/maintenance" }));
  assert.equal(validateConfiguration({ ...config, url: "http://127.0.0.1:8787/api/internal/maintenance", localSmoke: true }).selected.length, 11);
});

test("CI summary is built only from bounded job diagnostics", async () => {
  const transport = fakeTransport();
  const report = await runMaintenance({ ...config, job: "audit-integrity", fetchImpl: transport.fetchImpl });
  const summary = markdownSummary(report);
  assert.match(summary, /audit-integrity/);
  assert.match(summary, /Wall time/);
  assert.ok(!summary.includes(token));
  assert.ok(!summary.includes(url));
});
