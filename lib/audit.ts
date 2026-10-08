import { createHash } from "node:crypto";
import { DataClassification, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendToAuditLedger } from "@/lib/audit-ledger-lock.mjs";
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

type AuditActorContext = {
  tenantId: string;
  actorId: string;
  purpose?: string;
  ipAddress?: string;
};

async function appendAuditActor(tx: Prisma.TransactionClient, ctx: AuditActorContext, input: AuditInput) {
  return appendToAuditLedger(tx, ctx.tenantId, async ({ previousHash, ledgerSequence }) => {
    const occurredAt = new Date();
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
    }, previousHash);

    const event = await tx.auditEvent.create({
      data: {
        tenantId: ctx.tenantId,
        ledgerSequence,
        actorId: ctx.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        purpose,
        classification,
        ipAddress,
        occurredAt,
        hash,
        previousHash
      }
    });

    return { nextHash: hash, value: event };
  });
}

export async function appendAudit(tx: Prisma.TransactionClient, ctx: RequestContext, input: AuditInput) {
  return appendAuditActor(tx, ctx, input);
}

export async function appendSystemAudit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
  input: AuditInput
) {
  return appendAuditActor(tx, { tenantId, actorId }, input);
}

export async function recordAudit({ ctx, ...input }: { ctx: RequestContext } & AuditInput) {
  return db.$transaction((tx) => appendAudit(tx, ctx, input));
}
