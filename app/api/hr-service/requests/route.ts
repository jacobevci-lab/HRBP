import { randomUUID } from "node:crypto";
import { DataClassification, PlatformRole, ServicePriority } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { getRequestContext, unauthorized } from "@/lib/request-context";

const selfServiceRoles = new Set<PlatformRole>([PlatformRole.EMPLOYEE, PlatformRole.MANAGER]);
const slaMinutes: Record<ServicePriority, number> = { LOW: 4320, MEDIUM: 1440, HIGH: 480, CRITICAL: 240 };

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "hr-service:read")) return forbidden();
  const data = await db.hRServiceRequest.findMany({
    where: { tenantId: ctx.tenantId, ...(selfServiceRoles.has(ctx.role) ? { requestorId: ctx.actorId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { comments: true } } },
    take: 300
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "hr-service:write")) return forbidden();
  const body = await request.json() as { category?: string; subcategory?: string; title?: string; description?: string; priority?: ServicePriority; subjectEmploymentId?: string; queue?: string };
  if (!body.category?.trim() || !body.title?.trim() || !body.description?.trim()) return Response.json({ error: "category, title and description are required." }, { status: 400 });
  const priority = body.priority && Object.values(ServicePriority).includes(body.priority) ? body.priority : ServicePriority.MEDIUM;
  const subjectEmploymentId = selfServiceRoles.has(ctx.role) ? ctx.employmentId : body.subjectEmploymentId;
  if (selfServiceRoles.has(ctx.role) && !subjectEmploymentId) return forbidden("Trusted employment context is required for self-service.");

  const data = await db.$transaction(async (tx) => {
    if (subjectEmploymentId) {
      const employment = await tx.employment.findFirst({ where: { id: subjectEmploymentId, tenantId: ctx.tenantId }, select: { id: true } });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
    }
    const createdAt = new Date();
    const record = await tx.hRServiceRequest.create({
      data: {
        tenantId: ctx.tenantId,
        requestNumber: `HR-${createdAt.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        requestorId: ctx.actorId,
        subjectEmploymentId,
        category: body.category!.trim(),
        subcategory: body.subcategory,
        title: body.title!.trim(),
        description: body.description!.trim(),
        priority,
        queue: body.queue,
        slaDueAt: new Date(createdAt.getTime() + slaMinutes[priority] * 60_000)
      }
    });
    await appendAudit(tx, ctx, { action: "hr-service.request-created", resourceType: "HRServiceRequest", resourceId: record.id, classification: DataClassification.CONFIDENTIAL });
    return record;
  }).catch((error) => error instanceof Error && error.message === "EMPLOYMENT_NOT_FOUND" ? null : Promise.reject(error));
  if (!data) return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  return Response.json({ data }, { status: 201 });
}
