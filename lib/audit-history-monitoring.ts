import { DataClassification, PlatformRole, Prisma, type AuditHistoryVerificationProgress } from "@prisma/client";
import { computeAuditHash } from "@/lib/audit";
import { verifyAuditHistoryChunk } from "@/lib/audit-history-chunk.mjs";
import { db } from "@/lib/db";
import { enqueueNotificationOutbox } from "@/lib/notification-outbox";
import { createAuditVerificationScheduler } from "@/lib/audit-verification-schedule";
import { runtimeNumber } from "@/lib/runtime-env";

const SCAN_VERSION = 1;
const SCHEDULE_VERSION = 1;
const SCHEDULE_KEY = "audit-full-history";
const STATS_KEY = "audit-full-history";
const MAX_INTERVAL_HOURS = 24 * 365;

type CaptureResult =
  | { valid: true; targetSequence: bigint; targetTailHash: string | null }
  | { valid: false; code: string };

function failure(code: string): Error & { code: string } {
  return Object.assign(new Error("Audit full-history verification did not complete safely."), { code });
}
function validHash(value: string | null): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function pageSize() {
  return Math.min(1000, Math.max(1, Math.floor(runtimeNumber("HRBP_AUDIT_FULL_HISTORY_PAGE_SIZE", 250))));
}
function rescanIntervalMs() {
  const hours = Math.min(MAX_INTERVAL_HOURS,
    Math.max(1, Math.floor(runtimeNumber("HRBP_AUDIT_FULL_HISTORY_INTERVAL_HOURS", 168))));
  return hours * 60 * 60 * 1000;
}
function assertNow(now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError("Invalid audit history timestamp.");
}
function progressState(progress: AuditHistoryVerificationProgress) {
  if (progress.scanVersion !== SCAN_VERSION || progress.scheduleVersion !== SCHEDULE_VERSION ||
      !["RUNNING", "VALID", "INVALID"].includes(progress.status)) {
    throw failure("AUDIT_HISTORY_PROGRESS_VERSION_UNSUPPORTED");
  }
}
function fresh(progress: AuditHistoryVerificationProgress, now: Date, intervalMs: number) {
  if (progress.status !== "VALID" || !progress.lastSuccessAt) return false;
  if (progress.lastSuccessAt.getTime() > now.getTime() + 30_000) {
    throw failure("AUDIT_HISTORY_PROGRESS_CLOCK_INVALID");
  }
  return now.getTime() - progress.lastSuccessAt.getTime() < intervalMs;
}

