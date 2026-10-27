import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const MAX_PAGE_SIZE = 1000;
const MAX_EVENTS = 1_000_000;
const DEFAULT_MAX_EVENTS = 50_000;
const DEFAULT_BATCH_SIZE = 250;

/** Separate opt-in, read-only verification of an entire bounded tenant ledger.
 * No scheduler integration: a long-running repeatable-read snapshot must never
 * be introduced silently into the 15-minute maintenance/notification path.
 */
export function auditHistoryOptions({ tenantId, maxEvents = DEFAULT_MAX_EVENTS, batchSize = DEFAULT_BATCH_SIZE,
  maxDurationMs = 45_000 } = {}) {
  if (typeof tenantId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(tenantId)) {
    throw new RangeError("A bounded tenant identifier is required.");
  }
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EVENTS ||
      !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_PAGE_SIZE ||
      !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 120_000) {
    throw new RangeError("Full-history verification budgets are invalid.");
  }
  return { tenantId, maxEvents, batchSize, maxDurationMs };
}

function validHash(hash) {
  return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
}

export function fullAuditHash(row, previousHash) {
  if (!(row.occurredAt instanceof Date) || Number.isNaN(row.occurredAt.getTime())) {
    throw new RangeError("Invalid audit event timestamp.");
  }
  const payload = JSON.stringify({
    tenantId: row.tenantId,
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    purpose: row.purpose,
    classification: row.classification,
    ipAddress: row.ipAddress,
    occurredAt: row.occurredAt.toISOString()
  });
  return createHash("sha256").update((previousHash ?? "GENESIS") + "|" + payload).digest("hex");
}

function report(code, eventsChecked, lastSequence) {
  return { valid: code === "FULL_CHAIN_VERIFIED" || code === "VALID_EMPTY", complete:
    code === "FULL_CHAIN_VERIFIED" || code === "VALID_EMPTY", code, eventsChecked,
    lastSequence: lastSequence.toString(), scope: "FULL_READ_ONLY_SNAPSHOT" };
}

/** Requires a caller-provided query client. No writes or raw event fields are returned.
 * Optional evidence is for the separate trusted-operator checkpoint tool only.
 * The caller must authenticate an external anchor before supplying it here.
 * Default report fields and the existing CLI output remain unchanged.
 */
