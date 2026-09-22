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

export type AuditHashInput = {
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  purpose: string | null;
  classification: DataClassification;
  ipAddress: string | null;
  occurredAt: Date;
};

export function computeAuditHash(input: AuditHashInput, previousHash: string | null) {
  const payload = JSON.stringify({
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    purpose: input.purpose,
    classification: input.classification,
    ipAddress: input.ipAddress,
    occurredAt: input.occurredAt.toISOString()
  });
  return createHash("sha256").update(`${previousHash ?? "GENESIS"}|${payload}`).digest("hex");
}

export async function appendAudit(tx: Prisma.TransactionClient, ctx: RequestContext, input: AuditInput) {
  const occurredAt = new Date();
  const previous = await tx.auditEvent.findFirst({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { hash: true }
  });
  const classification = input.classification ?? DataClassification.CONFIDENTIAL;
  const purpose = input.purpose ?? ctx.purpose ?? null;
  const ipAddress = ctx.ipAddress ?? null;
  const hash = computeAuditHash({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    purpose,
    classification,
    ipAddress,
    occurredAt
  }, previous?.hash ?? null);

  return tx.auditEvent.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      purpose,
      classification,
      ipAddress,
      occurredAt,
      hash,
      previousHash: previous?.hash
    }
  });
}

export async function recordAudit({ ctx, ...input }: { ctx: RequestContext } & AuditInput) {
  return db.$transaction((tx) => appendAudit(tx, ctx, input));
}