async function captureTarget(tenantId: string): Promise<CaptureResult> {
  return db.$transaction(async tx => {
    const state = await tx.auditLedgerState.findUnique({
      where: { tenantId },
      select: { eventCount: true, tailHash: true }
    });
    const first = await tx.auditEvent.findFirst({
      where: { tenantId }, orderBy: { ledgerSequence: "asc" }, select: { ledgerSequence: true }
    });
    if (!state) {
      return first ? { valid: false as const, code: "MISSING_LEDGER_STATE" }
        : { valid: true as const, targetSequence: 0n, targetTailHash: null };
    }
    if (state.eventCount < 0n) return { valid: false as const, code: "INVALID_LEDGER_STATE" };
    if (state.eventCount === 0n) {
      return state.tailHash === null && !first
        ? { valid: true as const, targetSequence: 0n, targetTailHash: null }
        : { valid: false as const, code: "INVALID_EMPTY_LEDGER_STATE" };
    }
    if (!validHash(state.tailHash) || !first) {
      return { valid: false as const, code: "INVALID_LEDGER_STATE" };
    }
    return { valid: true as const, targetSequence: state.eventCount, targetTailHash: state.tailHash };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

async function updateStats(
  tx: Prisma.TransactionClient, now: Date, checked: number,
  outcome: "PARTIAL" | "SUCCESS" | "FAILURE"
) {
  const events = BigInt(Math.max(0, checked));
  await tx.auditHistoryVerificationStats.upsert({
    where: { id: STATS_KEY },
    create: {
      id: STATS_KEY, scanVersion: SCAN_VERSION, eventsChecked: events,
      partialChunks: outcome === "PARTIAL" ? 1n : 0n,
      successfulScans: outcome === "SUCCESS" ? 1n : 0n,
      failedScans: outcome === "FAILURE" ? 1n : 0n,
      lastAttemptAt: now,
      ...(outcome === "SUCCESS" ? { lastSuccessAt: now } : {}),
      ...(outcome === "FAILURE" ? { lastFailureAt: now } : {})
    },
    update: {
      eventsChecked: { increment: events },
      ...(outcome === "PARTIAL" ? { partialChunks: { increment: 1n } } : {}),
      ...(outcome === "SUCCESS" ? { successfulScans: { increment: 1n }, lastSuccessAt: now } : {}),
      ...(outcome === "FAILURE" ? { failedScans: { increment: 1n }, lastFailureAt: now } : {}),
      lastAttemptAt: now
    }
  });
}

async function notifyFailure(
  tx: Prisma.TransactionClient, tenantId: string, now: Date, code: string, checked: number,
  targetSequence: bigint | null
) {
  await enqueueNotificationOutbox(tx, {
    tenantId,
    eventType: "AUDIT_INTEGRITY_FAILURE",
    recipientRole: PlatformRole.TENANT_ADMIN,
    templateKey: "audit.integrity-failure",
    resourceType: "AuditEvent",
    resourceId: "full-history",
    dedupeKey: `audit-full-history:${code}:${targetSequence?.toString() ?? "state"}`,
    classification: DataClassification.RESTRICTED,
    payload: {
      brokenEventId: "full-history",
      reason: `Full-history verification failed (${code}).`,
      checked,
      scope: "FULL_HISTORY",
      generatedAt: now.toISOString()
    }
  });
}

async function initializeProgress(
  tx: Prisma.TransactionClient, tenantId: string, now: Date,
  target: Extract<CaptureResult, { valid: true }>
) {
  return tx.auditHistoryVerificationProgress.upsert({
    where: { tenantId },
    create: {
      tenantId, scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION, status: "RUNNING",
      targetSequence: target.targetSequence, targetTailHash: target.targetTailHash,
      verifiedSequence: 0n, verifiedHash: null, checkedEvents: 0n,
      scanStartedAt: now, targetCapturedAt: now, lastAttemptAt: now
    },
    update: {
      scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION, status: "RUNNING",
      targetSequence: target.targetSequence, targetTailHash: target.targetTailHash,
      verifiedSequence: 0n, verifiedHash: null, checkedEvents: 0n,
      scanStartedAt: now, targetCapturedAt: now, lastAttemptAt: now,
      completedAt: null, failureCode: null
    }
  });
}

async function recordInitialFailure(
  tx: Prisma.TransactionClient, tenantId: string, now: Date, code: string
) {
  await tx.auditHistoryVerificationProgress.upsert({
    where: { tenantId },
    create: {
      tenantId, scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION, status: "INVALID",
      targetSequence: null, targetTailHash: null, verifiedSequence: 0n, verifiedHash: null,
      checkedEvents: 0n, scanStartedAt: now, targetCapturedAt: now, lastAttemptAt: now,
      lastFailureAt: now, completedAt: now, failureCode: code
    },
    update: {
      scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION, status: "INVALID",
      targetSequence: null, targetTailHash: null, verifiedSequence: 0n, verifiedHash: null,
      checkedEvents: 0n, scanStartedAt: now, targetCapturedAt: now, lastAttemptAt: now,
      lastFailureAt: now, completedAt: now, failureCode: code
    }
  });
  await updateStats(tx, now, 0, "FAILURE");
  await notifyFailure(tx, tenantId, now, code, 0, null);
}

async function verifyChunk(progress: AuditHistoryVerificationProgress, take: number) {
  return db.$transaction(
    tx => verifyAuditHistoryChunk(tx, progress, take, computeAuditHash),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}

function expectedWhere(progress: AuditHistoryVerificationProgress) {
  return {
    tenantId: progress.tenantId,
    scanVersion: SCAN_VERSION,
    scheduleVersion: SCHEDULE_VERSION,
    status: "RUNNING",
    targetSequence: progress.targetSequence,
    targetTailHash: progress.targetTailHash,
    verifiedSequence: progress.verifiedSequence,
    verifiedHash: progress.verifiedHash
  };
}

async function recordPartial(
  tx: Prisma.TransactionClient, progress: AuditHistoryVerificationProgress, now: Date,
  chunk: Awaited<ReturnType<typeof verifyChunk>>
) {
  const changed = await tx.auditHistoryVerificationProgress.updateMany({
    where: expectedWhere(progress),
    data: {
      verifiedSequence: chunk.nextSequence,
      verifiedHash: chunk.nextHash,
      checkedEvents: { increment: BigInt(chunk.checked) },
      lastAttemptAt: now
    }
  });
  if (changed.count !== 1) throw failure("AUDIT_HISTORY_PROGRESS_CONFLICT");
  await updateStats(tx, now, chunk.checked, "PARTIAL");
}

async function recordSuccess(
  tx: Prisma.TransactionClient, progress: AuditHistoryVerificationProgress, now: Date,
  chunk: Awaited<ReturnType<typeof verifyChunk>>
) {
  const changed = await tx.auditHistoryVerificationProgress.updateMany({
    where: expectedWhere(progress),
    data: {
      status: "VALID",
      verifiedSequence: chunk.nextSequence,
      verifiedHash: chunk.nextHash,
      checkedEvents: { increment: BigInt(chunk.checked) },
      lastAttemptAt: now, lastSuccessAt: now, completedAt: now, failureCode: null
    }
  });
  if (changed.count !== 1) throw failure("AUDIT_HISTORY_PROGRESS_CONFLICT");
  await updateStats(tx, now, chunk.checked, "SUCCESS");
}

async function recordFailure(
  tx: Prisma.TransactionClient, progress: AuditHistoryVerificationProgress, now: Date,
  chunk: Awaited<ReturnType<typeof verifyChunk>>
) {
  const changed = await tx.auditHistoryVerificationProgress.updateMany({
    where: expectedWhere(progress),
    data: {
      status: "INVALID",
      checkedEvents: { increment: BigInt(chunk.checked) },
      lastAttemptAt: now, lastFailureAt: now, completedAt: now, failureCode: chunk.code
    }
  });
  if (changed.count !== 1) throw failure("AUDIT_HISTORY_PROGRESS_CONFLICT");
  await updateStats(tx, now, chunk.checked, "FAILURE");
  await notifyFailure(tx, progress.tenantId, now, chunk.code, chunk.checked, progress.targetSequence);
}

export async function advanceAuditHistoryVerification(now = new Date()) {
  assertNow(now);
  const take = pageSize();
  const intervalMs = rescanIntervalMs();
  const tenantUniverse = await db.tenant.count();
  const scheduler = createAuditVerificationScheduler(db, SCHEDULE_KEY);
  const lease = await scheduler.start(1);
  let finished = false;

  try {
    if (!lease.tenants.length) {
      const schedule = await scheduler.finish(lease);
      finished = true;
      return {
        scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION,
        selectionMode: "DURABLE_KEYSET" as const, outcome: "NO_TENANTS" as const,
        tenantUniverse, eventsChecked: 0, cycleCompleted: schedule.cycleCompleted
      };
    }

    const tenant = lease.tenants[0];
    let progress = await db.auditHistoryVerificationProgress.findUnique({ where: { tenantId: tenant.id } });
    if (progress) {
      progressState(progress);
      if (fresh(progress, now, intervalMs)) {
        await scheduler.checkpoint(lease, tenant, async () => true);
        const schedule = await scheduler.finish(lease); finished = true;
        return {
          scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION,
          selectionMode: "DURABLE_KEYSET" as const, outcome: "FRESH" as const,
          tenantUniverse, eventsChecked: 0, cycleCompleted: schedule.cycleCompleted
        };
      }
    }

    if (!progress || progress.status !== "RUNNING") {
      const target = await captureTarget(tenant.id);
      if (!target.valid) {
        await scheduler.checkpoint(lease, tenant,
          tx => recordInitialFailure(tx, tenant.id, now, target.code));
        await scheduler.finish(lease); finished = true;
        throw failure("AUDIT_HISTORY_INTEGRITY_FAILURE");
      }
      progress = await scheduler.persist(lease,
        tx => initializeProgress(tx, tenant.id, now, target));
    }

    progressState(progress);
    const chunk = await verifyChunk(progress, take);
    if (!chunk.valid) {
      await scheduler.checkpoint(lease, tenant, tx => recordFailure(tx, progress!, now, chunk));
      await scheduler.finish(lease); finished = true;
      throw failure("AUDIT_HISTORY_INTEGRITY_FAILURE");
    }

    if (!chunk.complete) {
      await scheduler.persist(lease, tx => recordPartial(tx, progress!, now, chunk));
      return {
        scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION,
        selectionMode: "DURABLE_KEYSET" as const, outcome: "PARTIAL" as const,
        tenantUniverse, eventsChecked: chunk.checked, cycleCompleted: false
      };
    }

    await scheduler.checkpoint(lease, tenant, tx => recordSuccess(tx, progress!, now, chunk));
    const schedule = await scheduler.finish(lease); finished = true;
    return {
      scanVersion: SCAN_VERSION, scheduleVersion: SCHEDULE_VERSION,
      selectionMode: "DURABLE_KEYSET" as const, outcome: "VERIFIED" as const,
      tenantUniverse, eventsChecked: chunk.checked, cycleCompleted: schedule.cycleCompleted
    };
  } finally {
    if (!finished) await scheduler.release(lease).catch(() => undefined);
  }
}

type AggregateRow = {
  trackedTenants: bigint;
  orphanedProgressRecords: bigint;
  running: bigint;
  valid: bigint;
  invalid: bigint;
  backlogEvents: bigint;
  oldestRunningAt: Date | null;
};

export async function auditHistoryAggregateMetrics(now = new Date()) {
  assertNow(now);
  const [tenantUniverse, rows, stats] = await Promise.all([
    db.tenant.count(),
    db.$queryRaw<AggregateRow[]>`
      SELECT COUNT(*) FILTER (WHERE t."id" IS NOT NULL)::bigint AS "trackedTenants",
        COUNT(*) FILTER (WHERE t."id" IS NULL)::bigint AS "orphanedProgressRecords",
        COUNT(*) FILTER (WHERE t."id" IS NOT NULL AND p."status" = 'RUNNING')::bigint AS "running",
        COUNT(*) FILTER (WHERE t."id" IS NOT NULL AND p."status" = 'VALID')::bigint AS "valid",
        COUNT(*) FILTER (WHERE t."id" IS NOT NULL AND p."status" = 'INVALID')::bigint AS "invalid",
        COALESCE(SUM(CASE WHEN t."id" IS NOT NULL AND p."status" = 'RUNNING' AND p."targetSequence" IS NOT NULL
          THEN GREATEST(p."targetSequence" - p."verifiedSequence", 0) ELSE 0 END), 0)::bigint AS "backlogEvents",
        MIN(p."scanStartedAt") FILTER (WHERE t."id" IS NOT NULL AND p."status" = 'RUNNING') AS "oldestRunningAt"
      FROM "AuditHistoryVerificationProgress" p
      LEFT JOIN "Tenant" t ON t."id" = p."tenantId"
    `,
    db.auditHistoryVerificationStats.findUnique({ where: { id: STATS_KEY } })
  ]);
  const row = rows[0] ?? {
    trackedTenants: 0n, orphanedProgressRecords: 0n,
    running: 0n, valid: 0n, invalid: 0n, backlogEvents: 0n, oldestRunningAt: null
  };
  const tracked = Number(row.trackedTenants <= BigInt(Number.MAX_SAFE_INTEGER) ? row.trackedTenants : BigInt(Number.MAX_SAFE_INTEGER));
  const age = (value: Date | null | undefined) =>
    value ? Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1000)) : 0;
  return {
    tenantUniverse,
    trackedTenants: row.trackedTenants.toString(),
    untrackedTenants: Math.max(0, tenantUniverse - tracked),
    orphanedProgressRecords: row.orphanedProgressRecords.toString(),
    running: row.running.toString(),
    valid: row.valid.toString(),
    invalid: row.invalid.toString(),
    backlogEvents: row.backlogEvents.toString(),
    oldestRunningAgeSeconds: age(row.oldestRunningAt),
    eventsCheckedTotal: stats?.eventsChecked.toString() ?? "0",
    partialChunksTotal: stats?.partialChunks.toString() ?? "0",
    successfulScansTotal: stats?.successfulScans.toString() ?? "0",
    failedScansTotal: stats?.failedScans.toString() ?? "0",
    lastAttemptAgeSeconds: age(stats?.lastAttemptAt),
    lastSuccessAgeSeconds: age(stats?.lastSuccessAt),
    lastFailureAgeSeconds: age(stats?.lastFailureAt)
  };
}
