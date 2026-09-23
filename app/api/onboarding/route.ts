import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { onboardingPlanPopulationFilter, resolveOnboardingPopulationScope } from "@/lib/onboarding-access";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "onboarding:read")) return forbidden();

  const scope = await resolveOnboardingPopulationScope(db, ctx);
  const data = await db.onboardingPlan.findMany({
    where: { tenantId: ctx.tenantId, ...onboardingPlanPopulationFilter(scope) },
    orderBy: { targetStartDate: "asc" },
    include: {
      person: { select: { id: true, employeeNumber: true, givenName: true, familyName: true, workEmail: true } },
      employment: { select: { id: true, status: true, position: { select: { id: true, title: true, positionCode: true } } } },
      tasks: { orderBy: { createdAt: "asc" } }
    },
    take: 300
  });
  return Response.json({ data, meta: { relationshipScoped: scope.employmentIds !== null } });
}
