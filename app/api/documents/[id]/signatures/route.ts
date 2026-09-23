import { DataClassification, SignatureEnvelopeStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentPrincipalsWithinScope, getVisibleDocument } from "@/lib/document-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:read")) return forbidden();
  const { id } = await params;
  const doc = await getVisibleDocument(db, ctx, id);
  if (!doc) return Response.json({ error: "Document not found or restricted." }, { status: 404 });
  const data = await db.signatureEnvelope.findMany({
    where: { tenantId: ctx.tenantId, documentId: id },
    include: { participants: true, events: { orderBy: { occurredAt: "asc" } } },
    orderBy: { createdAt: "desc" }
  });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:sign")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { title?: string; expiresAt?: string; participants?: Array<{ employmentId?: string; email?: string; signingOrder?: number }> };
  const title = body.title?.trim();
  if (!title || !body.participants?.length) return Response.json({ error: "title and participants are required." }, { status: 400 });

  const participants = body.participants.map((participant, index) => ({
    employmentId: participant.employmentId?.trim() || undefined,
    email: participant.email?.trim() || undefined,
    signingOrder: participant.signingOrder ?? index + 1
  }));
  if (participants.some((participant) => !participant.employmentId && !participant.email)) return Response.json({ error: "Each participant requires an employmentId or email." }, { status: 400 });
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return Response.json({ error: "expiresAt must be a valid date value." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const doc = await getVisibleDocument(tx, ctx, id);
    if (!doc) throw new Error("NOT_FOUND");
    const employmentIds = participants.flatMap((participant) => participant.employmentId ? [participant.employmentId] : []);
    if (!await employmentPrincipalsWithinScope(tx, ctx, employmentIds)) throw new Error("PARTICIPANT_SCOPE");

    const envelope = await tx.signatureEnvelope.create({
      data: {
        tenantId: ctx.tenantId,
        documentId: id,
        title,
        status: SignatureEnvelopeStatus.SENT,
        createdById: ctx.actorId,
        expiresAt,
        participants: { create: participants.map((participant) => ({ tenantId: ctx.tenantId, ...participant })) },
        events: { create: { tenantId: ctx.tenantId, eventType: "envelope.sent", actorId: ctx.actorId, ipAddress: ctx.ipAddress } }
      },
      include: { participants: true }
    });
    await appendAudit(tx, ctx, { action: "document.signature-envelope-sent", resourceType: "SignatureEnvelope", resourceId: envelope.id, classification: doc.classification ?? DataClassification.RESTRICTED });
    return envelope;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "PARTICIPANT_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Document not found or restricted." }, { status: 404 });
  if (data === "PARTICIPANT_SCOPE") return forbidden("One or more employment participants are outside your authorized relationship scope or tenant.");
  return Response.json({ data }, { status: 201 });
}
