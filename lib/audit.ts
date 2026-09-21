import { createHash } from "node:crypto";
import { DataClassification } from "@prisma/client";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export async function recordAudit(input: {
  ctx: RequestContext;
  action: string;
  resourceType: string;
  resourceId: string;
  classification?: DataClassification;
}) {
  const previous = await db.auditEvent.findFirst({
    where: { tenantId: input.ctx.tenantId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { hash: true }
  });
  const occurredAt = new Date();
  const payload = [input.ctx.tenantId, input.ctx.actorId, input.action, input.resourceType, input.resourceId, input.ctx.purpose ?? "", occurredAt.toISOString(), previous?.hash ?? "GENESIS"].join("|");
  const hash = createHash("sha256").update(payload).digest("hex");

  return db.auditEvent.create({ data: {
    tenantId: input.ctx.tenantId,
    actorId: input.ctx.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    purpose: input.ctx.purpose,
    classification: input.classification ?? DataClassification.INTERNAL,
    ipAddress: input.ctx.ipAddress,
    occurredAt,
    hash,
    previousHash: previous?.hash
  }});
}
