import { DataClassification, EmploymentStatus, OnboardingStatus, OnboardingTaskStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier } from "@/lib/input-validation";
import { canAccessOnboardingPlan, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "onboarding:write") || !can(ctx, "people:write")) {
    return forbidden("Employment activation requires onboarding and people write authority.");
  }

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid onboarding plan id is required." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const plan = await tx.onboardingPlan.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          status: true,
          targetStartDate: true,
          personId: true,
          employmentId: true,
          employment: { select: { id: true, status: true, startDate: true } }
        }
      });
      if (!plan) throw new Error("PLAN_NOT_FOUND");

      const population = await resolveOnboardingPopulationScope(tx, ctx);
      if (!canAccessOnboardingPlan(population, plan)) throw new Error("OUT_OF_SCOPE");
      if (plan.status !== OnboardingStatus.COMPLETED) throw new Error("READINESS_INCOMPLETE");
      if (!plan.employmentId || !plan.employment) throw new Error("EMPLOYMENT_REQUIRED");
      if (plan.employment.status !== EmploymentStatus.PREBOARDING) throw new Error("EMPLOYMENT_NOT_PREBOARDING");

      const now = new Date();
      if (plan.targetStartDate > now || plan.employment.startDate > now) throw new Error("START_DATE_NOT_REACHED");

      const openTasks = await tx.onboardingTask.count({
        where: {
          tenantId: ctx.tenantId,
          planId: plan.id,
          status: { notIn: [OnboardingTaskStatus.COMPLETED, OnboardingTaskStatus.WAIVED] }
        }
      });
      if (openTasks > 0) throw new Error("READINESS_INCOMPLETE");

      const activated = await tx.employment.updateMany({
        where: {
          id: plan.employment.id,
          tenantId: ctx.tenantId,
          status: EmploymentStatus.PREBOARDING,
          startDate: { lte: now }
        },
        data: { status: EmploymentStatus.ACTIVE }
      });
      if (activated.count !== 1) throw new Error("STATE_CONFLICT");

      await appendAudit(tx, ctx, {
        action: "EMPLOYMENT_PREBOARDING_TO_ACTIVE",
        resourceType: "Employment",
        resourceId: plan.employment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Onboarding readiness gate cleared and employment start date reached"
      });
      await appendAudit(tx, ctx, {
        action: "ONBOARDING_HANDOFF_TO_ACTIVE_EMPLOYMENT",
        resourceType: "OnboardingPlan",
        resourceId: plan.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Human-confirmed handoff from completed onboarding to active employment"
      });

      const resolvedNotifications = await tx.notificationOutbox.updateMany({
        where: {
          tenantId: ctx.tenantId,
          resourceType: "OnboardingPlan",
          resourceId: plan.id,
          readAt: null
        },
        data: { readAt: now }
      });

      return {
        planId: plan.id,
        employmentId: plan.employment.id,
        employmentStatus: EmploymentStatus.ACTIVE,
        activatedAt: now.toISOString(),
        resolvedNotifications: resolvedNotifications.count
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "PLAN_NOT_FOUND") return Response.json({ error: "Onboarding plan was not found in this tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Onboarding plan is outside your authorized relationship scope.");
    if (code === "READINESS_INCOMPLETE") return Response.json({ error: "Employment cannot be activated until every onboarding task is completed or explicitly waived." }, { status: 409 });
    if (code === "EMPLOYMENT_REQUIRED") return Response.json({ error: "Onboarding plan is not linked to an employment record." }, { status: 409 });
    if (code === "EMPLOYMENT_NOT_PREBOARDING") return Response.json({ error: "Only a preboarding employment can be activated from onboarding." }, { status: 409 });
    if (code === "START_DATE_NOT_REACHED") return Response.json({ error: "Employment cannot be activated before the governed start date." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "Employment state changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return Response.json({ error: "Employment state changed concurrently. Refresh and try again." }, { status: 409 });
    }
    console.error("Onboarding employment activation failed", error);
    return Response.json({ error: "Employment could not be activated from onboarding." }, { status: 500 });
  }
}
