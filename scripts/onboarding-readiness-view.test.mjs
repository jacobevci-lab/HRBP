import test from "node:test";
import assert from "node:assert/strict";
import { buildOnboardingReadiness, filterOnboardingReadiness, startRiskHours, READINESS_FILTERS } from "../lib/onboarding-readiness-view.mjs";
const now = Date.parse("2026-10-02T12:00:00.000Z");
const iso = (offset = 0) => new Date(now + offset).toISOString();
function task(overrides = {}) { return { id: "task-1", planId: "plan-1", title: "Laptop setup", ownerType: "IT", status: "COMPLETED", dueDate: iso(-1000), sensitive: false, ...overrides }; }
function plan(overrides = {}) { return { id: "plan-1", person: "İpek | Kaya", employeeNumber: "EMP|001", planStatus: "COMPLETED", employmentStatus: "PREBOARDING", targetStartDate: iso(), employmentStartDate: iso(), totalTasks: 1, ...overrides }; }
function snapshot(planChanges = {}, taskChanges = {}, extras = {}) {
  return { generatedAt: iso(), startRiskHours: 72, plans: [plan(planChanges)], tasks: [task(taskChanges)], ...extras };
}
const project = (p = {}, t = {}, extras = {}) => buildOnboardingReadiness(snapshot(p, t, extras));

test("completed plan with both dates reached is ready but never automatically activated", () => {
  const input = snapshot();
  const before = JSON.stringify(input);
  const result = buildOnboardingReadiness(input);
  assert.equal(result.plans[0].ready, true);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.waiting, 0);
  assert.equal(result.plans[0].clearancePercent, 100);
  assert.equal(JSON.stringify(input), before);
});
for (const field of ["targetStartDate", "employmentStartDate"]) {
  test(`future ${field} remains waiting, not ready`, () => {
    const result = project({ [field]: iso(1) });
    assert.equal(result.summary.ready, 0);
    assert.equal(result.summary.waiting, 1);
    assert.equal(result.plans[0].needsReview, false);
  });
  test(`${field} boundary is inclusive at the exact instant`, () => assert.equal(project({ [field]: iso() }).plans[0].ready, true));
  for (const value of [null, "", "invalid"]) {
    test(`invalid ${field}: ${JSON.stringify(value)} fails closed`, () => {
      const p = project({ [field]: value }).plans[0];
      assert.equal(p.ready, false); assert.equal(p.waiting, false); assert.ok(p.issues.includes("dates"));
    });
  }
}

test("empty plans survive projection and cannot become ready through vacuous all-tasks completion", () => {
  const view = project({ totalTasks: 0 }, {}, { tasks: [] });
  assert.equal(view.summary.plans, 1); assert.equal(view.summary.tasks, 0);
  assert.equal(view.plans[0].ready, false); assert.equal(view.plans[0].clearancePercent, null);
  assert.ok(view.plans[0].issues.includes("no-tasks"));
});
for (const totalTasks of [2, -1, 0.5, NaN]) {
  test(`incomplete or invalid declared task total ${totalTasks} cannot claim readiness`, () => {
    const p = project({ totalTasks }).plans[0];
    assert.equal(p.incomplete, true); assert.equal(p.ready, false); assert.equal(p.clearancePercent, null);
  });
}
for (const status of ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "UNKNOWN"]) {
  test(`completed plan with ${status} task is inconsistent and cannot activate`, () => {
    const p = project({}, { status }).plans[0];
    assert.equal(p.ready, false); assert.ok(p.issues.includes("state-mismatch"));
  });
}
for (const status of [null, "ACTIVE", "LEAVE", "TERMINATED", "SUSPENDED"]) {
  test(`employment state ${status} cannot be activated by this view`, () => assert.equal(project({ employmentStatus: status }).plans[0].ready, false));
}

test("completed and waived are separate counts; clearance is not an assertion of completion evidence", () => {
  const v = project({ totalTasks: 2 }, {}, { tasks: [task(), task({ id: "waiver", status: "WAIVED" })] });
  assert.equal(v.plans[0].completed, 1); assert.equal(v.plans[0].waived, 1); assert.equal(v.plans[0].clearancePercent, 100);
  assert.equal(v.plans[0].ready, true); assert.equal(v.summary.overdue, 0);
});

test("missing deadlines are explicitly unscheduled and are not treated as policy-derived dates", () => {
  const p = project({ planStatus: "IN_PROGRESS" }, { status: "IN_PROGRESS", dueDate: null }).plans[0];
  assert.equal(p.unscheduled, 1); assert.equal(p.overdue, 0); assert.ok(p.issues.includes("unscheduled"));
});
for (const [offset, overdue] of [[-1, 1], [0, 0], [1, 0]]) {
  test(`deadline offset ${offset} has ${overdue} overdue tasks`, () => assert.equal(project({ planStatus: "IN_PROGRESS" }, { status: "IN_PROGRESS", dueDate: iso(offset) }).summary.overdue, overdue));
}
for (const [offset, risk] of [[72 * 3_600_000, true], [72 * 3_600_000 + 1, false], [-1, true]]) {
  test(`start-risk boundary ${offset} -> ${risk}`, () => assert.equal(project({ planStatus: "IN_PROGRESS", targetStartDate: iso(offset) }, { status: "IN_PROGRESS" }).plans[0].startRisk, risk));
}

