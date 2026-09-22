import { ApplicationStage, DataClassification, OfferStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { isPrismaRecordNotFound } from "@/lib/prisma-safety";
import { canTransitionOffer, parseOfferStatus } from "@/lib/recruiting-state";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const OFFER_PIPELINE_STATUSES: OfferStatus[] = [OfferStatus.APPROVAL, OfferStatus.SENT, OfferStatus.ACCEPTED];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid offer id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const next = parseOfferStatus(body.status);
  if (!next) return Response.json({ error: "A valid offer status is required." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const current = await tx.offer.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, status: true, expiresAt: true, applicationId: true }
      });
      if (!current) throw new Error("OFFER_NOT_FOUND");
      if (!canTransitionOffer(current.status, next)) throw new Error("INVALID_TRANSITION");
      if (next === OfferStatus.SENT && current.expiresAt && current.expiresAt <= new Date()) throw new Error("OFFER_EXPIRED");

      try {
        await tx.offer.update({
          where: { id: current.id, tenantId: ctx.tenantId, status: current.status },
          data: { status: next }
        });
      } catch (error) {
        if (isPrismaRecordNotFound(error)) throw new Error("STATE_CONFLICT");
        throw error;
      }

      if (OFFER_PIPELINE_STATUSES.includes(next)) {
        await tx.application.update({ where: { id: current.applicationId }, data: { stage: ApplicationStage.OFFER } });
      }

      await appendAudit(tx, ctx, {
        action: `OFFER_STATUS_${current.status}_TO_${next}`,
        resourceType: "Offer",
        resourceId: current.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Candidate offer lifecycle"
      });

      return { id: current.id, status: next };
    }));
    return Response.json({ data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "OFFER_NOT_FOUND") return Response.json({ error: "Offer was not found in this tenant." }, { status: 404 });
    if (code === "INVALID_TRANSITION") return Response.json({ error: "The requested offer-status transition is not allowed." }, { status: 409 });
    if (code === "OFFER_EXPIRED") return Response.json({ error: "This offer is already past its expiry date." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The offer changed concurrently. Refresh and try again." }, { status: 409 });
    console.error("Offer status transition failed", error);
    return Response.json({ error: "Offer status could not be changed." }, { status: 500 });
  }
}
