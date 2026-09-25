import { DataClassification, OnboardingStatus, OnboardingTaskStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { canAccessOnboardingPlan, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const transitions: Record<OnboardingTaskStatus, OnboardingTaskStatus[]> = {
  NOT_STARTED: [OnboardingTaskStatus.IN_PROGRESS, OnboardingTaskStatus.BLOCKED, OnboardingTaskStatus.COMPLETED, OnboardingTaskStatus.WAIVED],
  IN_PROGRESS: [OnboardingTaskStatus.BLOCKED, OnboardingTaskStatus.COMPLETED, OnboardingTaskStatus.WAIVED],
  BLOCKED: [OnboardingTaskStatus.IN_PROGRESS, OnboardingTaskStatus.WAIVED],
  COMPLETED: [],
  WAIVED: []
};

function parseStatus(value: unknown): OnboardingTaskStatus | null {
  return asEnumValue(value, Object.values(OnboardingTaskStatus));
}

function derivePlanStatus(statuses: OnboardingTaskStatus[]): OnboardingStatus {
  if (statuses.length && statuses.every((status) => status === OnboardingTaskStatus.COMPLETED || status === OnboardingTaskStatus.WAIVED)) return OnboardingStatus.COMPLETED;
  if (statuses.some((status) => status === OnboardingTaskStatus.BLOCKED)) return OnboardingStatus.BLOCKED;
  if (statuses.some((status) => status !== OnboardingTaskStatus.NOT_STARTED)) return OnboardingStatus.IN_PROGRESS;
  return OnboardingStatus.NOT_STARTED;
}

function transitionRequiresReason(status: OnboardingTaskStatus) {
  return status === OnboardingTaskStatus.BLOCKED || status === OnboardingTaskStatus.WAIVED;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "onboarding:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid onboarding task id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = parseStatus(body.status);
  if (!next) return Response.json({ error: "A valid onboarding task status is required." }, { status: 400 });
  const note = asOptionalText(body.note, 500);
  if (note === null) return Response.json({ error: "The transition note must be 500 characters or fewer." }, { status: 400 });
  if (transitionRequiresReason(next) && !note) {
    return Response.json({ error: next === OnboardingTaskStatus.WAIVED ? "A waiver reason is required." : "A blocker reason is required." }, { status: 400 });
  }

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const task = await tx.onboardingTask.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          planId: true,
          status: true,
          title: true,
          sensitive: true,
          plan: { select: { status: true, employmentId: true, personId: true } }
        }
      });
      if (!task) throw new Error("TASK_NOT_FOUND");
      const population = await resolveOnboardingPopulationScope(tx, ctx);
      if (!canAccessOnboardingPlan(population, task.plan)) throw new Error("OUT_OF_SCOPE");
      if (!transitions[task.status].includes(next)) throw new Error("INVALID_TRANSITION");

      const updatedTask = await tx.onboardingTask.updateMany({
        where: { id: task.id, tenantId: ctx.tenantId, status: task.status },
        data: { status: next }
      });
      if (updatedTask.count !== 1) throw new Error("STATE_CONFLICT");

      const planTasks = await tx.onboardingTask.findMany({
        where: { planId: task.planId, tenantId: ctx.tenantId },
        select: { status: true }
      });
      const planStatus = derivePlanStatus(planTasks.map((item) => item.status));

      if (planStatus !== task.plan.status) {
        const updatedPlan = await tx.onboardingPlan.updateMany({
          where: { id: task.planId, tenantId: ctx.tenantId, status: task.plan.status },
          data: { status: planStatus }
        });
        if (updatedPlan.count !== 1) throw new Error("STATE_CONFLICT");
      }

      await appendAudit(tx, ctx, {
        action: `ONBOARDING_TASK_${task.status}_TO_${next}`,
        resourceType: "OnboardingTask",
        resourceId: task.id,
        classification: task.sensitive ? DataClassification.RESTRICTED : DataClassification.CONFIDENTIAL,
        purpose: note ? `Employee onboarding execution; ${note}` : "Employee onboarding execution"
      });

      if (planStatus !== task.plan.status) {
        await appendAudit(tx, ctx, {
          action: `ONBOARDING_PLAN_${task.plan.status}_TO_${planStatus}`,
          resourceType: "OnboardingPlan",
          resourceId: task.planId,
          classification: DataClassification.CONFIDENTIAL,
          purpose: planStatus === OnboardingStatus.COMPLETED
            ? "Day-one readiness gate cleared: all onboarding tasks are completed or explicitly waived"
            : "Onboarding plan status recalculated from governed task states"
        });
      }

      return { id: task.id, status: next, planId: task.planId, planStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "TASK_NOT_FOUND") return Response.json({ error: "Onboarding task was not found in this tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Onboarding plan is outside your authorized relationship scope.");
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested onboarding task transition is not allowed." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The onboarding task or plan changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return Response.json({ error: "The onboarding task changed concurrently. Refresh and try again." }, { status: 409 });
    }
    console.error("Onboarding task transition failed", error);
    return Response.json({ error: "Onboarding task status could not be changed." }, { status: 500 });
  }
}
