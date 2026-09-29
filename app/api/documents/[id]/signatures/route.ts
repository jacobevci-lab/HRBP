import { DataClassification, SignatureEnvelopeStatus, VaultScanStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { employmentPrincipalsWithinScope, getVisibleDocument } from "@/lib/document-access";
import { asDate, asFiniteNumber, asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const maxParticipants = 50;

function normalizeEmail(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || /[\u0000-\u001f\u007f\s]/.test(normalized)) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(normalized)) return null;
  return normalized;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:read")) return forbidden();
  const { id } = await params;
  const doc = await getVisibleDocument(db, ctx, id);
  if (!doc) return Response.json({ error: "Document not found or restricted." }, { status: 404 });
  const data = await db.signatureEnvelope.findMany({
    where: { tenantId: ctx.tenantId, documentId: id },
    include: {
      documentVersion: { select: { id: true, version: true, contentHash: true, scanStatus: true, uploadedAt: true } },
      participants: { orderBy: [{ signingOrder: "asc" }, { id: "asc" }], take: 100 },
      events: { orderBy: { occurredAt: "asc" }, take: 200 }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:sign")) return forbidden();
  const { id } = await params;
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const title = asText(body.title, 200);
  const rawParticipants = Array.isArray(body.participants) ? body.participants : null;
  if (!title || !rawParticipants?.length || rawParticipants.length > maxParticipants) {
    return Response.json({ error: `A title of at most 200 characters and 1-${maxParticipants} participants are required.` }, { status: 400 });
  }

  let expiresAt: Date | undefined;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    const parsed = asDate(body.expiresAt);
    if (!parsed || parsed <= new Date()) return Response.json({ error: "expiresAt must be a valid future date." }, { status: 400 });
    expiresAt = parsed;
  }

  const participants: Array<{ employmentId?: string; email?: string; signingOrder: number }> = [];
  const employmentIds = new Set<string>();
  const emails = new Set<string>();
  for (let index = 0; index < rawParticipants.length; index += 1) {
    const value = rawParticipants[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: `Participant ${index + 1} must be an object.` }, { status: 400 });
    const record = value as Record<string, unknown>;
    const rawEmploymentId = record.employmentId === undefined || record.employmentId === null || record.employmentId === "" ? undefined : asIdentifier(record.employmentId);
    const rawEmail = normalizeEmail(record.email);
    if ((record.employmentId !== undefined && record.employmentId !== null && record.employmentId !== "" && !rawEmploymentId) || rawEmail === null) {
      return Response.json({ error: `Participant ${index + 1} contains an invalid employmentId or email.` }, { status: 400 });
    }
    const employmentId = rawEmploymentId ?? undefined;
    const email = rawEmail ?? undefined;
    if (!employmentId && !email) return Response.json({ error: `Participant ${index + 1} requires an employmentId or email.` }, { status: 400 });
    const orderValue = record.signingOrder === undefined ? index + 1 : asFiniteNumber(record.signingOrder);
    if (orderValue === null || !Number.isInteger(orderValue) || orderValue < 1 || orderValue > 1000) {
      return Response.json({ error: `Participant ${index + 1} signingOrder must be an integer between 1 and 1000.` }, { status: 400 });
    }
    if (employmentId && employmentIds.has(employmentId)) return Response.json({ error: "Duplicate employment participants are not allowed." }, { status: 409 });
    if (email && emails.has(email)) return Response.json({ error: "Duplicate email participants are not allowed." }, { status: 409 });
    if (employmentId) employmentIds.add(employmentId);
    if (email) emails.add(email);
    participants.push({ employmentId, email, signingOrder: orderValue });
  }

  const data = await db.$transaction(async (tx) => {
    const doc = await getVisibleDocument(tx, ctx, id);
    if (!doc) throw new Error("NOT_FOUND");
    if (!await employmentPrincipalsWithinScope(tx, ctx, [...employmentIds])) throw new Error("PARTICIPANT_SCOPE");

    const immutableVersion = await tx.documentVersion.findFirst({
      where: { tenantId: ctx.tenantId, documentId: id, uploadedAt: { not: null }, scanStatus: VaultScanStatus.CLEAN },
      orderBy: { version: "desc" },
      select: { id: true, version: true, contentHash: true }
    });
    if (!immutableVersion) throw new Error("VERSION_NOT_READY");

    const envelope = await tx.signatureEnvelope.create({
      data: {
        tenantId: ctx.tenantId,
        documentId: id,
        documentVersionId: immutableVersion.id,
        title,
        status: SignatureEnvelopeStatus.SENT,
        createdById: ctx.actorId,
        expiresAt,
        participants: { create: participants.map((participant) => ({ tenantId: ctx.tenantId, ...participant })) },
        events: {
          create: {
            tenantId: ctx.tenantId,
            eventType: "envelope.sent",
            actorId: ctx.actorId,
            ipAddress: ctx.ipAddress,
            metadata: { documentVersionId: immutableVersion.id, version: immutableVersion.version, contentHash: immutableVersion.contentHash }
          }
        }
      },
      include: {
        documentVersion: { select: { id: true, version: true, contentHash: true, scanStatus: true, uploadedAt: true } },
        participants: { orderBy: [{ signingOrder: "asc" }, { id: "asc" }] }
      }
    });
    await appendAudit(tx, ctx, {
      action: "document.signature-envelope-sent",
      resourceType: "SignatureEnvelope",
      resourceId: envelope.id,
      classification: doc.classification ?? DataClassification.RESTRICTED,
      purpose: `Signature envelope pinned to immutable document version v${immutableVersion.version}`
    });
    return envelope;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "PARTICIPANT_SCOPE", "VERSION_NOT_READY"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "NOT_FOUND") return Response.json({ error: "Document not found or restricted." }, { status: 404 });
  if (data === "PARTICIPANT_SCOPE") return forbidden("One or more employment participants are outside your authorized relationship scope or tenant.");
  if (data === "VERSION_NOT_READY") return Response.json({ error: "A CLEAN uploaded document version is required before a signature envelope can be sent." }, { status: 409 });
  return Response.json({ data }, { status: 201 });
}
