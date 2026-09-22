import { ApplicationStage, DataClassification, OfferStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { withDb } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function validDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "recruiting:write")) return forbidden();

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const currency = String(body.currency ?? "").trim().toUpperCase();
  const annualBase = Number(body.annualBase);
  const startDate = validDate(body.startDate);
  const expiresAt = body.expiresAt ? validDate(body.expiresAt) : null;

  if (!/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "currency must be a 3-letter ISO currency code." }, { status: 400 });
  if (!Number.isFinite(annualBase) || annualBase <= 0) return Response.json({ error: "annualBase must be greater than zero." }, { status: 400 });
  if (!startDate) return Response.json({ error: "A valid startDate is required." }, { status: 400 });
  if (body.expiresAt && !expiresAt) return Response.json({ error: "expiresAt must be a valid date." }, { status: 400 });

  try {
    const data = await withDb((db) => db.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, stage: true, offer: { select: { id: true } } }
      });
      if (!application) throw new Error("APPLICATION_NOT_FOUND");
      if (application.offer) throw new Error("OFFER_ALREADY_EXISTS");
      if (![ApplicationStage.INTERVIEW, ApplicationStage.ASSESSMENT, ApplicationStage.OFFER].includes(application.stage)) throw new Error("INVALID_STAGE");

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
        await tx.application.update({ where: { id: application.id }, data: { stage: ApplicationStage.OFFER } });
      }

      await appendAudit(tx, ctx, {
        action: "OFFER_CREATED",
        resourceType: "Offer",
        resourceId: offer.id,
        classification: DataClassification.RESTRICTED,
        purpose: "Candidate offer preparation"
      });

      return offer;
    }));
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "APPLICATION_NOT_FOUND") return Response.json({ error: "Application was not found in this tenant." }, { status: 404 });
    if (code === "OFFER_ALREADY_EXISTS") return Response.json({ error: "An offer already exists for this application." }, { status: 409 });
    if (code === "INVALID_STAGE") return Response.json({ error: "Offer creation is only allowed from interview, assessment or offer stages." }, { status: 409 });
    console.error("Offer creation failed", error);
    return Response.json({ error: "Offer could not be created." }, { status: 500 });
  }
}
