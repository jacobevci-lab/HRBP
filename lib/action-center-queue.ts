import type { ActionQueue, LifecycleActionItem, ActionKind, ActionSummary } from "./action-center-queue-types";

const kinds = new Set<ActionKind>(["workflow", "hr-service", "employee-relations", "documents", "onboarding", "offboarding", "leave", "time-attendance", "compensation", "payroll", "benefits", "performance", "learning", "development-plan", "succession", "recruiting", "policies", "workforce-planning", "privacy", "engagement"]);
const summaryKeys: (keyof ActionSummary)[] = ["total", "overdue", "dueSoon", "critical", "workflow", "hrService", "employeeRelations", "documents", "onboarding", "offboarding", "leave", "timeAttendance", "compensation", "payroll", "benefits", "performance", "learning", "developmentPlans", "succession", "recruiting", "policies", "workforcePlanning", "privacy", "engagement"];
type PrimaryType = NonNullable<LifecycleActionItem["action"]>["type"];
type SecondaryType = NonNullable<LifecycleActionItem["secondaryAction"]>["type"];
const primaryIds: Record<PrimaryType, readonly string[]> = {
  "complete-workflow": ["instanceId", "taskId"], "approve-leave": ["requestId"], "approve-time": ["entryId"],
  "approve-compensation": ["changeId"], "apply-compensation": ["changeId"], "approve-payroll": ["runId"], "mark-payroll-paid": ["runId"],
  "approve-requisition": ["requisitionId"], "approve-offer": ["offerId"], "approve-policy": ["policyId"],
  "approve-workforce-scenario": ["scenarioId"], "activate-workflow-definition": ["definitionId"],
  "open-engagement-campaign": ["campaignId"], "close-engagement-campaign": ["campaignId"],
  "begin-dsr-verification": ["dsrId"], "verify-dsr": ["dsrId"], "wait-dsr": ["dsrId"], "resume-dsr": ["dsrId"],
  "start-privacy-assessment": ["assessmentId"], "wait-privacy-assessment": ["assessmentId"], "resume-privacy-assessment": ["assessmentId"],
  "advance-hr-service": ["requestId"], "advance-onboarding-task": ["taskId"], "activate-benefit-enrollment": ["enrollmentId"],
  "start-learning-assignment": ["assignmentId"], "start-performance-self-review": ["reviewId"], "activate-onboarding-employment": ["planId"],
  "advance-offboarding-task": ["processId", "taskId"], "start-er-corrective-action": ["caseId", "actionId"],
  "activate-development-plan": ["planId"], "start-er-appeal-review": ["caseId", "appealId"]
};
const secondaryIds: Record<SecondaryType, readonly string[]> = {
  "reject-leave": ["requestId"], "reject-time": ["entryId"], "reject-compensation": ["changeId"],
  "return-requisition": ["requisitionId"], "return-offer": ["offerId"], "request-policy-changes": ["policyId"],
  "request-workforce-changes": ["scenarioId"], "retire-workflow-definition": ["definitionId"], "return-engagement-draft": ["campaignId"]
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.trim().length > 0) && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function id(value: unknown): value is string {
  return text(value, 256) && value.trim() === value && !/[\r\n\t]/.test(value) && value !== "." && value !== "..";
}
function date(value: unknown): value is string {
  return text(value, 40) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function moduleLink(value: unknown): value is string {
  if (!text(value, 4096) || /[\s\\]/.test(value) || !value.startsWith("/module/")) return false;
  try {
    const url = new URL(value, "https://queue.invalid");
    // Only canonical module paths; query strings retain their exact focus parameters.
    return url.origin === "https://queue.invalid" && /^\/module\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(url.pathname)
      && value.split(/[?#]/, 1)[0] === url.pathname;
  } catch { return false; }
}
function action(value: unknown, secondary = false): boolean {
  if (value === null || (secondary && value === undefined)) return true;
  if (!object(value) || typeof value.type !== "string") return false;
  const specs: Record<string, readonly string[]> = secondary ? secondaryIds : primaryIds;
  if (!Object.hasOwn(specs, value.type) || !specs[value.type].every(key => id(value[key]))) return false;
  if (value.type === "advance-hr-service") return value.status === "TRIAGE" || value.status === "IN_PROGRESS";
  if (value.type === "advance-onboarding-task" || value.type === "advance-offboarding-task") return value.status === "IN_PROGRESS" || value.status === "COMPLETED";
  return true;
}

/** Reject an incomplete snapshot as a whole: never turn missing data into an empty queue. */
export function decodeActionQueue(value: unknown): ActionQueue | null {
  if (!object(value) || Object.hasOwn(value, "error") || !object(value.data)) return null;
  const data = value.data;
  if (!Array.isArray(data.items) || data.items.length > 5000 || !object(data.summary) || !date(data.generatedAt)) return null;
  if (!summaryKeys.every(key => Number.isSafeInteger(data.summary && (data.summary as Record<string, unknown>)[key]) && Number((data.summary as Record<string, unknown>)[key]) >= 0)) return null;
  const seen = new Set<string>();
  for (const item of data.items) {
    if (!object(item) || !id(item.id) || seen.has(item.id) || !kinds.has(item.kind as ActionKind)
      || !text(item.title, 4096) || !text(item.subtitle, 8192, true) || !text(item.module, 128)
      || !text(item.subjectType, 128) || !text(item.subjectId, 512, true) || !text(item.status, 128)
      || !moduleLink(item.href) || !date(item.createdAt) || (item.dueAt !== null && !date(item.dueAt))
      || !["normal", "warning", "critical"].includes(item.urgency as string)
      || !action(item.action) || !action(item.secondaryAction, true)) return null;
    seen.add(item.id);
  }
  // Validated all fields consumed by the view. Counts may exceed a bounded item list.
  return data as ActionQueue;
}

type Failure = "session" | "access" | "unavailable";
export type QueueReadResult = { outcome: "loaded"; data: ActionQueue } | { outcome: "unavailable"; reason: Failure } | { outcome: "ignored" };
const MAX_BYTES = 4 * 1024 * 1024;

/** Each read replaces the previous read. The transport can ignore abort without winning the race. */
export function createActionQueueLoader(options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  let generation = 0, controller: AbortController | null = null, ready = false;
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("Invalid queue timeout");
  return {
    get ready() { return ready; },
    invalidate() { generation++; ready = false; controller?.abort(); controller = null; },
    async load(): Promise<QueueReadResult> {
      const own = ++generation;
      ready = false;
      controller?.abort();
      const active = new AbortController();
      controller = active;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const aborted = new Promise<never>((_, reject) => {
        active.signal.addEventListener("abort", () => reject(new Error("Queue read stopped")), { once: true });
        timer = setTimeout(() => active.abort(), timeoutMs);
      });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const work = (async (): Promise<QueueReadResult> => {
          const response = await (options.fetchImpl ?? fetch)("/api/action-center", {
            method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: active.signal,
            headers: { accept: "application/json" }
          });
          if (active.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("Stopped"); }
          if (response.status === 401 || response.status === 403) {
            void response.body?.cancel().catch(() => {});
            return { outcome: "unavailable", reason: response.status === 401 ? "session" : "access" };
          }
          if (response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
            void response.body?.cancel().catch(() => {}); throw new Error("Invalid queue response");
          }
          reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let bytes = 0, body = "";
          while (true) {
            const chunk = await reader.read();
            if (active.signal.aborted) throw new Error("Stopped");
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_BYTES) throw new Error("Queue response too large");
            body += decoder.decode(chunk.value, { stream: true });
          }
          body += decoder.decode();
          const data = decodeActionQueue(JSON.parse(body));
          if (!data) throw new Error("Invalid queue snapshot");
          return { outcome: "loaded", data };
        })();
        const result = await Promise.race([work, aborted]);
        if (own !== generation) return { outcome: "ignored" };
        ready = result.outcome === "loaded";
        return result;
      } catch {
        return own === generation ? { outcome: "unavailable", reason: "unavailable" } : { outcome: "ignored" };
      } finally {
        clearTimeout(timer);
        if (reader) { void reader.cancel().catch(() => {}); }
        if (own === generation) controller = null;
      }
    }
  };
}

export function queueFailureMessage(reason: Failure, locale: string): string {
  if (reason === "session") return locale === "tr" ? "Oturum doğrulanamadı. Yeniden giriş yapıp listeyi yükle." : "Your session could not be verified. Sign in again and reload the queue.";
  if (reason === "access") return locale === "tr" ? "Bu aksiyon kuyruğuna erişim doğrulanamadı. Yetkilerini kontrol edip yeniden dene." : "Access to this action queue could not be verified. Check your access and try again.";
  return locale === "tr" ? "Aksiyon listesi doğrulanamadı. Hızlı işlemler kapalı; listeyi yeniden yüklemek için Yenile düğmesini kullan." : "The action queue could not be verified. Quick actions are disabled; use Refresh to reload the list.";
}
