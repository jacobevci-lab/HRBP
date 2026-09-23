import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getVisibleDocument } from "@/lib/document-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; grantId: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:grant")) return forbidden();

  const { id, grantId } = await params;
  const result = await db.$transaction(async (tx) => {
    const document = await getVisibleDocument(tx, ctx, id);
    if (!document) throw new Error("DOCUMENT");
    const grant = await tx.documentAccessGrant.findFirst({ where: { id: grantId, tenantId: ctx.tenantId, documentId: id } });
    if (!grant) throw new Error("GRANT");
    await tx.documentAccessGrant.delete({ where: { id: grant.id } });
    await appendAudit(tx, ctx, {
      action: "DOCUMENT_ACCESS_GRANT_REVOKED",
      resourceType: "DocumentAccessGrant",
      resourceId: grant.id,
      classification: document.classification ?? DataClassification.RESTRICTED,
      purpose: `Revoked ${grant.permission.toLowerCase()} access for ${grant.principalType.toLowerCase()} principal`
    });
    return { id: grant.id, revoked: true };
  }).catch((error) => error instanceof Error && ["DOCUMENT", "GRANT"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "DOCUMENT") return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });
  if (result === "GRANT") return Response.json({ error: "Document access grant not found." }, { status: 404 });
  return Response.json({ data: result });
}
