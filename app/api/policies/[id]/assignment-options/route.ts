import { EmploymentStatus, PolicyStatus } from "@prisma/client";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentPrimaryKeyFilter, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:write")) return forbidden();

  const { id } = await params;
  const policy = await db.policyRecord.findFirst({
    where: { id, tenantId: ctx.tenantId, status: PolicyStatus.PUBLISHED },
    select: { id: true }
  });
  if (!policy) return Response.json({ error: "Published policy not found." }, { status: 404 });

  const scope = await resolveEmploymentScope(db, ctx);
  const employments = await db.employment.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { not: EmploymentStatus.TERMINATED },
      ...employmentPrimaryKeyFilter(scope)
    },
    orderBy: [{ person: { familyName: "asc" } }, { person: { givenName: "asc" } }],
    take: 500,
    select: {
      id: true,
      person: { select: { employeeNumber: true, givenName: true, familyName: true } },
      position: { select: { title: true, orgUnit: { select: { name: true } } } },
      policyAssignments: {
        where: { policyId: id },
        select: { id: true, status: true, dueAt: true },
        take: 1
      }
    }
  });

  return Response.json({
    data: {
      relationshipScoped: scope !== null,
      employments: employments.map((employment) => ({
        id: employment.id,
        employeeNumber: employment.person.employeeNumber,
        name: `${employment.person.givenName} ${employment.person.familyName}`,
        position: employment.position?.title ?? "No position",
        organization: employment.position?.orgUnit?.name ?? "No organization",
        assigned: employment.policyAssignments.length > 0,
        assignmentStatus: employment.policyAssignments[0]?.status ?? null,
        dueAt: employment.policyAssignments[0]?.dueAt?.toISOString() ?? null
      }))
    }
  });
}
