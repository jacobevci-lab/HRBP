import { ApplicationStage, DataClassification, OfferStatus, Prisma } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
import { canTransitionApplication, parseApplicationStage } from "@/lib/recruiting-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const ACTIVE_OFFER_STATUSES = new Set<OfferStatus>([
  OfferStatus.APPROVAL,
  OfferStatus.SENT,
  OfferStatus.ACCEPTED
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid application id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = parseApplicationStage(body.stage);
  if (!next) return Response.json({ error: "A valid application stage is required." }, { status: 400 });
  if (next === ApplicationStage.HIRED) return Response.json({ error: "Use the controlled Hire transition after an accepted offer." }, { status: 409 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const current = await tx.application.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, stage: true, offer: { select: { status: true } } }
      });
      if (!current) throw new Error("APPLICATION_NOT_FOUND");
      if (!canTransitionApplication(current.stage, next)) throw new Error("INVALID_TRANSITION");
      if (current.offer && ACTIVE_OFFER_STATUSES.has(current.offer.status) && next !== ApplicationStage.OFFER) {
        throw new Error(current.offer.status === OfferStatus.ACCEPTED ? "ACCEPTED_OFFER_LOCKS_APPLICATION" : "ACTIVE_OFFER_LOCKS_APPLICATION");
      }

      try {
        await tx.application.update({
          where: { id: current.id, tenantId: ctx.tenantId, stage: current.stage },
          data: { stage: next }
        });
      } catch (error) {
        if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
        throw error;
      }

      await appendAudit(tx, ctx, {
        action: `APPLICATION_STAGE_${current.stage}_TO_${next}`,
        resourceType: "Application",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Recruiting pipeline management"
      });

      return { id: current.id, stage: next };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "APPLICATION_NOT_FOUND") return Response.json({ error: "Application was not found in this tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested application-stage transition is not allowed." }, { status: 409 });
    if (code === "ACTIVE_OFFER_LOCKS_APPLICATION") return Response.json({ error: "Return, decline, expire or withdraw the active offer before moving the application out of the offer stage." }, { status: 409 });
    if (code === "ACCEPTED_OFFER_LOCKS_APPLICATION") return Response.json({ error: "An accepted offer locks the application. Use the controlled Hire transition." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The application changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return Response.json({ error: "The application changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Application stage transition failed", error);
    return Response.json({ error: "Application stage could not be changed." }, { status: 500 });
  }
}
