import { createHash } from "node:crypto";
import { DataClassification, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/request-context";

export type AuditInput = {
  action: string;
  resourceType: string;
  resourceId: string;
  classification?: DataClassification;
  purpose?: string;
};

export async function appendAudit(tx: Prisma.TransactionClient, ctx: RequestContext, input: AuditInput) {
  const occurredAt = new Date();
  const previous = await tx.auditEvent.findFirst({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { hash: true }
  });
  const classification = input.classification ?? DataClassification.CONFIDENTIAL;
  const payload = JSON.stringify({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    purpose: input.purpose ?? ctx.purpose ?? null,
    classification,
    ipAddress: ctx.ipAddress ?? null,
    occurredAt: occurredAt.toISOString()
  });
  const hash = createHash("sha256").update(`${previous?.hash ?? "GENESIS"}|${payload}`).digest("hex");

  return tx.auditEvent.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      purpose: input.purpose ?? ctx.purpose,
      classification,
      ipAddress: ctx.ipAddress,
      occurredAt,
      hash,
      previousHash: previous?.hash
    }
  });
}

export async function recordAudit({ ctx, ...input }: { ctx: RequestContext } & AuditInput) {
  return db.$transaction((tx) => appendAudit(tx, ctx, input));
}
