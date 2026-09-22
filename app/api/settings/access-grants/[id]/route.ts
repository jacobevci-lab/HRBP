import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "settings:write")) return forbidden();

  const { id } = await params;
  const result = await db.$transaction(async (tx) => {
    const grant = await tx.employmentAccessGrant.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!grant) throw new Error("NOT_FOUND");
    await tx.employmentAccessGrant.delete({ where: { id: grant.id } });
    await appendAudit(tx, ctx, {
      action: "HRBP_POPULATION_GRANT_REVOKED",
      resourceType: "EmploymentAccessGrant",
      resourceId: grant.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Relationship-aware workforce authorization"
    });
    return grant.id;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));

  if (!result) return Response.json({ error: "Access grant was not found in this tenant." }, { status: 404 });
  return Response.json({ data: { id: result, revoked: true } });
}
