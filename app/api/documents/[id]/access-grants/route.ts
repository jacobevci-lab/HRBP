import { DataClassification } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { employmentPrincipalsWithinScope, getVisibleDocument } from "@/lib/document-access";
import { asDate, asEnumValue, asIdentifier, asOptionalText, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const principalTypes = ["USER", "EMPLOYMENT"] as const;
const permissions = ["READ", "DOWNLOAD", "SIGN"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "documents:grant")) return forbidden();
  const { id } = await params;
  if (!await getVisibleDocument(db, ctx, id)) return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });

  const now = new Date();
  const data = await db.documentAccessGrant.findMany({
    where: { tenantId: ctx.tenantId, documentId: id },
    orderBy: { grantedAt: "desc" },
    take: 200
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
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const principalType = asEnumValue(body.principalType, principalTypes);
  const principalId = asIdentifier(body.principalId);
  const permission = asEnumValue(body.permission, permissions);
  const purpose = asOptionalText(body.purpose, 500);
  if (!principalType || !principalId || !permission || purpose === null) {
    return Response.json({ error: "principalType USER|EMPLOYMENT, a valid principalId, permission READ|DOWNLOAD|SIGN and a purpose of at most 500 characters are required when supplied." }, { status: 400 });
  }
  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    const parsed = asDate(body.expiresAt);
    if (!parsed || parsed <= new Date()) return Response.json({ error: "expiresAt must be a valid future date." }, { status: 400 });
    expiresAt = parsed;
  }

  const data = await db.$transaction(async (tx) => {
    const document = await getVisibleDocument(tx, ctx, id);
    if (!document) throw new Error("DOCUMENT");

    if (principalType === "USER") {
      const user = await tx.userAccount.findFirst({ where: { id: principalId, tenantId: ctx.tenantId, active: true }, select: { id: true } });
      if (!user) throw new Error("PRINCIPAL");
    } else if (!await employmentPrincipalsWithinScope(tx, ctx, [principalId])) {
      throw new Error("PRINCIPAL_SCOPE");
    }

    const existing = await tx.documentAccessGrant.findFirst({
      where: { tenantId: ctx.tenantId, documentId: id, principalType, principalId, permission }
    });
    const grant = existing
      ? await tx.documentAccessGrant.update({ where: { id: existing.id }, data: { purpose: purpose ?? null, expiresAt } })
      : await tx.documentAccessGrant.create({
          data: {
            tenantId: ctx.tenantId,
            documentId: id,
            principalType,
            principalId,
            permission,
            purpose,
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
  }).catch((error) => error instanceof Error && ["DOCUMENT", "PRINCIPAL", "PRINCIPAL_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));

  if (data === "DOCUMENT") return Response.json({ error: "Document not found in your governed scope." }, { status: 404 });
  if (data === "PRINCIPAL") return Response.json({ error: "Grant principal was not found or is inactive in this tenant." }, { status: 400 });
  if (data === "PRINCIPAL_SCOPE") return forbidden("Employment principal is outside your authorized relationship scope or tenant.");
  return Response.json({ data }, { status: 201 });
}
