import { randomUUID } from "node:crypto";
import { DataClassification, ServicePriority } from "@prisma/client";
import { db } from "@/lib/db";
import { can, forbidden } from "@/lib/authorization";
import { appendAudit } from "@/lib/audit";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { canUseHRServiceQueue, hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const slaMinutes: Record<ServicePriority, number> = { LOW: 4320, MEDIUM: 1440, HIGH: 480, CRITICAL: 240 };
function queueKey(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const key = value.trim().toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z0-9_-]{2,40}$/.test(key) ? key : undefined;
}

export async function GET(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!can(ctx, "hr-service:read")) return forbidden();
  const where = await hrServiceRequestWhere(db, ctx);
  const data = await db.hRServiceRequest.findMany({ where, orderBy: { createdAt: "desc" }, include: { _count: { select: { comments: true } } }, take: 300 });
  return Response.json({ data });
}

export async function POST(request: Request) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write")) return forbidden();
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const subcategory = typeof body.subcategory === "string" ? body.subcategory.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const rawPriority = typeof body.priority === "string" ? body.priority.trim().toUpperCase() : "";
  const priority = Object.values(ServicePriority).includes(rawPriority as ServicePriority) ? rawPriority as ServicePriority : ServicePriority.MEDIUM;
  const requestedEmploymentId = body.subjectEmploymentId === undefined || body.subjectEmploymentId === null || body.subjectEmploymentId === "" ? null : asIdentifier(body.subjectEmploymentId);
  if (body.subjectEmploymentId && !requestedEmploymentId) return Response.json({ error: "subjectEmploymentId must be a valid identifier." }, { status: 400 });
  const requestedQueue = queueKey(body.queue);
  if (body.queue !== undefined && requestedQueue === undefined) return Response.json({ error: "queue must be a valid queue key." }, { status: 400 });
  if (!category || !title || !description) return Response.json({ error: "category, title and description are required." }, { status: 400 });

  const selfService = isHRServiceSelfServiceRole(ctx.role);
  const subjectEmploymentId = selfService ? ctx.employmentId : requestedEmploymentId;
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
    const queue = !selfService && requestedQueue ? await canUseHRServiceQueue(tx, ctx, requestedQueue) : null;
    if (!selfService && requestedQueue && !queue) throw new Error("QUEUE");
    const createdAt = new Date();
    const sla = queue?.defaultSlaMinutes ?? slaMinutes[priority];
    const record = await tx.hRServiceRequest.create({ data: { tenantId: ctx.tenantId, requestNumber: `HR-${createdAt.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, requestorId: ctx.actorId, subjectEmploymentId, category, subcategory: subcategory || undefined, title, description, priority, queue: queue?.key, slaDueAt: new Date(createdAt.getTime() + sla * 60_000) } });
    await appendAudit(tx, ctx, { action: "hr-service.request-created", resourceType: "HRServiceRequest", resourceId: record.id, classification: DataClassification.CONFIDENTIAL, purpose: queue ? `Created in ${queue.key} service queue` : "Employee service request" });
    return record;
  }).catch((error) => error instanceof Error && ["EMPLOYMENT_NOT_FOUND", "OUT_OF_SCOPE", "QUEUE"].includes(error.message) ? error.message : Promise.reject(error));
  if (data === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
  if (data === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
  if (data === "QUEUE") return forbidden("The requested HR service queue is unavailable or not delegated to you.");
  return Response.json({ data }, { status: 201 });
}
