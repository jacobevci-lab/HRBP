import { DataClassification, Prisma, SurveyStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid campaign id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const opensAt = typeof body.opensAt === "string" ? new Date(body.opensAt) : null;
  const closesAt = typeof body.closesAt === "string" ? new Date(body.closesAt) : null;
  if (!opensAt || !closesAt || Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) {
    return Response.json({ error: "opensAt and closesAt must be valid date values." }, { status: 400 });
  }
  if (opensAt <= new Date() || closesAt <= opensAt) {
    return Response.json({ error: "Campaign opensAt must be in the future and closesAt must be later than opensAt." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const current = await tx.surveyCampaign.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, status: true, createdById: true }
    });
    if (!current) throw new Error("NOT_FOUND");
    if (current.createdById !== ctx.actorId) throw new Error("OWNER");
    if (current.status !== SurveyStatus.DRAFT) throw new Error("STATE");

    const updated = await tx.surveyCampaign.update({
      where: { id: current.id, tenantId: ctx.tenantId, status: SurveyStatus.DRAFT },
      data: { opensAt, closesAt }
    });
    await appendAudit(tx, ctx, {
      action: "engagement.campaign-window-updated",
      resourceType: "SurveyCampaign",
      resourceId: current.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Creator-bound campaign scheduling window"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "STATE"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Campaign not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the campaign creator may change the campaign window.");
  if (result === "STATE") return Response.json({ error: "Only draft campaigns may change their scheduling window." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Campaign state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
