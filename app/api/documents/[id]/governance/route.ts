import { DataClassification, PlatformRole } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getVisibleDocument } from "@/lib/document-access";
import { publicDocument } from "@/lib/document-public-projection";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

function parseOptionalDate(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return { value: null as Date | null, valid: true };
  const date = new Date(value);
  return { value: date, valid: !Number.isNaN(date.getTime()) };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:govern")) return forbidden();

  const { id } = await params;
  const body = await request.json() as { legalHold?: boolean; retentionUntil?: string | null; expiresAt?: string | null };
  if (body.legalHold !== undefined && ctx.role !== PlatformRole.LEGAL) {
    return forbidden("Only Legal can change a document legal-hold flag.");
  }
  const retention = parseOptionalDate(body.retentionUntil);
  const expires = parseOptionalDate(body.expiresAt);
  if (!retention.valid || !expires.valid) return Response.json({ error: "retentionUntil and expiresAt must be valid date values or null." }, { status: 400 });
  if (body.legalHold === undefined && body.retentionUntil === undefined && body.expiresAt === undefined) {
    return Response.json({ error: "At least one governance field is required." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const document = await getVisibleDocument(tx, ctx, id);
    if (!document) throw new Error("NOT_FOUND");
    const data = await tx.documentRecord.update({
      where: { id: document.id },
      data: {
        ...(body.legalHold !== undefined ? { legalHold: body.legalHold } : {}),
        ...(body.retentionUntil !== undefined ? { retentionUntil: retention.value } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: expires.value } : {})
      }
    });
    await appendAudit(tx, ctx, {
      action: "DOCUMENT_GOVERNANCE_UPDATED",
      resourceType: "DocumentRecord",
      resourceId: document.id,
      classification: document.classification ?? DataClassification.RESTRICTED,
      purpose: body.legalHold !== undefined ? "Legal hold / retention governance" : "Retention governance"
    });
    return data;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));

  if (!result) return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });
  return Response.json({ data: publicDocument(result) });
}
