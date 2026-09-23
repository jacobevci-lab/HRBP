import { DataClassification, Prisma, VaultScanStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canWriteDocumentForPerson, getVisibleDocument } from "@/lib/document-access";
import { documentUploadMaxBytes, normalizeDocumentContentType, normalizeSha256 } from "@/lib/document-upload-policy";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function serializeVersion<T extends { sizeBytes: bigint | null }>(value: T) {
  return { ...value, sizeBytes: value.sizeBytes === null ? null : value.sizeBytes.toString() };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:read")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid document id is required." }, { status: 400 });
  const document = await getVisibleDocument(db, ctx, id);
  if (!document) return Response.json({ error: "Document not found or restricted by policy." }, { status: 404 });
  const rows = await db.documentVersion.findMany({ where: { tenantId: ctx.tenantId, documentId: id }, orderBy: { version: "desc" } });
  return Response.json({ data: rows.map(serializeVersion) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:write")) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid document id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const contentHash = normalizeSha256(body.contentHash);
  const contentType = normalizeDocumentContentType(body.contentType);
  if (!contentHash || !contentType) return Response.json({ error: "A valid SHA-256 contentHash and supported contentType are required." }, { status: 400 });

  let sizeBytes: bigint | undefined;
  if (body.sizeBytes !== undefined && body.sizeBytes !== null && body.sizeBytes !== "") {
    if (typeof body.sizeBytes !== "string" && typeof body.sizeBytes !== "number") return Response.json({ error: "sizeBytes must be a non-negative integer." }, { status: 400 });
    try {
      const normalized = typeof body.sizeBytes === "number" ? String(body.sizeBytes) : body.sizeBytes.trim();
      if (!/^\d+$/.test(normalized)) throw new Error("INVALID");
      sizeBytes = BigInt(normalized);
      if (sizeBytes < BigInt(0) || sizeBytes > BigInt(documentUploadMaxBytes())) throw new Error("INVALID");
    } catch {
      return Response.json({ error: `sizeBytes must be a non-negative integer within the ${documentUploadMaxBytes()} byte upload limit.` }, { status: 400 });
    }
  }

  const result = await db.$transaction(async (tx) => {
    const document = await tx.documentRecord.findFirst({ where: { id, tenantId: ctx.tenantId, caseId: null } });
    if (!document) throw new Error("NOT_FOUND");
    if (!await canWriteDocumentForPerson(tx, ctx, document.personId)) throw new Error("OUT_OF_SCOPE");
    const latest = await tx.documentVersion.findFirst({ where: { tenantId: ctx.tenantId, documentId: id }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (latest?.version ?? 0) + 1;
    const record = await tx.documentVersion.create({
      data: {
        tenantId: ctx.tenantId,
        documentId: id,
        version,
        objectKey: `${document.objectKey}/v${version}`,
        contentType,
        sizeBytes,
        contentHash,
        classification: document.classification,
        scanStatus: VaultScanStatus.PENDING,
        createdById: ctx.actorId
      }
    });
    await appendAudit(tx, ctx, { action: "document.version-created", resourceType: "DocumentVersion", resourceId: record.id, classification: document.classification ?? DataClassification.RESTRICTED, purpose: "Immutable vault version reserved for upload" });
    return record;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "CONFLICT" as const;
    if (error instanceof Error && ["NOT_FOUND", "OUT_OF_SCOPE"].includes(error.message)) return error.message;
    return Promise.reject(error);
  });

  if (result === "NOT_FOUND") return Response.json({ error: "Document not found." }, { status: 404 });
  if (result === "OUT_OF_SCOPE") return forbidden("Document subject is outside your authorized write scope.");
  if (result === "CONFLICT") return Response.json({ error: "Document version changed concurrently. Refresh and retry." }, { status: 409 });
  return Response.json({ data: serializeVersion(result), upload: { method: "PUT", endpoint: `/api/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(result.id)}/upload`, scanRequired: true } }, { status: 201 });
}
