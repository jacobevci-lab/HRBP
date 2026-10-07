import { createHash } from "node:crypto";
import { DataClassification, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { lockAuditLedger } from "@/lib/audit-ledger-lock.mjs";
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
  // Every writer for one tenant must serialize before reading or advancing the
  // ledger tail. This prevents two committed events from sharing one predecessor.
  await lockAuditLedger(tx, ctx.tenantId);

  let state = await tx.auditLedgerState.findUnique({
    where: { tenantId: ctx.tenantId },
    select: { tailHash: true, eventCount: true }
  });

  if (!state) {
    const existing = await tx.auditEvent.findFirst({
      where: { tenantId: ctx.tenantId },
      select: { id: true }
    });
    if (existing) {
      throw new Error("Audit ledger state is missing for a non-empty tenant ledger.");
    }
    state = await tx.auditLedgerState.create({
      data: {
        tenantId: ctx.tenantId,
        tailHash: null,
        eventCount: 0n
      },
      select: { tailHash: true, eventCount: true }
    });
  }

  const occurredAt = new Date();
  const classification = input.classification ?? DataClassification.CONFIDENTIAL;
  const purpose = input.purpose ?? ctx.purpose ?? null;
  const ipAddress = ctx.ipAddress ?? null;
  const ledgerSequence = state.eventCount + 1n;
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
  }, state.tailHash);

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
      previousHash: state.tailHash
    }
  });

  const advanced = await tx.auditLedgerState.updateMany({
    where: {
      tenantId: ctx.tenantId,
      tailHash: state.tailHash,
      eventCount: state.eventCount
    },
    data: {
      tailHash: hash,
      eventCount: { increment: 1 }
    }
  });
  if (advanced.count !== 1) {
    throw new Error("Audit ledger tail changed while appending an event.");
  }

  return event;
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
