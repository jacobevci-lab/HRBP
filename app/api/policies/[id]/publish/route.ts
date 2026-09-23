import { DataClassification, PolicyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:write")) return forbidden();
  const { id } = await params;

  const result = await db.$transaction(async (tx) => {
    const current = await tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    if (current.status !== PolicyStatus.APPROVED) throw new Error("STATE");
    if (!current.approvedById || !current.approvedAt || current.approvedById === current.ownerId) throw new Error("FOUR_EYES");

    const now = new Date();
    const record = await tx.policyRecord.update({
      where: { id: current.id },
      data: { status: PolicyStatus.PUBLISHED, publishedAt: now }
    });
    await appendAudit(tx, ctx, {
      action: "policy.published",
      resourceType: "PolicyRecord",
      resourceId: id,
      classification: DataClassification.INTERNAL,
      purpose: "Published independently approved policy version"
    });
    return record;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "STATE", "FOUR_EYES"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Policy not found." }, { status: 404 });
  if (result === "STATE") return Response.json({ error: "Only an APPROVED policy version can be published." }, { status: 409 });
  if (result === "FOUR_EYES") return Response.json({ error: "Independent approval evidence is required before publication." }, { status: 409 });
  return Response.json({ data: result });
}
