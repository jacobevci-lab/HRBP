import { createHash } from "node:crypto";
import { DataClassification, PlatformRole, PolicyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

const publishedOnlyRoles = new Set<PlatformRole>([PlatformRole.EMPLOYEE, PlatformRole.MANAGER, PlatformRole.RECRUITER, PlatformRole.TIME_ADMIN, PlatformRole.TALENT_ADMIN, PlatformRole.COMPENSATION_ADMIN, PlatformRole.PAYROLL_ADMIN]);

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:read")) return forbidden();
  const now = new Date();
  const data = await db.policyRecord.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(publishedOnlyRoles.has(ctx.role) ? { status: PolicyStatus.PUBLISHED, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } : {})
    },
    orderBy: [{ code: "asc" }, { effectiveFrom: "desc" }],
    take: 300
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "policies:write")) return forbidden();
  const body = await request.json() as { code?: string; title?: string; version?: string; jurisdiction?: string; audience?: string; contentMarkdown?: string; effectiveFrom?: string; reviewDueAt?: string };
  if (!body.code?.trim() || !body.title?.trim() || !body.version?.trim() || !body.contentMarkdown?.trim() || !body.effectiveFrom) return Response.json({ error: "code, title, version, contentMarkdown and effectiveFrom are required." }, { status: 400 });
  const contentHash = createHash("sha256").update(body.contentMarkdown.trim()).digest("hex");
  const data = await db.$transaction(async (tx) => {
    const policy = await tx.policyRecord.create({ data: { tenantId: ctx.tenantId, code: body.code!.trim().toUpperCase(), title: body.title!.trim(), version: body.version!.trim(), jurisdiction: body.jurisdiction, audience: body.audience, ownerId: ctx.actorId, contentMarkdown: body.contentMarkdown!.trim(), contentHash, effectiveFrom: new Date(body.effectiveFrom!), reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : undefined, status: PolicyStatus.DRAFT } });
    await appendAudit(tx, ctx, { action: "policy.created", resourceType: "PolicyRecord", resourceId: policy.id, classification: DataClassification.INTERNAL });
    return policy;
  });
  return Response.json({ data }, { status: 201 });
}
