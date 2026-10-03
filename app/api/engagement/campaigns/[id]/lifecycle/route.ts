import { DataClassification, Prisma, SurveyStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

type CampaignAction = "SCHEDULE" | "OPEN" | "CLOSE" | "RETURN_DRAFT" | "ARCHIVE";
const actions: CampaignAction[] = ["SCHEDULE", "OPEN", "CLOSE", "RETURN_DRAFT", "ARCHIVE"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "engagement:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid campaign id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const action = asEnumValue(body.action, actions);
  if (!action) return Response.json({ error: "A valid campaign lifecycle action is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const current = await tx.surveyCampaign.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, status: true, createdById: true, opensAt: true, closesAt: true, anonymous: true, anonymityThreshold: true }
    });
    if (!current) throw new Error("NOT_FOUND");
    if (current.createdById !== ctx.actorId) throw new Error("OWNER");

    const now = new Date();
    let status: SurveyStatus;
    if (action === "SCHEDULE") {
      if (current.status !== SurveyStatus.DRAFT) throw new Error("STATE");
      if (!current.opensAt || !current.closesAt || current.opensAt <= now || current.closesAt <= current.opensAt) throw new Error("WINDOW");
      status = SurveyStatus.SCHEDULED;
    } else if (action === "OPEN") {
      if (current.status !== SurveyStatus.SCHEDULED) throw new Error("STATE");
      if (!current.opensAt || current.opensAt > now) throw new Error("WINDOW");
      if (current.closesAt && current.closesAt <= now) throw new Error("WINDOW");
      status = SurveyStatus.OPEN;
    } else if (action === "CLOSE") {
      if (current.status !== SurveyStatus.OPEN) throw new Error("STATE");
      status = SurveyStatus.CLOSED;
    } else if (action === "RETURN_DRAFT") {
      if (current.status !== SurveyStatus.SCHEDULED || (current.opensAt && current.opensAt <= now)) throw new Error("STATE");
      status = SurveyStatus.DRAFT;
    } else {
      if (current.status !== SurveyStatus.CLOSED) throw new Error("STATE");
      status = SurveyStatus.ARCHIVED;
    }

    const updated = await tx.surveyCampaign.update({
      where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
      data: { status }
    });
    await appendAudit(tx, ctx, {
      action: `engagement.campaign-${action.toLowerCase()}`,
      resourceType: "SurveyCampaign",
      resourceId: current.id,
      classification: DataClassification.CONFIDENTIAL,
      purpose: "Creator-bound engagement campaign lifecycle"
    });
    return updated;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OWNER", "STATE", "WINDOW"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Campaign not found." }, { status: 404 });
  if (result === "OWNER") return forbidden("Only the campaign creator may perform lifecycle transitions.");
  if (result === "STATE") return Response.json({ error: "The requested campaign transition is not allowed from the current state." }, { status: 409 });
  if (result === "WINDOW") return Response.json({ error: "Campaign open/close window is not valid for this transition." }, { status: 409 });
  if (result === "CONFLICT") return Response.json({ error: "Campaign state changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: result });
}
