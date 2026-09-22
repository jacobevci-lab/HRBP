import { DataClassification, EmploymentStatus, LifecycleEventType } from "@prisma/client";
import { withDb } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "people:write")) return forbidden();

  const { personId } = await params;
  const body = await request.json() as Record<string, unknown>;
  const managerEmploymentIdValue = body.managerEmploymentId;
  const managerEmploymentId = typeof managerEmploymentIdValue === "string" && managerEmploymentIdValue.trim()
    ? managerEmploymentIdValue.trim()
    : null;

  try {
    const result = await withDb((client) => client.$transaction(async (tx) => {
      const employment = await tx.employment.findFirst({
        where: { tenantId: ctx.tenantId, personId, status: { not: EmploymentStatus.TERMINATED } },
        orderBy: { startDate: "desc" },
        select: { id: true, managerEmploymentId: true }
      });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
      const scope = await resolveEmploymentScope(tx, ctx);
      if (!canActOnEmployment(scope, employment.id)) throw new Error("OUT_OF_SCOPE");
      if (managerEmploymentId === employment.id) throw new Error("MANAGER_SELF");

      let managerName: string | null = null;
      if (managerEmploymentId) {
        const manager = await tx.employment.findFirst({
          where: { id: managerEmploymentId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
          select: { id: true, managerEmploymentId: true, person: { select: { givenName: true, familyName: true } } }
        });
        if (!manager) throw new Error("MANAGER_NOT_FOUND");

        let cursor: string | null = manager.id;
        const visited = new Set<string>();
        for (let depth = 0; cursor && depth < 64; depth += 1) {
          if (cursor === employment.id) throw new Error("MANAGER_CYCLE");
          if (visited.has(cursor)) throw new Error("MANAGER_CYCLE");
          visited.add(cursor);
          const next: { managerEmploymentId: string | null } | null = await tx.employment.findFirst({
            where: { id: cursor, tenantId: ctx.tenantId },
            select: { managerEmploymentId: true }
          });
          cursor = next?.managerEmploymentId ?? null;
        }

        managerName = `${manager.person.givenName} ${manager.person.familyName}`;
      }

      await tx.employment.update({
        where: { id: employment.id },
        data: { managerEmploymentId }
      });

      await tx.employeeLifecycleEvent.create({
        data: {
          tenantId: ctx.tenantId,
          personId,
          employmentId: employment.id,
          type: LifecycleEventType.MANAGER_CHANGED,
          effectiveAt: new Date(),
          summary: managerName ? `Manager changed to ${managerName}` : "Manager assignment cleared",
          actorId: ctx.actorId
        }
      });

      await appendAudit(tx, ctx, {
        action: "MANAGER_RELATIONSHIP_CHANGED",
        resourceType: "Employment",
        resourceId: employment.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: "Manager relationship administration"
      });

      return { employmentId: employment.id, managerEmploymentId, managerName };
    }));

    return Response.json({ data: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Current employment record was not found." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "MANAGER_NOT_FOUND") return Response.json({ error: "The selected manager is not an active employment in this tenant." }, { status: 404 });
    if (code === "MANAGER_SELF") return Response.json({ error: "An employee cannot be their own manager." }, { status: 409 });
    if (code === "MANAGER_CYCLE") return Response.json({ error: "This assignment would create a reporting-line cycle." }, { status: 409 });
    console.error("Manager relationship change failed", error);
    return Response.json({ error: "Manager relationship could not be changed." }, { status: 500 });
  }
}
