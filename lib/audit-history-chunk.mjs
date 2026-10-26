const HASH = /^[a-f0-9]{64}$/;
const MAX_PAGE_SIZE = 1000;

function invalidProgress() {
  const error = new Error("Audit history progress is invalid.");
  error.code = "AUDIT_HISTORY_PROGRESS_INVALID";
  throw error;
}
function validHash(value) {
  return typeof value === "string" && HASH.test(value);
}
function bigint(value) {
  return typeof value === "bigint" ? value : invalidProgress();
}

export function validateAuditHistoryProgress(progress) {
  if (!progress || typeof progress !== "object" || progress.scanVersion !== 1 ||
      progress.scheduleVersion !== 1 || progress.status !== "RUNNING" ||
      typeof progress.tenantId !== "string" || !progress.tenantId ||
      progress.targetSequence === null || progress.targetSequence === undefined) invalidProgress();

  const targetSequence = bigint(progress.targetSequence);
  const verifiedSequence = bigint(progress.verifiedSequence);
  if (targetSequence < 0n || verifiedSequence < 0n || verifiedSequence > targetSequence) invalidProgress();
  if ((targetSequence === 0n && progress.targetTailHash !== null) ||
      (targetSequence > 0n && !validHash(progress.targetTailHash))) invalidProgress();
  if ((verifiedSequence === 0n && progress.verifiedHash !== null) ||
      (verifiedSequence > 0n && !validHash(progress.verifiedHash))) invalidProgress();
  return { targetSequence, verifiedSequence };
}

function result(code, { checked = 0, sequence, hash, complete = false } = {}) {
  return {
    valid: code === "CHUNK_VERIFIED",
    complete,
    code,
    checked,
    nextSequence: sequence,
    nextHash: hash
  };
}

/** Verify one bounded prefix chunk against a target captured by another trusted
 * database transaction. Rows beyond targetSequence are deliberately ignored:
 * a normal concurrent append belongs to the next full-history scan.
 */
export async function verifyAuditHistoryChunk(client, progress, pageSize, computeHash) {
  if (!client?.auditEvent?.findFirst || !client?.auditEvent?.findMany ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE ||
      typeof computeHash !== "function") {
    throw new RangeError("Invalid audit history chunk verifier configuration.");
  }
  const { targetSequence, verifiedSequence } = validateAuditHistoryProgress(progress);

  let previousHash = progress.verifiedHash;
  if (verifiedSequence > 0n) {
    const anchor = await client.auditEvent.findFirst({
      where: { tenantId: progress.tenantId, ledgerSequence: verifiedSequence },
      select: { hash: true }
    });
    if (!anchor || anchor.hash !== previousHash) {
      return result("RESUME_ANCHOR_MISMATCH", { sequence: verifiedSequence, hash: previousHash });
    }
  }

  if (verifiedSequence === targetSequence) {
    if (previousHash !== progress.targetTailHash) {
      return result("TARGET_HASH_MISMATCH", { sequence: verifiedSequence, hash: previousHash });
    }
    return result("CHUNK_VERIFIED", {
      sequence: verifiedSequence, hash: previousHash, complete: true
    });
  }

  const remaining = targetSequence - verifiedSequence;
  const take = Number(remaining < BigInt(pageSize) ? remaining : BigInt(pageSize));
  const rows = await client.auditEvent.findMany({
    where: {
      tenantId: progress.tenantId,
      ledgerSequence: { gt: verifiedSequence, lte: targetSequence }
    },
    orderBy: { ledgerSequence: "asc" },
    take,
    select: {
      tenantId: true,
      ledgerSequence: true,
      actorId: true,
      action: true,
      resourceType: true,
      resourceId: true,
      purpose: true,
      classification: true,
      ipAddress: true,
      occurredAt: true,
      hash: true,
      previousHash: true
    }
  });

  if (!Array.isArray(rows) || rows.length > take) {
    return result("INVALID_PAGE", { sequence: verifiedSequence, hash: previousHash });
  }

  let sequence = verifiedSequence;
  let checked = 0;
  for (const row of rows) {
    const expected = sequence + 1n;
    if (row.tenantId !== progress.tenantId) {
      return result("CROSS_TENANT_ROW", { checked, sequence, hash: previousHash });
    }
    if (row.ledgerSequence !== expected) {
      return result("SEQUENCE_GAP", { checked, sequence, hash: previousHash });
    }
    if (row.previousHash !== previousHash) {
      return result("PREVIOUS_HASH_MISMATCH", { checked, sequence, hash: previousHash });
    }
    if (!validHash(row.hash)) {
      return result("INVALID_EVENT_HASH", { checked, sequence, hash: previousHash });
    }
    let expectedHash;
    try {
      expectedHash = computeHash({
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        purpose: row.purpose,
        classification: row.classification,
        ipAddress: row.ipAddress,
        occurredAt: row.occurredAt
      }, row.previousHash);
    } catch {
      return result("INVALID_EVENT_DATA", { checked, sequence, hash: previousHash });
    }
    if (expectedHash !== row.hash) {
      return result("EVENT_HASH_MISMATCH", { checked, sequence, hash: previousHash });
    }
    checked += 1;
    sequence = row.ledgerSequence;
    previousHash = row.hash;
  }

  if (rows.length !== take) {
    return result("SEQUENCE_GAP", { checked, sequence, hash: previousHash });
  }
  if (sequence === targetSequence) {
    if (previousHash !== progress.targetTailHash) {
      return result("TARGET_HASH_MISMATCH", { checked, sequence, hash: previousHash });
    }
    return result("CHUNK_VERIFIED", { checked, sequence, hash: previousHash, complete: true });
  }
  return result("CHUNK_VERIFIED", { checked, sequence, hash: previousHash, complete: false });
}
