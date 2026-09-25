import { ApplicationStage, DataClassification, OfferStatus, Prisma, RequisitionStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const OFFER_CREATION_STAGES = new Set<ApplicationStage>([
  ApplicationStage.INTERVIEW,
  ApplicationStage.ASSESSMENT,
  ApplicationStage.OFFER
]);

function validDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid application id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "A JSON object body is required." }, { status: 400 });
  const currency = String(body.currency ?? "").trim().toUpperCase();
  const annualBase = Number(body.annualBase);
  const startDate = validDate(body.startDate);
  const expiresAt = body.expiresAt ? validDate(body.expiresAt) : null;
  const now = new Date();

  if (!/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "currency must be a 3-letter ISO currency code." }, { status: 400 });
  if (!Number.isFinite(annualBase) || annualBase <= 0) return Response.json({ error: "annualBase must be greater than zero." }, { status: 400 });
  if (!startDate) return Response.json({ error: "A valid startDate is required." }, { status: 400 });
  if (body.expiresAt && !expiresAt) return Response.json({ error: "expiresAt must be a valid date." }, { status: 400 });
  if (expiresAt && expiresAt <= now) return Response.json({ error: "expiresAt must be in the future." }, { status: 400 });
  if (expiresAt && expiresAt >= startDate) return Response.json({ error: "expiresAt must be before the proposed employment startDate." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          stage: true,
          offer: { select: { id: true } },
          requisition: { select: { id: true, status: true, positionId: true } }
        }
      });
      if (!application) throw new Error("APPLICATION_NOT_FOUND");
      if (application.offer) throw new Error("OFFER_ALREADY_EXISTS");
      if (!OFFER_CREATION_STAGES.has(application.stage)) throw new Error("INVALID_STAGE");
      if (application.requisition.status !== RequisitionStatus.OPEN) throw new Error("REQUISITION_NOT_OPEN");
      if (!application.requisition.positionId) throw new Error("POSITION_REQUIRED");

      const offer = await tx.offer.create({
        data: {
          tenantId: ctx.tenantId,
          applicationId: application.id,
          status: OfferStatus.DRAFT,
          currency,
          annualBase,
          startDate,
          expiresAt
        },
        select: { id: true, status: true, currency: true, annualBase: true, startDate: true, expiresAt: true }
      });

      if (application.stage !== ApplicationStage.OFFER) {
        const updated = await tx.application.updateMany({
          where: { id: application.id, tenantId: ctx.tenantId, stage: application.stage },
          data: { stage: ApplicationStage.OFFER }
        });
        if (updated.count !== 1) throw new Error("STATE_CONFLICT");
      }

      await appendAudit(tx, ctx, {
        action: "OFFER_CREATED",
        resourceType: "Offer",
        resourceId: offer.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Candidate offer preparation"
      });

      return offer;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "APPLICATION_NOT_FOUND") return Response.json({ error: "Application was not found in this tenant." }, { status: 404 });
    if (code === "OFFER_ALREADY_EXISTS") return Response.json({ error: "An offer already exists for this application." }, { status: 409 });
    if (code === "INVALID_STAGE") return Response.json({ error: "Offer creation is only allowed from interview, assessment or offer stages." }, { status: 409 });
    if (code === "REQUISITION_NOT_OPEN") return Response.json({ error: "The requisition must be open before an offer can be prepared." }, { status: 409 });
    if (code === "POSITION_REQUIRED") return Response.json({ error: "The requisition must be linked to an authorized position before an offer can be prepared." }, { status: 409 });
    if (code === "STATE_CONFLICT") return Response.json({ error: "The application changed concurrently. Refresh and try again." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
      return Response.json({ error: "The application or offer changed concurrently. Refresh and try again." }, { status: 409 });
    }
    console.error("Offer creation failed", error);
    return Response.json({ error: "Offer could not be created." }, { status: 500 });
  }
}
