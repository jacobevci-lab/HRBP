import { DataClassification, PlatformRole, VaultScanStatus } from "@prisma/client";
import { appendAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { asEnumValue, asIdentifier, asOptionalText, asText, readJsonObject } from "@/lib/input-validation";
import { internalBearerAuthorized } from "@/lib/internal-auth";
import { runtimeNumber } from "@/lib/runtime-env";
import type { RequestContext } from "@/lib/request-context";

const finalScanStatuses = [VaultScanStatus.CLEAN, VaultScanStatus.QUARANTINED, VaultScanStatus.FAILED] as const;
const activeScanStatuses = [VaultScanStatus.PENDING, VaultScanStatus.SCANNING] as const;

function scannerContext(tenantId: string): RequestContext {
  return {
    tenantId,
    actorId: "system:document-scanner",
    role: PlatformRole.TENANT_ADMIN,
    purpose: "Malware scanning callback"
  };
}

function maxAttempts() {
  return Math.min(20, Math.max(2, Math.floor(runtimeNumber("HRBP_DOCUMENT_SCAN_MAX_ATTEMPTS", 5))));
}

function retryDelayMs(attempt: number) {
  const baseSeconds = Math.min(600, Math.max(10, Math.floor(runtimeNumber("HRBP_DOCUMENT_SCAN_RETRY_BASE_SECONDS", 30))));
  const maxSeconds = Math.min(3600, Math.max(baseSeconds, Math.floor(runtimeNumber("HRBP_DOCUMENT_SCAN_RETRY_MAX_SECONDS", 600))));
  return Math.min(maxSeconds, baseSeconds * Math.pow(2, Math.max(0, attempt - 1))) * 1000;
}

async function recoverStaleScanLocks(now: Date) {
  const lockMinutes = Math.min(120, Math.max(2, Math.floor(runtimeNumber("HRBP_DOCUMENT_SCAN_LOCK_MINUTES", 15))));
  const staleBefore = new Date(now.getTime() - lockMinutes * 60_000);
  return db.documentVersion.updateMany({
    where: {
      scanStatus: VaultScanStatus.SCANNING,
      scanLockedAt: { lte: staleBefore }
    },
    data: {
      scanStatus: VaultScanStatus.PENDING,
      scanLockedAt: null,
      scanNextAttemptAt: now,
      scanEngine: null,
      scanReference: null,
      scanMessage: "Recovered stale scanner lock"
    }
  });
}

async function claimScanJob() {
  const now = new Date();
  await recoverStaleScanLocks(now);
  const limit = maxAttempts();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await db.documentVersion.findFirst({
      where: {
        uploadedAt: { not: null },
        scanStatus: VaultScanStatus.PENDING,
        scanNextAttemptAt: { lte: now },
        scanAttempts: { lt: limit }
      },
      orderBy: [{ scanNextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        tenantId: true,
        objectKey: true,
        contentType: true,
        contentHash: true,
        sizeBytes: true,
        classification: true,
        scanAttempts: true
      }
    });
    if (!candidate) return null;

    const claimed = await db.documentVersion.updateMany({
      where: {
        id: candidate.id,
        scanStatus: VaultScanStatus.PENDING,
        uploadedAt: { not: null },
        scanAttempts: candidate.scanAttempts,
        scanNextAttemptAt: { lte: now }
      },
      data: {
        scanStatus: VaultScanStatus.SCANNING,
        scanAttempts: { increment: 1 },
        scanLockedAt: now,
        scanCompletedAt: null,
        scanEngine: null,
        scanReference: null,
        scanMessage: null
      }
    });
    if (claimed.count !== 1) continue;

    return {
      versionId: candidate.id,
      objectKey: candidate.objectKey,
      contentType: candidate.contentType,
      contentHash: candidate.contentHash,
      sizeBytes: candidate.sizeBytes?.toString() ?? null,
      classification: candidate.classification,
      attempt: candidate.scanAttempts + 1
    };
  }
  return null;
}

function transientReason(value: unknown) {
  const reason = asOptionalText(value, 100);
  if (!reason) return "SCANNER_TRANSIENT_FAILURE";
  return /^[A-Z0-9_:-]{3,100}$/.test(reason) ? reason : "SCANNER_TRANSIENT_FAILURE";
}

async function releaseScanJob(versionId: string, reason: string) {
  const current = await db.documentVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      tenantId: true,
      scanStatus: true,
      scanAttempts: true,
      classification: true
    }
  });
  if (!current) return { kind: "not-found" as const };
  if (current.scanStatus !== VaultScanStatus.SCANNING) return { kind: "conflict" as const, status: current.scanStatus };

  const now = new Date();
  const exhausted = current.scanAttempts >= maxAttempts();

  if (exhausted) {
    const data = await db.$transaction(async (tx) => {
      const changed = await tx.documentVersion.updateMany({
        where: {
          id: current.id,
          scanStatus: VaultScanStatus.SCANNING,
          scanAttempts: current.scanAttempts
        },
        data: {
          scanStatus: VaultScanStatus.FAILED,
          scanLockedAt: null,
          scanCompletedAt: now,
          scanEngine: "HRBP Scanner Worker",
          scanReference: "RETRY_BUDGET_EXHAUSTED",
          scanMessage: "Scanner infrastructure retry budget exhausted"
        }
      });
      if (changed.count !== 1) return null;
      const updated = await tx.documentVersion.findUnique({ where: { id: current.id } });
      if (!updated) return null;
      await appendAudit(tx, scannerContext(current.tenantId), {
        action: "document.scan-failed",
        resourceType: "DocumentVersion",
        resourceId: current.id,
        classification: current.classification ?? DataClassification.RESTRICTED,
        purpose: "Malware scanner retry budget exhausted"
      });
      return updated;
    });
    return data ? { kind: "failed" as const, data } : { kind: "conflict" as const, status: VaultScanStatus.SCANNING };
  }

  const nextAttemptAt = new Date(now.getTime() + retryDelayMs(current.scanAttempts));
  const changed = await db.documentVersion.updateMany({
    where: {
      id: current.id,
      scanStatus: VaultScanStatus.SCANNING,
      scanAttempts: current.scanAttempts
    },
    data: {
      scanStatus: VaultScanStatus.PENDING,
      scanLockedAt: null,
      scanNextAttemptAt: nextAttemptAt,
      scanEngine: null,
      scanReference: null,
      scanMessage: reason
    }
  });
  return changed.count === 1
    ? { kind: "retry" as const, nextAttemptAt }
    : { kind: "conflict" as const, status: VaultScanStatus.SCANNING };
}

