import { randomUUID } from "node:crypto";
import { DataClassification, ServicePriority } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const slaMinutes: Record<ServicePriority, number> = { LOW: 4320, MEDIUM: 1440, HIGH: 480, CRITICAL: 240 };

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "hr-service:read")) return forbidden();
  const where = await hrServiceRequestWhere(db, ctx);
  const data = await db.hRServiceRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { comments: true } } },
    take: 300
  });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write")) return forbidden();
  const body = await request.json() as { category?: string; subcategory?: string; title?: string; description?: string; priority?: ServicePriority; subjectEmploymentId?: string; queue?: string };
  if (!body.category?.trim() || !body.title?.trim() || !body.description?.trim()) return Response.json({ error: "category, title and description are required." }, { status: 400 });
  const priority = body.priority && Object.values(ServicePriority).includes(body.priority) ? body.priority : ServicePriority.MEDIUM;
  const selfService = isHRServiceSelfServiceRole(ctx.role);
  const subjectEmploymentId = selfService ? ctx.employmentId : body.subjectEmploymentId;
  if (selfService && !subjectEmploymentId) return forbidden("Trusted employment context is required for self-service.");

  const data = await db.$transaction(async (tx) => {
    if (subjectEmploymentId) {
      const employment = await tx.employment.findFirst({ where: { id: subjectEmploymentId, tenantId: ctx.tenantId }, select: { id: true } });
      if (!employment) throw new Error("EMPLOYMENT_NOT_FOUND");
      if (!selfService) {
        const scope = await resolveEmploymentScope(tx, ctx);
        if (!canActOnEmployment(scope, subjectEmploymentId)) throw new Error("OUT_OF_SCOPE");
      }
    }
    const createdAt = new Date();
    const record = await tx.hRServiceRequest.create({
      data: {
        tenantId: ctx.tenantId,
        requestNumber: `HR-${createdAt.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        requestorId: ctx.actorId,
        subjectEmploymentId,
        category: body.category!.trim(),
        subcategory: body.subcategory?.trim() || undefined,
        title: body.title!.trim(),
        description: body.description!.trim(),
        priority,
        queue: selfService ? undefined : body.queue?.trim() || undefined,
        slaDueAt: new Date(createdAt.getTime() + slaMinutes[priority] * 60_000)
      }
    });
    await appendAudit(tx, ctx, { action: "hr-service.request-created", resourceType: "HRServiceRequest", resourceId: record.id, classification: DataClassification.CONFIDENTIAL });
    return record;
  }).catch((error) => error instanceof Error && ["EMPLOYMENT_NOT_FOUND", "OUT_OF_SCOPE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  if (data === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  return Response.json({ data }, { status: 201 });
}
