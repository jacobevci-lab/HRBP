import { randomUUID } from "node:crypto";
import { DataClassification, DocumentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canWriteDocumentForPerson, documentVisibilityWhere } from "@/lib/document-access";
import { normalizeDocumentContentType } from "@/lib/document-upload-policy";
import { asIdentifier, asText, readJsonObject } from "@/lib/input-validation";
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
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const fileName = asText(body.fileName, 255);
  const contentType = normalizeDocumentContentType(body.contentType);
  const personId = body.personId === undefined || body.personId === null || body.personId === "" ? null : asIdentifier(body.personId);
  if (!fileName || !contentType) return Response.json({ error: "A valid fileName and supported contentType are required." }, { status: 400 });
  if (body.personId !== undefined && body.personId !== null && body.personId !== "" && !personId) return Response.json({ error: "personId must be a valid identifier when supplied." }, { status: 400 });

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
    await appendAudit(tx, ctx, { action: "DOCUMENT_METADATA_CREATED", resourceType: "DocumentRecord", resourceId: document.id, classification: DataClassification.RESTRICTED, purpose: "Governed document metadata creation" });
    return document;
  }).catch((error) => error instanceof Error && error.message === "OUT_OF_SCOPE" ? null : Promise.reject(error));

  if (!data) return forbidden("Document subject is outside your authorized relationship scope or tenant.");
  return Response.json({ data, next: { createVersion: `/api/documents/${encodeURIComponent(data.id)}/versions`, scanRequired: true } }, { status: 201 });
}
