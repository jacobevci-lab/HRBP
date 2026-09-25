import { randomUUID } from "node:crypto";
import { DataClassification, PlatformRole, ServicePriority } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canActOnEmployment, resolveEmploymentScope } from "@/lib/employment-scope";
import { canUseHRServiceQueue, hrServiceRequestWhere, isHRServiceSelfServiceRole } from "@/lib/hr-service-access";
import { asEnumValue, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

const slaMinutes: Record<ServicePriority, number> = {
  LOW: 4320,
  MEDIUM: 1440,
  HIGH: 480,
  CRITICAL: 240
};

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
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });

  const category = asText(body.category, 80);
  const subcategoryInput = asOptionalText(body.subcategory, 80);
  const title = asText(body.title, 200);
  const description = asText(body.description, 4000);
  const priority = body.priority === undefined
    ? ServicePriority.MEDIUM
    : asEnumValue(body.priority, Object.values(ServicePriority));
  if (!category || !title || !description || subcategoryInput === null || !priority) {
    return Response.json({ error: "category (1–80), title (1–200), description (1–4000) and a valid priority are required." }, { status: 400 });
  }

  const requestedEmploymentId = body.subjectEmploymentId === undefined || body.subjectEmploymentId === null || body.subjectEmploymentId === ""
    ? null
    : asIdentifier(body.subjectEmploymentId);
  if (body.subjectEmploymentId && !requestedEmploymentId) return Response.json({ error: "subjectEmploymentId must be a valid identifier." }, { status: 400 });
  const requestedQueue = queueKey(body.queue);
  if (body.queue !== undefined && requestedQueue === undefined) return Response.json({ error: "queue must be a valid queue key." }, { status: 400 });

  const selfService = isHRServiceSelfServiceRole(ctx.role);
  const subjectEmploymentId = selfService ? ctx.employmentId : requestedEmploymentId;
  if (selfService && !subjectEmploymentId) return forbidden("Trusted employment context is required for self-service.");

  try {
    const data = await db.$transaction(async (tx) => {
      if (subjectEmploymentId) {
        const employment = await tx.employment.findFirst({
          where: { id: subjectEmploymentId, tenantId: ctx.tenantId },
          select: { id: true }
        });
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
      const record = await tx.hRServiceRequest.create({
        data: {
          tenantId: ctx.tenantId,
          requestNumber: `HR-${createdAt.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          requestorId: ctx.actorId,
          subjectEmploymentId,
          category,
          subcategory: subcategoryInput ?? undefined,
          title,
          description,
          priority,
          queue: queue?.key,
          slaDueAt: new Date(createdAt.getTime() + sla * 60_000)
        }
      });

      let recipientUserId: string | null = null;
      if (queue) {
        const owner = await tx.hRServiceQueueMembership.findFirst({
          where: { tenantId: ctx.tenantId, queueId: queue.id, role: "OWNER" },
          orderBy: { createdAt: "asc" },
          select: { userId: true }
        });
        recipientUserId = owner?.userId ?? null;
      }

      await appendAudit(tx, ctx, {
        action: "hr-service.request-created",
        resourceType: "HRServiceRequest",
        resourceId: record.id,
        classification: DataClassification.CONFIDENTIAL,
        purpose: queue ? `Created in ${queue.key} service queue` : "Employee service request"
      });
      await enqueueNotificationOutbox(tx, {
        tenantId: ctx.tenantId,
        eventType: "HR_SERVICE_REQUEST_CREATED",
        ...(recipientUserId ? { recipientUserId } : { recipientRole: PlatformRole.HR_OPERATIONS }),
        templateKey: "hr-service.request-created",
        resourceType: "HRServiceRequest",
        resourceId: record.id,
        dedupeKey: `hr-service:${record.id}:created`,
        classification: DataClassification.CONFIDENTIAL,
        payload: {
          notificationState: "created",
          requestNumber: record.requestNumber,
          title: record.title,
          category: record.category,
          priority: record.priority,
          ...(record.queue ? { queue: record.queue } : {}),
          ...(record.slaDueAt ? { slaDueAt: record.slaDueAt.toISOString() } : {})
        }
      });
      return record;
    });

    return Response.json({ data }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "EMPLOYMENT_NOT_FOUND") return Response.json({ error: "Employment not found in tenant." }, { status: 404 });
    if (code === "OUT_OF_SCOPE") return forbidden("Employment is outside your authorized relationship scope.");
    if (code === "QUEUE") return forbidden("The requested HR service queue is unavailable or not delegated to you.");
    console.error("HR service request creation failed", error);
    return Response.json({ error: "HR service request could not be created." }, { status: 500 });
  }
}
