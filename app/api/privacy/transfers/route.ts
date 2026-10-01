import { DataClassification, Prisma, TransferMechanism } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function boundedText(value: unknown, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return required ? null : undefined;
  return text.length <= max ? text : null;
}

function categories(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 50) return null;
  const values = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (values.length !== value.length || values.some((item) => item.length > 120)) return null;
  return [...new Set(values)];
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "privacy:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const name = boundedText(body.name, 180, true);
  const sourceCountry = boundedText(body.sourceCountry, 80, true);
  const destinationCountry = boundedText(body.destinationCountry, 80, true);
  const recipient = boundedText(body.recipient, 240, true);
  const purpose = boundedText(body.purpose, 1000, true);
  const safeguardReference = boundedText(body.safeguardReference, 1000);
  const dataCategories = categories(body.dataCategories);
  const mechanismValue = typeof body.mechanism === "string" ? body.mechanism.trim().toUpperCase() : "";
  const dueAt = typeof body.transferImpactDueAt === "string" && body.transferImpactDueAt.trim()
    ? new Date(body.transferImpactDueAt)
    : undefined;

  if (!name || !sourceCountry || !destinationCountry || !recipient || !purpose || safeguardReference === null || !dataCategories) {
    return Response.json({ error: "Valid transfer name, countries, recipient, purpose and dataCategories are required." }, { status: 400 });
  }
  if (!Object.values(TransferMechanism).includes(mechanismValue as TransferMechanism)) {
    return Response.json({ error: "A valid transfer mechanism is required." }, { status: 400 });
  }
  if (dueAt && Number.isNaN(dueAt.getTime())) return Response.json({ error: "transferImpactDueAt must be a valid date." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const transfer = await tx.dataTransferRegister.create({
      data: {
        tenantId: ctx.tenantId,
        name,
        sourceCountry,
        destinationCountry,
        recipient,
        dataCategories: dataCategories as Prisma.InputJsonValue,
        purpose,
        mechanism: mechanismValue as TransferMechanism,
        safeguardReference,
        transferImpactDueAt: dueAt,
        active: true
      }
    });
    await appendAudit(tx, ctx, {
      action: "privacy-transfer.created",
      resourceType: "DataTransferRegister",
      resourceId: transfer.id,
      classification: DataClassification.RESTRICTED,
      purpose: "Cross-border transfer assurance"
    });
    return transfer;
  });

  return Response.json({ data }, { status: 201 });
}
