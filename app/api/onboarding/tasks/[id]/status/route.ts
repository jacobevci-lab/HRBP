import { DataClassification, OnboardingStatus, OnboardingTaskStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
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

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const task = await tx.onboardingTask.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, planId: true, status: true, title: true, sensitive: true }
      });
      if (!task) throw new Error("TASK_NOT_FOUND");
      if (!transitions[task.status].includes(next)) throw new Error("INVALID_TRANSITION");

      try {
        await tx.onboardingTask.update({
          where: { id: task.id, tenantId: ctx.tenantId, status: task.status },
          data: { status: next }
        });
      } catch (error) {
        if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
        throw error;
      }

      const planTasks = await tx.onboardingTask.findMany({
        where: { planId: task.planId, tenantId: ctx.tenantId },
        select: { status: true }
      });
      const planStatus = derivePlanStatus(planTasks.map((item) => item.status));
      await tx.onboardingPlan.update({ where: { id: task.planId, tenantId: ctx.tenantId }, data: { status: planStatus } });

      await appendAudit(tx, ctx, {
        action: `ONBOARDING_TASK_${task.status}_TO_${next}`,
        resourceType: "OnboardingTask",
        resourceId: task.id,
        classification: task.sensitive ? DataClassification.RESTRICTED : DataClassification.CONFIDENTIAL,
        purpose: "Employee onboarding execution"
      });

      return { id: task.id, status: next, planId: task.planId, planStatus };
    }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "TASK_NOT_FOUND") return Response.json({ error: "Onboarding task was not found in this tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested onboarding task transition is not allowed." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The onboarding task changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Onboarding task transition failed", error);
    return Response.json({ error: "Onboarding task status could not be changed." }, { status: 500 });
  }
}