export async function verifyFullAuditHistory(client, input, clock = Date.now, evidence = {}) {
  const { tenantId, maxEvents, batchSize, maxDurationMs } = auditHistoryOptions(input);
  if (!client || typeof client.query !== "function") throw new TypeError("A database client is required.");
  const { includeVerifiedHead = false, anchor = null } = evidence;
  if (typeof includeVerifiedHead !== "boolean" || (anchor !== null &&
      (typeof anchor !== "object" || typeof anchor.sequence !== "string" ||
       !/^(0|[1-9][0-9]{0,18})$/.test(anchor.sequence) ||
       BigInt(anchor.sequence) > 9223372036854775807n ||
       (anchor.sequence === "0" ? anchor.hash !== null : !validHash(anchor.hash))))) {
    throw new RangeError("Invalid trusted audit checkpoint anchor.");
  }
  const anchorSequence = anchor === null ? null : BigInt(anchor.sequence);
  const started = clock();
  if (!Number.isFinite(started)) throw new RangeError("Invalid audit verification clock.");
  const expired = () => {
    const current = clock();
    return !Number.isFinite(current) || current < started || current - started > maxDurationMs;
  };
  function success(code, checked, sequence, hash) {
    if (expired()) return report("VERIFICATION_TIME_BUDGET_EXCEEDED", checked, sequence);
    const result = report(code, checked, sequence);
    return includeVerifiedHead ? { ...result, verifiedHead: { sequence: sequence.toString(), hash } } : result;
  }
  let began = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    await client.query("SET LOCAL statement_timeout = '10000ms'");

    const tenants = await client.query('SELECT "id" FROM "Tenant" WHERE "id" = $1 LIMIT 1', [tenantId]);
    if (tenants.rows.length !== 1) return report("TENANT_NOT_FOUND", 0, 0n);

    const states = await client.query('SELECT "eventCount", "tailHash" FROM "AuditLedgerState" WHERE "tenantId" = $1', [tenantId]);
    const state = states.rows[0] ?? null;
    let storedCount = null;
    if (state) {
      try { storedCount = BigInt(state.eventCount); } catch { return report("INVALID_LEDGER_STATE", 0, 0n); }
      if (storedCount < 0n || (storedCount === 0n && state.tailHash !== null) ||
          (storedCount > 0n && !validHash(state.tailHash))) {
        return report("INVALID_LEDGER_STATE", 0, 0n);
      }
      // Fail before a large historical scan if the operator has not explicitly
      // authorized the ledger's size. An incomplete run is never marked valid.
      if (storedCount > BigInt(maxEvents)) return report("VERIFICATION_BUDGET_EXCEEDED", 0, 0n);
    }

    let sequence = 0n;
    let previousHash = null;
    let checked = 0;
    while (true) {
      if (expired()) return report("VERIFICATION_TIME_BUDGET_EXCEEDED", checked, sequence);
      const limit = Math.min(batchSize, maxEvents - checked + 1);
      const page = await client.query(
        'SELECT "tenantId", "ledgerSequence", "actorId", "action", "resourceType", "resourceId", "purpose", ' +
        '"classification", "ipAddress", "occurredAt", "hash", "previousHash" FROM "AuditEvent" ' +
        'WHERE "tenantId" = $1 AND "ledgerSequence" > $2::bigint ORDER BY "ledgerSequence" ASC LIMIT $3',
        [tenantId, sequence.toString(), limit]
      );
      if (!Array.isArray(page.rows) || page.rows.length > limit) return report("INVALID_PAGE", checked, sequence);
      if (!page.rows.length) break;
      for (const row of page.rows) {
        if (expired()) return report("VERIFICATION_TIME_BUDGET_EXCEEDED", checked, sequence);
        if (checked >= maxEvents) return report("VERIFICATION_BUDGET_EXCEEDED", checked, sequence);
        let next;
        try { next = BigInt(row.ledgerSequence); } catch { return report("INVALID_SEQUENCE", checked, sequence); }
        if (next !== sequence + 1n) return report("SEQUENCE_GAP", checked, sequence);
        if (row.tenantId !== tenantId) return report("CROSS_TENANT_ROW", checked, sequence);
        if (row.previousHash !== previousHash) return report("PREVIOUS_HASH_MISMATCH", checked, sequence);
        if (!validHash(row.hash)) return report("INVALID_EVENT_HASH", checked, sequence);
        let expectedHash;
        try { expectedHash = fullAuditHash(row, previousHash); }
        catch { return report("INVALID_EVENT_DATA", checked, sequence); }
        if (expectedHash !== row.hash) return report("EVENT_HASH_MISMATCH", checked, sequence);
        // Compare at the old signed sequence, not the newer tail. Rehashing the
        // entire database consistently must not defeat a retained external anchor.
        if (anchorSequence === next && row.hash !== anchor.hash) {
          return report("CHECKPOINT_HASH_MISMATCH", checked, sequence);
        }
        checked++;
        sequence = next;
        previousHash = row.hash;
      }
    }

    if (anchorSequence !== null && sequence < anchorSequence) {
      return report("CHECKPOINT_SEQUENCE_MISSING", checked, sequence);
    }
    if (!state) return checked === 0 ? success("VALID_EMPTY", 0, 0n, null) : report("MISSING_LEDGER_STATE", checked, sequence);
    if (storedCount !== sequence || state.tailHash !== previousHash) {
      return report("LEDGER_TAIL_MISMATCH", checked, sequence);
    }
    return success(checked ? "FULL_CHAIN_VERIFIED" : "VALID_EMPTY", checked, sequence, previousHash);
  } finally {
    if (began) await client.query("ROLLBACK");
  }
}

/** Explicit operator action; no production/customer DB connection during unit tests. */
export function auditHistoryCliArgs(argv) {
  const values = {};
  let acknowledged = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--acknowledge-read-only-scan") { acknowledged = true; continue; }
    if (!["--tenant-id", "--max-events", "--batch-size"].includes(argv[i]) ||
        !argv[i + 1] || argv[i + 1].startsWith("--")) throw new RangeError("Unrecognized or incomplete audit scan argument.");
    if (Object.hasOwn(values, argv[i])) throw new RangeError("Duplicate audit scan argument.");
    values[argv[i]] = argv[++i];
  }
  if (!acknowledged) throw new RangeError("Explicit read-only scan acknowledgement required.");
  function count(key, fallback) {
    return values[key] === undefined ? fallback : /^[0-9]+$/.test(values[key]) ? Number(values[key]) : NaN;
  }
  return auditHistoryOptions({
    tenantId: values["--tenant-id"],
    maxEvents: count("--max-events", DEFAULT_MAX_EVENTS),
    batchSize: count("--batch-size", DEFAULT_BATCH_SIZE)
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    const options = auditHistoryCliArgs(process.argv.slice(2));
    if (!process.env.DATABASE_URL) throw new Error("Missing database connection.");
    const { Client } = await import("pg");
    client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
    await client.connect();
    const result = await verifyFullAuditHistory(client, options);
    // Never print tenant IDs, employee fields, SQL or connection strings.
    console.log(JSON.stringify(result));
    if (!result.valid || !result.complete) process.exitCode = 1;
  } catch {
    console.error("Audit full-history verification failed or was not completed; investigate using protected operator logs.");
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