test("configured horizon, not a fixed 72 hours, drives risk", () => {
  const input = snapshot({ planStatus: "IN_PROGRESS", targetStartDate: iso(25 * 3_600_000) }, { status: "IN_PROGRESS" }, { startRiskHours: 24 });
  assert.equal(buildOnboardingReadiness(input).plans[0].startRisk, false);
  input.startRiskHours = 48;
  assert.equal(buildOnboardingReadiness(input).plans[0].startRisk, true);
});

test("risk settings use the same documented 1..336 hour clamp and default", () => {
  assert.equal(startRiskHours(NaN), 72); assert.equal(startRiskHours(Infinity), 72);
  assert.equal(startRiskHours(0), 1); assert.equal(startRiskHours(999), 336); assert.equal(startRiskHours(24.9), 24);
});

test("identity grouping never parses person names or employee numbers as delimiters", () => {
  const v = project();
  assert.equal(v.plans[0].person, "İpek | Kaya"); assert.equal(v.plans[0].employeeNumber, "EMP|001");
  assert.equal(v.plans[0].id, "plan-1");
});

test("unknown plan states and stale cleared-but-not-complete plans require review", () => {
  assert.ok(project({ planStatus: "UNKNOWN" }).plans[0].issues.includes("unknown-state"));
  assert.equal(project({ planStatus: "IN_PROGRESS" }).plans[0].ready, false);
  assert.ok(project({ planStatus: "IN_PROGRESS" }).plans[0].issues.includes("state-mismatch"));
});

test("duplicate plan identities and orphan tasks are rejected rather than silently grouped", () => {
  assert.throws(() => project({}, {}, { plans: [plan(), plan()] }), TypeError);
  assert.throws(() => project({}, { planId: "outside-visible-scope" }), TypeError);
});

test("duplicate task rows cannot inflate apparent completion", () => {
  const p = project({ totalTasks: 2 }, {}, { tasks: [task(), task()] }).plans[0];
  assert.equal(p.incomplete, true); assert.equal(p.ready, false);
});

test("filtering selects whole plans and cannot remove a blocker from a matching IT plan", () => {
  const v = project({ planStatus: "BLOCKED", totalTasks: 2 }, {}, { tasks: [task(), task({ id: "blocker", title: "Badge approval", ownerType: "SECURITY", status: "BLOCKED" })] });
  const selected = filterOnboardingReadiness(v.plans, { owner: "IT", query: "Laptop" });
  assert.equal(selected.length, 1); assert.equal(selected[0].tasks.length, 2); assert.equal(selected[0].blocked, 1);
  assert.equal(selected[0].totalTasks, 2); assert.equal(v.summary.blocked, 1);
});

test("Turkish search handles dotted I and canonical unicode", () => {
  const plans = project().plans;
  assert.equal(filterOnboardingReadiness(plans, { query: "İPEK", locale: "tr" }).length, 1);
  assert.equal(filterOnboardingReadiness(plans, { query: "İpek".normalize("NFD"), locale: "tr" }).length, 1);
  assert.equal(filterOnboardingReadiness(plans, { query: "EMP|001" }).length, 1);
  assert.equal(filterOnboardingReadiness(plans, { query: "LAPTOP" }).length, 1);
});

test("all readiness filters have explicit semantics; unsupported ones do not silently broaden", () => {
  const ready = project().plans;
  const blocked = project({ planStatus: "BLOCKED" }, { status: "BLOCKED" }).plans;
  const waiting = project({ targetStartDate: iso(1) }).plans;
  assert.ok(Object.isFrozen(READINESS_FILTERS));
  assert.equal(filterOnboardingReadiness(ready, { filter: "ready" }).length, 1);
  assert.equal(filterOnboardingReadiness(ready, { filter: "blocked" }).length, 0);
  for (const filter of ["blocked", "overdue", "start-risk"]) assert.equal(filterOnboardingReadiness(blocked, { filter }).length, 1);
  assert.equal(filterOnboardingReadiness(waiting, { filter: "waiting" }).length, 1);
  assert.equal(filterOnboardingReadiness(project({ totalTasks: 0 }, {}, { tasks: [] }).plans, { filter: "review" }).length, 1);
  assert.throws(() => filterOnboardingReadiness(ready, { filter: "unsupported" }), RangeError);
});

test("search, owner and status combine without changing snapshot counts", () => {
  const v = project();
  assert.equal(filterOnboardingReadiness(v.plans, { filter: "ready", owner: " hr ", query: "İpek", locale: "tr" }).length, 0);
  assert.equal(v.summary.plans, 1); assert.equal(v.summary.ready, 1);
});

test("risk ordering is deterministic and does not mutate input plan order", () => {
  const input = snapshot({}, {}, {
    plans: [plan({ id: "ready" }), plan({ id: "risk", planStatus: "IN_PROGRESS" })],
    tasks: [task({ planId: "ready" }), task({ id: "risk-task", planId: "risk", status: "IN_PROGRESS" })]
  });
  assert.deepEqual(buildOnboardingReadiness(input).plans.map((p) => p.id), ["risk", "ready"]);
  assert.deepEqual(input.plans.map((p) => p.id), ["ready", "risk"]);
});

test("the snapshot clock is used by default and can be advanced deterministically", () => {
  const input = snapshot({ employmentStartDate: iso(1000) });
  assert.equal(buildOnboardingReadiness(input).summary.ready, 0);
  assert.equal(buildOnboardingReadiness(input, now + 1000).summary.ready, 1);
  assert.throws(() => buildOnboardingReadiness({ ...input, generatedAt: "invalid" }), TypeError);
});
