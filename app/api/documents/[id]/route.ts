import { DataClassification, DocumentStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getVisibleDocument } from "@/lib/document-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:govern")) return forbidden();

  const { id } = await params;
  const result = await db.$transaction(async (tx) => {
    const document = await getVisibleDocument(tx, ctx, id);
    if (!document) throw new Error("NOT_FOUND");
    if (document.legalHold) throw new Error("LEGAL_HOLD");
    if (document.retentionUntil && document.retentionUntil > new Date()) throw new Error("RETENTION");

    const updated = await tx.documentRecord.update({
      where: { id: document.id },
      data: { status: DocumentStatus.DELETED },
      select: { id: true, status: true }
    });
    await appendAudit(tx, ctx, {
      action: "DOCUMENT_LOGICALLY_DELETED",
      resourceType: "DocumentRecord",
      resourceId: document.id,
      classification: document.classification ?? DataClassification.RESTRICTED,
      purpose: "Retention-governed logical deletion"
    });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "LEGAL_HOLD", "RETENTION"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });
  if (result === "LEGAL_HOLD") return Response.json({ error: "Document deletion is blocked by legal hold." }, { status: 409 });
  if (result === "RETENTION") return Response.json({ error: "Document deletion is blocked until the retention period ends." }, { status: 409 });
  return Response.json({ data: result });
}
