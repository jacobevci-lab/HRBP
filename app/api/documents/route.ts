import { randomUUID } from "node:crypto";
import { DataClassification, DocumentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";
import { recordAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:read")) return forbidden();
  const data = await db.documentRecord.findMany({ where: { tenantId: ctx.tenantId, status: { not: DocumentStatus.DELETED }, classification: { not: DataClassification.HIGHLY_RESTRICTED } }, orderBy: { createdAt: "desc" }, take: 200 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:write")) return forbidden();
  const body = await request.json() as Record<string, unknown>;
  const fileName = String(body.fileName ?? "").trim();
  const contentType = String(body.contentType ?? "application/octet-stream").trim();
  const personId = String(body.personId ?? "").trim() || null;
  if (!fileName) return Response.json({ error: "fileName is required." }, { status: 400 });
  const document = await db.documentRecord.create({ data: {
    tenantId: ctx.tenantId, personId, fileName, contentType,
    objectKey: `${ctx.tenantId}/${personId ?? "general"}/${randomUUID()}`,
    classification: DataClassification.RESTRICTED, status: DocumentStatus.ACTIVE,
    createdById: ctx.actorId, purpose: ctx.purpose ?? "HR_RECORD"
  }});
  await recordAudit({ ctx, action: "DOCUMENT_METADATA_CREATED", resourceType: "DocumentRecord", resourceId: document.id, classification: DataClassification.RESTRICTED });
  return Response.json({ data: document, upload: { status: "PENDING", note: "Object upload is intentionally separated from metadata creation; presigned vault upload is the next adapter." } }, { status: 201 });
}
