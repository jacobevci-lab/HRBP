import { DataClassification, ServiceRequestStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { can, forbidden } from "@/lib/authorization";
import { db } from "@/lib/db";
import { canManageHRServiceQueues } from "@/lib/hr-service-access";
import { asIdentifier, readJsonObject } from "@/lib/input-validation";
import { getRequestContext, mutationOriginAllowed, unauthorized } from "@/lib/request-context";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = getRequestContext(request);
  if (!ctx) return unauthorized();
  if (!mutationOriginAllowed(request)) return forbidden("Cross-origin mutation blocked.");
  if (!can(ctx, "hr-service:write") || !canManageHRServiceQueues(ctx)) return forbidden();
  const id = asIdentifier((await params).id);
  if (!id) return Response.json({ error: "A valid queue id is required." }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });
  const name = body.name === undefined ? undefined : typeof body.name === "string" ? body.name.trim() : null;
  if (name === null || name === "") return Response.json({ error: "Queue name must be plain text and cannot be empty." }, { status: 400 });
  const sla = body.defaultSlaMinutes === undefined || body.defaultSlaMinutes === null ? body.defaultSlaMinutes : Number(body.defaultSlaMinutes);
  if (typeof sla === "number" && (!Number.isInteger(sla) || sla < 15 || sla > 10080)) return Response.json({ error: "defaultSlaMinutes must be null or an integer between 15 and 10080." }, { status: 400 });
  const activeValue: boolean | undefined = body.active === undefined ? undefined : typeof body.active === "boolean" ? body.active : undefined;
  if (body.active !== undefined && activeValue === undefined) return Response.json({ error: "active must be boolean." }, { status: 400 });
  if (activeValue === undefined && body.name === undefined && body.defaultSlaMinutes === undefined) return Response.json({ error: "At least one queue field is required." }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const queue = await tx.hRServiceQueue.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!queue) throw new Error("NOT_FOUND");
    if (activeValue === false && queue.active) {
      const open = await tx.hRServiceRequest.count({ where: { tenantId: ctx.tenantId, queue: queue.key, status: { notIn: [ServiceRequestStatus.RESOLVED, ServiceRequestStatus.CLOSED, ServiceRequestStatus.CANCELLED] } } });
      if (open > 0) throw new Error("OPEN_REQUESTS");
    }
    const updated = await tx.hRServiceQueue.update({
      where: { id: queue.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(body.defaultSlaMinutes !== undefined ? { defaultSlaMinutes: sla ?? null } : {}),
        ...(activeValue !== undefined ? { active: activeValue } : {})
      }
    });
    await appendAudit(tx, ctx, { action: "hr-service.queue-updated", resourceType: "HRServiceQueue", resourceId: queue.id, classification: DataClassification.INTERNAL, purpose: "HR service queue governance" });
    return updated;
  }).catch((error) => error instanceof Error && ["NOT_FOUND", "OPEN_REQUESTS"].includes(error.message) ? error.message : Promise.reject(error));

  if (result === "NOT_FOUND") return Response.json({ error: "Queue not found in tenant." }, { status: 404 });
  if (result === "OPEN_REQUESTS") return Response.json({ error: "Queue cannot be disabled while it still owns open requests." }, { status: 409 });
  return Response.json({ data: result });
}
