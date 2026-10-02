/** Read-only operational projection. Never grants authority or changes lifecycle state. */
export const READINESS_FILTERS = Object.freeze(["all", "blocked", "overdue", "start-risk", "ready", "waiting", "review"]);
const terminal = new Set(["COMPLETED", "WAIVED"]);
const taskStates = new Set(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", ...terminal]);
const planStates = new Set(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED"]);
const hour = 3_600_000;

export function startRiskHours(value) {
  return Math.min(336, Math.max(1, Math.floor(Number.isFinite(value) ? value : 72)));
}
function instant(value) {
  return typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
}
function normalize(value, locale) {
  return String(value ?? "").normalize("NFC").toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-GB");
}

export function buildOnboardingReadiness(snapshot, now = instant(snapshot.generatedAt)) {
  if (!Number.isFinite(now)) throw new TypeError("A valid readiness evaluation time is required.");
  const hours = startRiskHours(snapshot.startRiskHours);
  const byPlan = new Map();
  for (const task of snapshot.tasks) {
    const items = byPlan.get(task.planId) ?? [];
    items.push(task);
    byPlan.set(task.planId, items);
  }
  const seenPlans = new Set();
  const plans = snapshot.plans.map((plan) => {
    if (!plan.id || seenPlans.has(plan.id)) throw new TypeError("Unique plan identities are required.");
    seenPlans.add(plan.id);
    const tasks = byPlan.get(plan.id) ?? [];
    const ids = new Set(tasks.map((task) => task.id));
    const incomplete = !Number.isInteger(plan.totalTasks) || plan.totalTasks < 0 ||
      tasks.length !== plan.totalTasks || ids.size !== tasks.length;
    const completed = tasks.filter((task) => task.status === "COMPLETED").length;
    const waived = tasks.filter((task) => task.status === "WAIVED").length;
    const openTasks = tasks.filter((task) => !terminal.has(task.status));
    const blocked = openTasks.filter((task) => task.status === "BLOCKED").length;
    const overdue = openTasks.filter((task) => Number.isFinite(instant(task.dueDate)) && instant(task.dueDate) < now).length;
    const unscheduled = openTasks.filter((task) => !Number.isFinite(instant(task.dueDate))).length;
    const unknown = tasks.some((task) => !taskStates.has(task.status)) || !planStates.has(plan.planStatus);
    const start = instant(plan.targetStartDate);
    const employmentStart = instant(plan.employmentStartDate);
    const datesValid = Number.isFinite(start) && Number.isFinite(employmentStart);
    const cleared = !incomplete && !unknown && tasks.length > 0 && openTasks.length === 0;
    const inconsistent = (plan.planStatus === "COMPLETED" && !cleared) ||
      (plan.planStatus !== "COMPLETED" && cleared) || (plan.planStatus === "BLOCKED" && blocked === 0);
    const issues = [];
    if (incomplete) issues.push("incomplete");
    if (plan.totalTasks === 0) issues.push("no-tasks");
    if (!plan.employmentStatus) issues.push("unlinked");
    if (!datesValid) issues.push("dates");
    if (unknown) issues.push("unknown-state");
    if (inconsistent) issues.push("state-mismatch");
    if (unscheduled) issues.push("unscheduled");
    const handoff = cleared && !inconsistent && datesValid && plan.planStatus === "COMPLETED" && plan.employmentStatus === "PREBOARDING";
    const ready = handoff && start <= now && employmentStart <= now;
    const waiting = handoff && !ready;
    const startRisk = plan.planStatus !== "COMPLETED" && Number.isFinite(start) && start <= now + hours * hour;
    return { ...plan, tasks, completed, waived, blocked, overdue, unscheduled,
      open: openTasks.length, incomplete, issues, needsReview: issues.length > 0,
      ready, waiting, startRisk, clearancePercent: !incomplete && tasks.length > 0
        ? Math.floor((completed + waived) * 100 / tasks.length) : null };
  });
  // Malformed joins must not turn detached tasks into a seemingly healthy plan.
  if ([...byPlan.keys()].some((id) => !seenPlans.has(id))) throw new TypeError("Every task must belong to a visible plan.");
  plans.sort((a, b) => {
    const rank = (p) => p.blocked || p.overdue || p.startRisk ? 0 : p.needsReview ? 1 : p.ready ? 2 : p.waiting ? 3 : 4;
    const date = (p) => Number.isFinite(instant(p.targetStartDate)) ? instant(p.targetStartDate) : Number.MAX_SAFE_INTEGER;
    return rank(a) - rank(b) || date(a) - date(b) || a.id.localeCompare(b.id);
  });
  const count = (predicate) => plans.filter(predicate).length;
  return { plans, startRiskHours: hours, summary: {
    plans: plans.length, tasks: snapshot.tasks.length,
    blocked: plans.reduce((n, p) => n + p.blocked, 0),
    overdue: plans.reduce((n, p) => n + p.overdue, 0),
    startRisk: count((p) => p.startRisk), ready: count((p) => p.ready),
    waiting: count((p) => p.waiting), review: count((p) => p.needsReview)
  } };
}

/** Select whole plans: filtering must never hide a blocker or alter a denominator. */
export function filterOnboardingReadiness(plans, { filter = "all", owner = "", query = "", locale = "en" } = {}) {
  if (!READINESS_FILTERS.includes(filter)) throw new RangeError("Unsupported readiness filter.");
  const needle = normalize(query.slice(0, 200).trim(), locale);
  const ownerKey = owner.trim().toUpperCase();
  return plans.filter((plan) => {
    const matches = filter === "all" || (filter === "blocked" && plan.blocked > 0) ||
      (filter === "overdue" && plan.overdue > 0) || (filter === "start-risk" && plan.startRisk) ||
      (filter === "ready" && plan.ready) || (filter === "waiting" && plan.waiting) ||
      (filter === "review" && plan.needsReview);
    const ownerMatches = !ownerKey || plan.tasks.some((task) => task.ownerType.trim().toUpperCase() === ownerKey);
    const searchMatches = !needle || [plan.person, plan.employeeNumber, ...plan.tasks.map((task) => task.title)]
      .some((value) => normalize(value, locale).includes(needle));
    return matches && ownerMatches && searchMatches;
  });
}
