import { randomUUID } from "node:crypto";
import { DataClassification, DocumentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canWriteDocumentForPerson, documentVisibilityWhere } from "@/lib/document-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:read")) return forbidden();
  const where = await documentVisibilityWhere(db, ctx);
  const data = await db.documentRecord.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const fileName = String(body.fileName ?? "").trim();
  const contentType = String(body.contentType ?? "application/octet-stream").trim();
  const personId = String(body.personId ?? "").trim() || null;
  if (!fileName) return Response.json({ error: "fileName is required." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    if (!await canWriteDocumentForPerson(tx, ctx, personId)) throw new Error("OUT_OF_SCOPE");
    const document = await tx.documentRecord.create({
      data: {
        tenantId: ctx.tenantId,
        personId,
        fileName,
        contentType,
        objectKey: `${ctx.tenantId}/${personId ?? "general"}/${randomUUID()}`,
        classification: DataClassification.RESTRICTED,
        status: DocumentStatus.ACTIVE,
        createdById: ctx.actorId,
        purpose: ctx.purpose ?? "HR_RECORD"
      }
    });
    await appendAudit(tx, ctx, { action: "DOCUMENT_METADATA_CREATED", resourceType: "DocumentRecord", resourceId: document.id, classification: DataClassification.RESTRICTED });
    return document;
  }).catch((error) => error instanceof Error && error.message === "OUT_OF_SCOPE" ? null : Promise.reject(error));

  if (!data) return forbidden("Document subject is outside your authorized relationship scope or tenant.");
  return Response.json({ data, upload: { status: "PENDING", note: "Object upload is intentionally separated from metadata creation; presigned vault upload is the next adapter." } }, { status: 201 });
}
