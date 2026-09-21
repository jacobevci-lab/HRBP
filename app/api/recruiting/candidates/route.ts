import { ApplicationStage, DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { getRequestContext, unauthorized } from "@/lib/request-context";
import { recordAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:read")) return forbidden();

  const data = await db.candidate.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true, givenName: true, familyName: true, email: true, source: true, retentionUntil: true, classification: true,
      applications: { select: { id: true, stage: true, requisition: { select: { id: true, title: true } }, offer: { select: { status: true, startDate: true } } } }
    }
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "recruiting:write")) return forbidden();

  const body = await request.json() as Record<string, unknown>;
  const givenName = String(body.givenName ?? "").trim();
  const familyName = String(body.familyName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const requisitionId = String(body.requisitionId ?? "").trim();
  if (!givenName || !familyName || !email || !requisitionId) return Response.json({ error: "givenName, familyName, email and requisitionId are required." }, { status: 400 });

  const data = await db.candidate.create({ data: {
    tenantId: ctx.tenantId, givenName, familyName, email,
    phone: String(body.phone ?? "").trim() || null,
    source: String(body.source ?? "").trim() || null,
    privacyNoticeVersion: String(body.privacyNoticeVersion ?? "").trim() || null,
    retentionUntil: body.retentionUntil ? new Date(String(body.retentionUntil)) : null,
    classification: DataClassification.RESTRICTED,
    applications: { create: { tenantId: ctx.tenantId, requisitionId, stage: ApplicationStage.APPLIED, source: String(body.source ?? "").trim() || null } }
  }});
  await recordAudit({ ctx, action: "CANDIDATE_CREATED", resourceType: "Candidate", resourceId: data.id, classification: DataClassification.RESTRICTED });
  return Response.json({ data }, { status: 201 });
}