async function completeScanJob(input: {
  versionId: string;
  status: VaultScanStatus.CLEAN | VaultScanStatus.QUARANTINED | VaultScanStatus.FAILED;
  engine: string;
  reference: string | null;
  message: string | null;
}) {
  return db.$transaction(async (tx) => {
    const current = await tx.documentVersion.findUnique({ where: { id: input.versionId } });
    if (!current) return { kind: "not-found" as const };
    if (!current.uploadedAt) return { kind: "not-uploaded" as const };

    if (finalScanStatuses.includes(current.scanStatus as typeof finalScanStatuses[number])) {
      if (current.scanStatus === input.status) return { kind: "ok" as const, data: current, idempotent: true };
      return { kind: "conflict" as const, status: current.scanStatus };
    }
    if (!activeScanStatuses.includes(current.scanStatus as typeof activeScanStatuses[number])) {
      return { kind: "conflict" as const, status: current.scanStatus };
    }

    const now = new Date();
    const changed = await tx.documentVersion.updateMany({
      where: {
        id: current.id,
        scanStatus: current.scanStatus,
        scanAttempts: current.scanAttempts
      },
      data: {
        scanStatus: input.status,
        scanLockedAt: null,
        scanCompletedAt: now,
        scanEngine: input.engine,
        scanReference: input.reference,
        scanMessage: input.message
      }
    });
    if (changed.count !== 1) return { kind: "conflict" as const, status: current.scanStatus };

    const updated = await tx.documentVersion.findUnique({ where: { id: current.id } });
    if (!updated) return { kind: "conflict" as const, status: current.scanStatus };

    await appendAudit(tx, scannerContext(current.tenantId), {
      action: `document.scan-${input.status.toLowerCase()}`,
      resourceType: "DocumentVersion",
      resourceId: current.id,
      classification: current.classification ?? DataClassification.RESTRICTED,
      purpose: `${input.engine} malware scan completed with ${input.status}`
    });
    return { kind: "ok" as const, data: updated, idempotent: false };
  });
}

export async function POST(request: Request) {
  if (!internalBearerAuthorized(request, "HRBP_DOCUMENT_SCAN_TOKEN")) {
    return Response.json({ error: "Valid document scanner credentials are required." }, { status: 401 });
  }

  const body = await readJsonObject(request);
  if (!body) return Response.json({ error: "JSON body must be an object." }, { status: 400 });

  if (body.action === "claim") {
    const job = await claimScanJob();
    return Response.json({ data: { job } }, { headers: { "cache-control": "no-store" } });
  }

  const versionId = asIdentifier(body.versionId);
  if (!versionId) return Response.json({ error: "A valid versionId is required." }, { status: 400 });

  if (body.action === "release") {
    const result = await releaseScanJob(versionId, transientReason(body.reason));
    if (result.kind === "not-found") return Response.json({ error: "Document version not found." }, { status: 404 });
    if (result.kind === "conflict") return Response.json({ error: "Document scan state changed concurrently.", status: result.status }, { status: 409 });
    if (result.kind === "failed") return Response.json({ data: { status: result.data.scanStatus, exhausted: true } });
    return Response.json({ data: { status: VaultScanStatus.PENDING, nextAttemptAt: result.nextAttemptAt.toISOString() } });
  }

  const status = asEnumValue(body.status, finalScanStatuses);
  const engine = asText(body.engine, 100);
  const reference = asOptionalText(body.reference, 200);
  const message = asOptionalText(body.message, 500);
  if (!status || !engine || reference === null || message === null) {
    return Response.json({
      error: "status CLEAN|QUARANTINED|FAILED and engine are required; reference/message must be plain text when supplied."
    }, { status: 400 });
  }

  const result = await completeScanJob({
    versionId,
    status,
    engine,
    reference: reference || null,
    message: message || null
  });
  if (result.kind === "not-found") return Response.json({ error: "Document version not found." }, { status: 404 });
  if (result.kind === "not-uploaded") return Response.json({ error: "Document object must be uploaded before scan completion can be recorded." }, { status: 409 });
  if (result.kind === "conflict") return Response.json({ error: "Document scan state changed concurrently.", status: result.status }, { status: 409 });
  return Response.json({ data: result.data, idempotent: result.idempotent });
}
