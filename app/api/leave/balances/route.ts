import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "leave:read")) return forbidden();

  const scope = await resolveEmploymentScope(db, ctx);
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getUTCFullYear());
  const data = await db.leaveBalance.findMany({
    where: { tenantId: ctx.tenantId, periodYear: year, ...employmentIdFilter(scope) },
    orderBy: [{ employmentId: "asc" }, { leaveTypeId: "asc" }],
    include: {
      leaveType: true,
      employment: { select: { id: true, person: { select: { employeeNumber: true, givenName: true, familyName: true } } } }
    }
  });
  return Response.json({ data });
}
