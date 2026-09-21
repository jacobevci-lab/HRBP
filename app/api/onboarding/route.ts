import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "onboarding:read")) return forbidden();

  const data = await db.onboardingPlan.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { targetStartDate: "asc" },
    include: {
      person: { select: { id: true, employeeNumber: true, givenName: true, familyName: true, workEmail: true } },
      employment: { select: { id: true, status: true, position: { select: { id: true, title: true, positionCode: true } } } },
      tasks: { orderBy: { createdAt: "asc" } }
    }
  });
  return Response.json({ data });
}
