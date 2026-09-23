import { DataClassification, PolicyStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { asIdentifier } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "policies:write")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid policy id is required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const current = await tx.policyRecord.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new Error("NOT_FOUND");
    if (current.status !== PolicyStatus.APPROVED || !current.approvedById || !current.approvedAt || current.approvedById === current.ownerId) throw new Error("STATE");
    const record = await tx.policyRecord.update({ where: { id: current.id, tenantId: ctx.tenantId, status: PolicyStatus.APPROVED }, data: { status: PolicyStatus.PUBLISHED, publishedAt: new Date() } });
    await appendAudit(tx, ctx, { action: "policy.published", resourceType: "PolicyRecord", resourceId: id, classification: DataClassification.INTERNAL, purpose: "Published only after independent approval" });
    return record;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "STATE"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });
  if (data === "NOT_FOUND") return Response.json({ error: "Policy not found." }, { status: 404 });
  if (data === "STATE") return Response.json({ error: "Policy must be independently approved before publication." }, { status: 409 });
  if (data === "CONFLICT") return Response.json({ error: "Policy state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data });
}
