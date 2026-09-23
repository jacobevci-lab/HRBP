import { DataClassification, VaultScanStatus } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getDownloadableDocument } from "@/lib/document-access";
import { downloadResponseHeaders, fetchPrivateObject } from "@/lib/object-storage";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:read")) return forbidden();

  const { id } = await params;
  const document = await getDownloadableDocument(db, ctx, id);
  if (!document) return Response.json({ error: "Document not found in your authorized download scope." }, { status: 404 });

  const latest = await db.documentVersion.findFirst({
    where: { tenantId: ctx.tenantId, documentId: document.id },
    orderBy: { version: "desc" }
  });
  if (!latest) return Response.json({ error: "No stored document version is available for download." }, { status: 409 });
  if (latest.scanStatus !== VaultScanStatus.CLEAN) {
    return Response.json({
      error: latest.scanStatus === VaultScanStatus.QUARANTINED
        ? "Document version is quarantined and cannot be downloaded."
        : "Document version has not passed malware scanning."
    }, { status: latest.scanStatus === VaultScanStatus.QUARANTINED ? 423 : 409 });
  }

  const storage = await fetchPrivateObject(latest.objectKey, request.headers.get("range"));
  if (!storage.configured) return Response.json({ error: "Private object storage is not configured." }, { status: 503 });
  if (!storage.response) return Response.json({ error: "Private object storage did not return a response." }, { status: 502 });
  if (!storage.response.ok && storage.response.status !== 206) {
    if (storage.response.status === 404) return Response.json({ error: "The stored object was not found." }, { status: 404 });
    return Response.json({ error: "The private object store could not serve this document." }, { status: 502 });
  }

  await recordAudit({
    ctx,
    action: "DOCUMENT_DOWNLOADED",
    resourceType: "DocumentRecord",
    resourceId: document.id,
    classification: document.classification ?? DataClassification.RESTRICTED,
    purpose: "Authorized private vault download"
  });

  return new Response(storage.response.body, {
    status: storage.response.status,
    headers: downloadResponseHeaders(storage.response.headers, document.fileName)
  });
}
