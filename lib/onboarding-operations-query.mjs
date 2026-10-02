/** Positional cursors select a page; they never grant access to a plan. */
export const ONBOARDING_PAGE_VERSION = 1;
export function operationIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
function canonicalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
export function encodeOnboardingCursor(cursor) {
  if (!cursor || !canonicalDate(cursor.date) || !operationIdentifier(cursor.id)) throw new RangeError("Invalid onboarding cursor.");
  return JSON.stringify([ONBOARDING_PAGE_VERSION, cursor.date, cursor.id]);
}
export function parseOnboardingCursor(raw) {
  if (typeof raw !== "string" || raw.length > 1024) throw new RangeError("Invalid onboarding cursor.");
  let parts;
  try { parts = JSON.parse(raw); } catch { throw new RangeError("Invalid onboarding cursor."); }
  if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== ONBOARDING_PAGE_VERSION ||
      !canonicalDate(parts[1]) || !operationIdentifier(parts[2])) throw new RangeError("Invalid onboarding cursor.");
  return { date: parts[1], id: parts[2] };
}
export function parseOnboardingOperationsQuery(search) {
  const keys = [...search.keys()];
  if (keys.some((key) => !["after", "plan", "task"].includes(key)) || new Set(keys).size !== keys.length) {
    throw new RangeError("Unsupported or repeated onboarding query parameter.");
  }
  if (search.has("after") && (search.has("plan") || search.has("task"))) throw new RangeError("Paging and focus cannot be combined.");
  if (search.has("plan") || search.has("task")) {
    const planId = search.has("plan") ? operationIdentifier(search.get("plan")) : undefined;
    const taskId = search.has("task") ? operationIdentifier(search.get("task")) : undefined;
    if (planId === null || taskId === null) throw new RangeError("Invalid onboarding focus.");
    return { mode: "focus", planId, taskId };
  }
  return { mode: "list", after: search.has("after") ? parseOnboardingCursor(search.get("after")) : null };
}
/** This predicate MUST be intersected with both tenant and population/queue eligibility. */
export function onboardingOperationsPredicate(options, tenantId) {
  if (options.mode === "focus") return {
    ...(options.planId ? { id: options.planId } : {}),
    ...(options.taskId ? { tasks: { some: { id: options.taskId, tenantId } } } : {})
  };
  if (!options.after) return {};
  const date = new Date(options.after.date);
  return { OR: [{ targetStartDate: { gt: date } }, { targetStartDate: date, id: { gt: options.after.id } }] };
}
