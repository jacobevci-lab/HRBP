import { createHash } from "node:crypto";
import { DataClassification, EmploymentStatus, OnboardingStatus, OnboardingTaskStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { canAccessOnboardingPlan, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import { getRequestContext, mutationOriginAllowed } from "@/lib/request-context";

const openPlanStates = [OnboardingStatus.NOT_STARTED, OnboardingStatus.IN_PROGRESS, OnboardingStatus.BLOCKED];
const openTaskStates = [OnboardingTaskStatus.NOT_STARTED, OnboardingTaskStatus.IN_PROGRESS, OnboardingTaskStatus.BLOCKED];
const teamTypes = ["HR", "IT", "MANAGER", "SECURITY", "EMPLOYEE", "FACILITIES", "PAYROLL", "FINANCE", "LEGAL"];
const BODY_LIMIT = 8192;
type Mode = "create" | "deadline";
class PlanningError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function fail(code: string, status = 400): never { throw new PlanningError(code, status); }
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) fail("INVALID_INPUT");
  return value;
}
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail("INVALID_INPUT");
  return value.trim();
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") fail("JSON_REQUIRED", 415);
  if (!request.body) fail("INVALID_INPUT");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let source = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_LIMIT) { await reader.cancel(); fail("BODY_TOO_LARGE", 413); }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    const body: unknown = JSON.parse(source);
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("INVALID_INPUT");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PlanningError) throw error;
    return fail("INVALID_INPUT");
  } finally { reader.releaseLock(); }
}
function parse(body: Record<string, unknown>, mode: Mode) {
  const allowed = mode === "create"
    ? ["title", "ownerType", "sensitive", "dueDate", "reason", "requestId", "expectedPlanStatus"]
    : ["dueDate", "reason", "expectedPlanStatus", "expectedTaskStatus"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) fail("INVALID_INPUT");
  const reason = text(body.reason, 10, 500);
  if (!openPlanStates.includes(body.expectedPlanStatus as OnboardingStatus)) fail("INVALID_INPUT");
  // Canonical UTC only. Invalid calendar dates, implicit time zones and offsets
  // must not silently normalize into a different deadline.
  if (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.dueDate)) fail("INVALID_INPUT");
  const dueDate = new Date(body.dueDate);
  if (!Number.isFinite(dueDate.getTime()) || dueDate.toISOString() !== body.dueDate) fail("INVALID_INPUT");
  const base = { reason, dueDate, expectedPlanStatus: body.expectedPlanStatus as OnboardingStatus };
  if (mode === "deadline") {
    if (!openTaskStates.includes(body.expectedTaskStatus as OnboardingTaskStatus)) fail("INVALID_INPUT");
    return { ...base, expectedTaskStatus: body.expectedTaskStatus as OnboardingTaskStatus, title: "", ownerType: "", sensitive: false, requestId: "" };
  }
  const title = text(body.title, 1, 200);
  if (typeof body.ownerType !== "string" || !teamTypes.includes(body.ownerType) || typeof body.sensitive !== "boolean") fail("INVALID_INPUT");
  if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) fail("INVALID_INPUT");
  return { ...base, title, ownerType: body.ownerType, sensitive: body.sensitive, requestId: body.requestId.toLowerCase(), expectedTaskStatus: OnboardingTaskStatus.NOT_STARTED };
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
const messages: Record<string, string> = {
  UNAUTHORIZED: "Sign in to manage onboarding tasks.", FORBIDDEN: "Onboarding task planning is not permitted.",
  INVALID_INPUT: "Provide the supported fields, a valid UTC deadline and a reason of 10–500 characters.",
  JSON_REQUIRED: "An application/json body is required.", BODY_TOO_LARGE: "The request exceeds 8 KiB.",
  NOT_FOUND: "The record is not available in your onboarding scope.",
  PLAN_LOCKED: "Only open plans linked to a preboarding employment can be planned.",
  CONFLICT: "The record changed or this creation request was already used. Refresh before another action.",
  DEADLINE_EXISTS: "This task already has a deadline. Existing deadlines cannot be postponed or replaced here.",
  TASK_LOCKED: "Completed or waived tasks cannot be scheduled.",
  FAILED: "The planning operation could not be completed. Refresh and check its outcome before retrying."
};

