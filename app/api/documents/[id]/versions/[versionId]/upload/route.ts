import { createHash } from "node:crypto";
import { DataClassification, Prisma, VaultScanStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canWriteDocumentForPerson } from "@/lib/document-access";
import { documentUploadMaxBytes, normalizeDocumentContentType, normalizeSha256 } from "@/lib/document-upload-policy";
import { asIdentifier } from "@/lib/input-validation";
import { putPrivateObject } from "@/lib/object-storage";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:write")) return forbidden();

  const resolved = await params;
  const documentId = asIdentifier(resolved.id);
  const versionId = asIdentifier(resolved.versionId);
  if (!documentId || !versionId) return Response.json({ error: "Valid document and version ids are required." }, { status: 400 });

  const contentType = normalizeDocumentContentType(request.headers.get("content-type"));
  if (!contentType) return Response.json({ error: "Unsupported document content type." }, { status: 415 });
  const maxBytes = documentUploadMaxBytes();
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength && (!Number.isInteger(declaredLength) || declaredLength < 0 || declaredLength > maxBytes)) {
    return Response.json({ error: `Document object exceeds the ${maxBytes} byte upload limit.` }, { status: 413 });
  }

  const authorization = await db.$transaction(async (tx) => {
    const document = await tx.documentRecord.findFirst({ where: { id: documentId, tenantId: ctx.tenantId, caseId: null } });
    if (!document) return null;
    if (!await canWriteDocumentForPerson(tx, ctx, document.personId)) return null;
    const version = await tx.documentVersion.findFirst({ where: { id: versionId, tenantId: ctx.tenantId, documentId }, select: { id: true, objectKey: true, contentHash: true, contentType: true, uploadedAt: true, scanStatus: true, classification: true } });
    if (!version) return null;
    return { document, version };
  });
  if (!authorization) return Response.json({ error: "Document version not found in your authorized write scope." }, { status: 404 });
  if (authorization.version.uploadedAt || authorization.version.scanStatus === VaultScanStatus.CLEAN || authorization.version.scanStatus === VaultScanStatus.QUARANTINED) {
    return Response.json({ error: "This immutable document version already has an uploaded object." }, { status: 409 });
  }
  if (authorization.version.contentType !== contentType) return Response.json({ error: "Uploaded content type does not match version metadata." }, { status: 409 });

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return Response.json({ error: "Document object cannot be empty." }, { status: 400 });
  if (buffer.byteLength > maxBytes) return Response.json({ error: `Document object exceeds the ${maxBytes} byte upload limit.` }, { status: 413 });
  const bytes = new Uint8Array(buffer);
  const computedHash = createHash("sha256").update(bytes).digest("hex");
  const declaredHash = normalizeSha256(request.headers.get("x-content-sha256"));
  if (request.headers.get("x-content-sha256") && !declaredHash) return Response.json({ error: "x-content-sha256 must be a 64-character SHA-256 hex digest." }, { status: 400 });
  if (declaredHash && declaredHash !== computedHash) return Response.json({ error: "Uploaded object does not match the declared SHA-256 digest." }, { status: 409 });
  if (authorization.version.contentHash !== computedHash) return Response.json({ error: "Uploaded object does not match the version content hash." }, { status: 409 });

  const storage = await putPrivateObject(authorization.version.objectKey, bytes, contentType);
  if (!storage.configured) return Response.json({ error: "Private object storage is not configured." }, { status: 503 });
  if (!storage.response?.ok) return Response.json({ error: "Private object storage rejected the upload." }, { status: 502 });

  const now = new Date();
  const data = await db.$transaction(async (tx) => {
    const updated = await tx.documentVersion.update({
      where: { id: versionId, uploadedAt: null },
      data: {
        sizeBytes: BigInt(buffer.byteLength),
        uploadedAt: now,
        scanStatus: VaultScanStatus.PENDING,
        scanCompletedAt: null,
        scanEngine: null,
        scanReference: null,
        scanMessage: null
      }
    });
    await appendAudit(tx, ctx, {
      action: "document.version-uploaded",
      resourceType: "DocumentVersion",
      resourceId: versionId,
      classification: authorization.version.classification ?? DataClassification.RESTRICTED,
      purpose: "Private vault upload completed; malware scan pending"
    });
    return updated;
  }).catch((error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Document version upload state changed concurrently. Refresh and retry with a new version." }, { status: 409 });
  return Response.json({ data: { id: data.id, uploadedAt: data.uploadedAt, scanStatus: data.scanStatus, sizeBytes: data.sizeBytes?.toString() ?? null } }, { status: 202 });
}
