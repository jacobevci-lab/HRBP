import { DataClassification, DocumentStatus, VaultScanStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:read")) return forbidden();
  const { id } = await params;
  const document = await db.documentRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: { not: DocumentStatus.DELETED }, classification: { not: DataClassification.HIGHLY_RESTRICTED } }, select: { id: true } });
  if (!document) return Response.json({ error: "Document not found or restricted by policy." }, { status: 404 });
  const data = await db.documentVersion.findMany({ where: { tenantId: ctx.tenantId, documentId: id }, orderBy: { version: "desc" } });
  return Response.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:write")) return forbidden();
  const { id } = await params;
  const body = await request.json() as { contentHash?: string; contentType?: string; sizeBytes?: string | number };
  const contentHash = body.contentHash?.trim();
  if (!contentHash || !body.contentType?.trim()) return Response.json({ error: "contentHash and contentType are required." }, { status: 400 });
  const data = await db.$transaction(async (tx) => {
    const document = await tx.documentRecord.findFirst({ where: { id, tenantId: ctx.tenantId, status: { not: DocumentStatus.DELETED }, classification: { not: DataClassification.HIGHLY_RESTRICTED } } });
    if (!document) throw new Error("NOT_FOUND");
    const latest = await tx.documentVersion.findFirst({ where: { tenantId: ctx.tenantId, documentId: id }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (latest?.version ?? 0) + 1;
    const record = await tx.documentVersion.create({ data: { tenantId: ctx.tenantId, documentId: id, version, objectKey: `${document.objectKey}/v${version}`, contentType: body.contentType!.trim(), sizeBytes: body.sizeBytes === undefined ? undefined : BigInt(body.sizeBytes), contentHash, classification: document.classification, scanStatus: VaultScanStatus.PENDING, createdById: ctx.actorId } });
    await appendAudit(tx, ctx, { action: "document.version-created", resourceType: "DocumentVersion", resourceId: record.id, classification: document.classification });
    return record;
  }).catch((error) => error instanceof Error && error.message === "NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Document not found or restricted by policy." }, { status: 404 });
  return Response.json({ data, vaultUpload: { objectKey: data.objectKey, scanRequired: true } }, { status: 201 });
}