export async function handleOnboardingTaskPlanning(request: Request, params: Promise<{ id: string }>, mode: Mode) {
  const ctx = getRequestContext(request);
  if (!ctx) return json({ code: "UNAUTHORIZED", error: messages.UNAUTHORIZED }, 401);
  if (!mutationOriginAllowed(request) || !can(ctx, "onboarding:read") || !can(ctx, "onboarding:write")) {
    return json({ code: "FORBIDDEN", error: messages.FORBIDDEN }, 403);
  }
  try {
    const id = identifier((await params).id);
    const input = parse(await readBody(request), mode);
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const task = mode === "deadline" ? await tx.onboardingTask.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, planId: true, status: true, dueDate: true, sensitive: true }
      }) : null;
      if (mode === "deadline" && !task) fail("NOT_FOUND", 404);
      const planId = task?.planId ?? id;
      const plan = await tx.onboardingPlan.findFirst({
        where: { id: planId, tenantId: ctx.tenantId },
        select: { id: true, personId: true, employmentId: true, status: true,
          employment: { select: { tenantId: true, personId: true, status: true } } }
      });
      const scope = await resolveOnboardingPopulationScope(tx, ctx);
      if (!plan || !canAccessOnboardingPlan(scope, plan)) fail("NOT_FOUND", 404);
      if (!openPlanStates.includes(plan.status) || !plan.employmentId ||
          plan.employment?.status !== EmploymentStatus.PREBOARDING || plan.employment.tenantId !== ctx.tenantId ||
          plan.employment.personId !== plan.personId) fail("PLAN_LOCKED", 409);
      if (plan.status !== input.expectedPlanStatus) fail("CONFLICT", 409);

      // This planning API cannot complete/waive/reopen tasks, activate employment,
      // remove controls or alter a previously assigned deadline.
      if (task) {
        if (!openTaskStates.includes(task.status)) fail("TASK_LOCKED", 409);
        if (task.status !== input.expectedTaskStatus) fail("CONFLICT", 409);
        if (task.dueDate !== null) fail("DEADLINE_EXISTS", 409);
        const updated = await tx.onboardingTask.updateMany({
          where: { id: task.id, tenantId: ctx.tenantId, planId: plan.id, status: task.status, dueDate: null },
          data: { dueDate: input.dueDate }
        });
        if (updated.count !== 1) fail("CONFLICT", 409);
        await appendAudit(tx, ctx, {
          action: "onboarding-task.deadline-assigned", resourceType: "OnboardingTask", resourceId: task.id,
          classification: task.sensitive ? DataClassification.RESTRICTED : DataClassification.CONFIDENTIAL,
          purpose: JSON.stringify({ reason: input.reason, previousDueDate: null, dueDate: input.dueDate.toISOString() })
        });
        return { id: task.id, planId: plan.id, status: task.status, dueDate: input.dueDate.toISOString() };
      }
      // Scoped deterministic identity prevents a network retry with the same
      // requestId from creating a second control. A replay is a 409, not a claim
      // that the original payload was applied again. No POST is auto-retried.
      const taskId = `onbp_${createHash("sha256").update(JSON.stringify([ctx.tenantId, ctx.actorId, plan.id, input.requestId])).digest("hex")}`;
      const created = await tx.onboardingTask.create({
        data: { id: taskId, tenantId: ctx.tenantId, planId: plan.id, title: input.title, ownerType: input.ownerType,
          sensitive: input.sensitive, dueDate: input.dueDate, status: OnboardingTaskStatus.NOT_STARTED },
        select: { id: true, status: true }
      });
      await appendAudit(tx, ctx, {
        action: "onboarding-task.created", resourceType: "OnboardingTask", resourceId: created.id,
        classification: input.sensitive ? DataClassification.RESTRICTED : DataClassification.CONFIDENTIAL,
        purpose: JSON.stringify({ reason: input.reason, ownerType: input.ownerType, dueDate: input.dueDate.toISOString(), sensitive: input.sensitive })
      });
      return { id: created.id, planId: plan.id, status: created.status, dueDate: input.dueDate.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 }));
    return json({ data }, mode === "create" ? 201 : 200);
  } catch (error) {
    if (error instanceof PlanningError) return json({ code: error.code, error: messages[error.code] }, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      return json({ code: "CONFLICT", error: messages.CONFLICT }, 409);
    }
    console.error("[HRBP] Onboarding task planning failed; check transactional diagnostics.");
    return json({ code: "FAILED", error: messages.FAILED }, 500);
  }
}
