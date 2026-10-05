import { parseLeaveBalanceYear } from "@/lib/leave-input";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { employmentIdFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "leave:read")) return forbidden();

  const year = parseLeaveBalanceYear(new URL(request.url).searchParams);
  if (year === null) return Response.json({ error: "year must be one four-digit calendar year between 0001 and 9999." }, { status: 400 });
  const scope = await resolveEmploymentScope(db, ctx);
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
