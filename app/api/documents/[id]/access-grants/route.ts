import { DataClassification, EmploymentStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getVisibleDocument } from "@/lib/document-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const principalTypes = new Set(["USER", "EMPLOYMENT"]);
const permissions = new Set(["READ", "DOWNLOAD", "SIGN"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:grant")) return forbidden();
  const { id } = await params;
  if (!await getVisibleDocument(db, ctx, id)) return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });

  const now = new Date();
  const data = await db.documentAccessGrant.findMany({
    where: { tenantId: ctx.tenantId, documentId: id },
    orderBy: { grantedAt: "desc" }
  });
  return Response.json({
    data: data.map((grant) => ({ ...grant, expired: Boolean(grant.expiresAt && grant.expiresAt < now) }))
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "documents:grant")) return forbidden();

  const { id } = await params;
  const body = await request.json() as { principalType?: string; principalId?: string; permission?: string; purpose?: string; expiresAt?: string | null };
  const principalType = body.principalType?.trim().toUpperCase();
  const principalId = body.principalId?.trim();
  const permission = body.permission?.trim().toUpperCase();
  if (!principalType || !principalTypes.has(principalType) || !principalId || !permission || !permissions.has(permission)) {
    return Response.json({ error: "principalType USER|EMPLOYMENT, principalId and permission READ|DOWNLOAD|SIGN are required." }, { status: 400 });
  }
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) return Response.json({ error: "expiresAt must be a future date." }, { status: 400 });

  const data = await db.$transaction(async (tx) => {
    const document = await getVisibleDocument(tx, ctx, id);
    if (!document) throw new Error("DOCUMENT");

    if (principalType === "USER") {
      const user = await tx.userAccount.findFirst({ where: { id: principalId, tenantId: ctx.tenantId, active: true }, select: { id: true } });
      if (!user) throw new Error("PRINCIPAL");
    } else {
      const employment = await tx.employment.findFirst({
        where: { id: principalId, tenantId: ctx.tenantId, status: { not: EmploymentStatus.TERMINATED } },
        select: { id: true }
      });
      if (!employment) throw new Error("PRINCIPAL");
    }

    const existing = await tx.documentAccessGrant.findFirst({
      where: { tenantId: ctx.tenantId, documentId: id, principalType, principalId, permission }
    });
    const grant = existing
      ? await tx.documentAccessGrant.update({ where: { id: existing.id }, data: { purpose: body.purpose?.trim() || null, expiresAt } })
      : await tx.documentAccessGrant.create({
          data: {
            tenantId: ctx.tenantId,
            documentId: id,
            principalType,
            principalId,
            permission,
            purpose: body.purpose?.trim() || undefined,
            expiresAt,
            grantedById: ctx.actorId
          }
        });

    await appendAudit(tx, ctx, {
      action: existing ? "DOCUMENT_ACCESS_GRANT_UPDATED" : "DOCUMENT_ACCESS_GRANT_CREATED",
      resourceType: "DocumentAccessGrant",
      resourceId: grant.id,
      classification: document.classification ?? DataClassification.RESTRICTED,
      purpose: `Document ${permission.toLowerCase()} access delegated to ${principalType.toLowerCase()}`
    });
    return grant;
  }).catch((error) => error instanceof Error && ["DOCUMENT", "PRINCIPAL"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "DOCUMENT") return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });
  if (data === "PRINCIPAL") return Response.json({ error: "Grant principal was not found or is inactive in this tenant." }, { status: 400 });
  return Response.json({ data }, { status: 201 });
}
