import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullAuditHash } from "./audit-full-history-verification.mjs";
import { createAuditCheckpoint, encodeAuditCheckpoint } from "./audit-checkpoint.mjs";
import {
  auditCheckpointArchiveArgs,
  createAuditCheckpointArchive,
  encodeAuditCheckpointArchive,
  parseAuditCheckpointArchive,
  readAuditCheckpointArchiveBundle,
  runAuditCheckpointArchiveCli,
  verifyAuditCheckpointArchive,
  writeAuditCheckpointArchiveBundle
} from "./audit-checkpoint-archive.mjs";

const tenantId = "archive-ci-tenant";
const deploymentId = "archive-ci-deployment";
const context = { tenantId, deploymentId };
const keys = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const issuedAt = Date.parse("2026-10-25T10:00:00.000Z");
const exportedAt = issuedAt + 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

function rows(count, suffix = "") {
  let previousHash = null;
  return Array.from({ length: count }, (_, i) => {
    const row = {
      tenantId,
      ledgerSequence: String(i + 1),
      actorId: "private-actor",
      action: "archive.probe" + suffix,
      resourceType: "Synthetic",
      resourceId: "private-resource-" + i,
      purpose: "Archive regression",
      classification: "RESTRICTED",
      ipAddress: "192.0.2.44",
      occurredAt: new Date("2026-10-25T09:00:00.000Z"),
      previousHash
    };
    row.hash = fullAuditHash(row, previousHash);
    previousHash = row.hash;
    return row;
  });
}
function harness(sourceRows = rows(4)) {
  let active = false;
  let snapshot = [];
  let state = null;
  return {
    async query(sql, params = []) {
      if (sql.startsWith("BEGIN ")) {
        active = true;
        snapshot = structuredClone(sourceRows);
        state = snapshot.length ? { eventCount: String(snapshot.length), tailHash: snapshot.at(-1).hash } : null;
        return { rows: [] };
      }
      assert.equal(active, true);
      if (sql === "ROLLBACK") { active = false; return { rows: [] }; }
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/);
      assert.equal(params[0], tenantId);
      if (sql.includes('FROM "Tenant"')) return { rows: [{ id: tenantId }] };
      if (sql.includes('FROM "AuditLedgerState"')) return { rows: state ? [state] : [] };
      return {
        rows: snapshot
          .filter(row => BigInt(row.ledgerSequence) > BigInt(params[1]))
          .slice(0, params[2])
      };
    },
    async end() { assert.equal(active, false); }
  };
}
async function checkpoint(sourceRows = rows(4), clock = issuedAt) {
  return createAuditCheckpoint(
    harness(sourceRows),
    { tenantId, maxEvents: 100, batchSize: 2 },
    keys.privateKey,
    context,
    () => clock
  );
}
async function archive(options = {}) {
  const saved = await checkpoint(options.rows ?? rows(4), options.issuedAt ?? issuedAt);
  const value = createAuditCheckpointArchive(saved, keys.privateKey, context, {
    maxAgeMs: options.maxAgeMs ?? 3600_000,
    retentionDays: options.retentionDays ?? 365,
    now: options.exportedAt ?? exportedAt
  });
  return { checkpoint: saved, archive: value };
}
const throwsCode = code => error => error?.code === code;

test("archive manifest binds the independently signed checkpoint and retention policy", async () => {
  const saved = await archive();
  const manifest = verifyAuditCheckpointArchive(saved.archive, saved.checkpoint, {
    ...context,
    publicKey: keys.publicKey,
    maxExportDelayMs: 3600_000,
    minRetentionUntil: new Date(exportedAt + 300 * DAY_MS).toISOString(),
    now: exportedAt + DAY_MS
  });
  assert.equal(manifest.checkpointSequence, "4");
  assert.equal(manifest.checkpointIssuedAt, new Date(issuedAt).toISOString());
  assert.equal(manifest.exportedAt, new Date(exportedAt).toISOString());
  assert.equal(manifest.retentionUntil, new Date(exportedAt + 365 * DAY_MS).toISOString());
  assert.equal(manifest.storageProfile, "OPERATOR_EXTERNAL_RETENTION_TARGET");
  assert.equal(manifest.checkpointSha256, createHash("sha256").update(encodeAuditCheckpoint(saved.checkpoint)).digest("hex"));
});

test("archive serialization is canonical and contains no raw tenant, deployment or event identifiers", async () => {
  const saved = await archive();
  const text = encodeAuditCheckpointArchive(saved.archive);
  assert.deepEqual(parseAuditCheckpointArchive(text), saved.archive);
  for (const secret of [tenantId, deploymentId, "private-actor", "private-resource", "192.0.2.44", "PRIVATE KEY"]) {
    assert.ok(!text.includes(secret));
  }
  assert.ok(Buffer.byteLength(text) < 8192);
});

test("changing signed retention metadata invalidates the archive signature", async () => {
  const saved = await archive();
  const changed = structuredClone(saved.archive);
  changed.manifest.retentionUntil = new Date(exportedAt + 400 * DAY_MS).toISOString();
  assert.throws(() => verifyAuditCheckpointArchive(changed, saved.checkpoint, {
    ...context, publicKey: keys.publicKey, maxExportDelayMs: 3600_000, now: exportedAt + DAY_MS
  }), throwsCode("CHECKPOINT_ARCHIVE_SIGNATURE_INVALID"));
});

test("a different valid checkpoint cannot be substituted into a retained archive", async () => {
  const saved = await archive();
  const replacement = await checkpoint(rows(5, "-replacement"));
  assert.throws(() => verifyAuditCheckpointArchive(saved.archive, replacement, {
    ...context, publicKey: keys.publicKey, maxExportDelayMs: 3600_000, now: exportedAt + DAY_MS
  }), throwsCode("CHECKPOINT_ARCHIVE_CHECKPOINT_MISMATCH"));
});

test("wrong signer and wrong subject are rejected before an archive can be trusted", async () => {
  const saved = await archive();
  assert.throws(() => verifyAuditCheckpointArchive(saved.archive, saved.checkpoint, {
    ...context, publicKey: otherKeys.publicKey, maxExportDelayMs: 3600_000, now: exportedAt + DAY_MS
  }));
  assert.throws(() => verifyAuditCheckpointArchive(saved.archive, saved.checkpoint, {
    tenantId: "another-tenant", deploymentId, publicKey: keys.publicKey,
    maxExportDelayMs: 3600_000, now: exportedAt + DAY_MS
  }));
});

test("stale checkpoints cannot be newly archived and excessive export delay fails later verification", async () => {
  const saved = await checkpoint();
  assert.throws(() => createAuditCheckpointArchive(saved, keys.privateKey, context, {
    maxAgeMs: 60_000, retentionDays: 30, now: issuedAt + 2 * 60_000
  }));
  const value = createAuditCheckpointArchive(saved, keys.privateKey, context, {
    maxAgeMs: 3600_000, retentionDays: 30, now: issuedAt + 30 * 60_000
  });
  assert.throws(() => verifyAuditCheckpointArchive(value, saved, {
    ...context, publicKey: keys.publicKey, maxExportDelayMs: 10 * 60_000, now: issuedAt + DAY_MS
  }), throwsCode("CHECKPOINT_ARCHIVE_EXPORT_DELAY_EXCEEDED"));
});

test("external retention floor and expiry are independently enforced", async () => {
  const saved = await archive({ retentionDays: 30 });
  assert.throws(() => verifyAuditCheckpointArchive(saved.archive, saved.checkpoint, {
    ...context,
    publicKey: keys.publicKey,
    maxExportDelayMs: 3600_000,
    minRetentionUntil: new Date(exportedAt + 90 * DAY_MS).toISOString(),
    now: exportedAt + DAY_MS
  }), throwsCode("CHECKPOINT_ARCHIVE_RETENTION_POLICY_UNMET"));
  assert.throws(() => verifyAuditCheckpointArchive(saved.archive, saved.checkpoint, {
    ...context,
    publicKey: keys.publicKey,
    maxExportDelayMs: 3600_000,
    now: exportedAt + 31 * DAY_MS
  }), throwsCode("CHECKPOINT_ARCHIVE_RETENTION_EXPIRED"));
});

test("bundle publication is no-overwrite and an incomplete/replaced directory cannot silently become evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-audit-archive-"));
  try {
    const saved = await archive();
    const target = join(root, "bundle");
    const digests = writeAuditCheckpointArchiveBundle(target, saved.checkpoint, saved.archive);
    assert.equal(digests.checkpointSha256, saved.archive.manifest.checkpointSha256);
    assert.ok(existsSync(join(target, "checkpoint.json")));
    assert.ok(existsSync(join(target, "archive-manifest.json")));
    assert.deepEqual(readAuditCheckpointArchiveBundle(target), saved);
    assert.throws(() => writeAuditCheckpointArchiveBundle(target, saved.checkpoint, saved.archive),
      throwsCode("CHECKPOINT_ARCHIVE_OUTPUT_EXISTS"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI parser requires an absolute external target and explicit operator acknowledgement", () => {
  assert.throws(() => auditCheckpointArchiveArgs([
    "export", "--tenant-id", tenantId, "--deployment-id", deploymentId,
    "--checkpoint", "/tmp/c.json", "--private-key-file", "/tmp/k.pem",
    "--max-age-hours", "24", "--retention-days", "365", "--out-dir", "relative"
  ]));
  assert.throws(() => auditCheckpointArchiveArgs([
    "export", "--tenant-id", tenantId, "--deployment-id", deploymentId,
    "--checkpoint", "/tmp/c.json", "--private-key-file", "/tmp/k.pem",
    "--max-age-hours", "24", "--retention-days", "365", "--out-dir", "/tmp/archive"
  ]));
});

test("offline export and verify CLI needs no database connection and preserves external policy metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-audit-archive-cli-"));
  try {
    const saved = await checkpoint();
    const checkpointPath = join(root, "checkpoint.json");
    const privatePath = join(root, "private.pem");
    const publicPath = join(root, "public.pem");
    const bundlePath = join(root, "external", "bundle");
    writeFileSync(checkpointPath, encodeAuditCheckpoint(saved), { mode: 0o600 });
    writeFileSync(privatePath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(privatePath, 0o600);
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
    // Parent must be explicitly provisioned by the external evidence operator.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(root, "external"), { mode: 0o700 });

    const exported = await runAuditCheckpointArchiveCli([
      "export",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--checkpoint", checkpointPath,
      "--private-key-file", privatePath,
      "--max-age-hours", "24",
      "--retention-days", "365",
      "--out-dir", bundlePath,
      "--acknowledge-external-retention-target"
    ], () => exportedAt);
    assert.equal(exported.ok, true);
    assert.equal(exported.code, "CHECKPOINT_ARCHIVE_EXPORTED");
    assert.equal(exported.sequence, "4");

    const verified = await runAuditCheckpointArchiveCli([
      "verify",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--archive-dir", bundlePath,
      "--public-key-file", publicPath,
      "--max-export-delay-hours", "24",
      "--min-retention-until", new Date(exportedAt + 300 * DAY_MS).toISOString()
    ], () => exportedAt + DAY_MS);
    assert.equal(verified.ok, true);
    assert.equal(verified.code, "CHECKPOINT_ARCHIVE_VALID");
    assert.equal(verified.checkpointSha256, exported.checkpointSha256);
    assert.ok(!JSON.stringify(exported).includes(root));
    assert.ok(!readFileSync(join(bundlePath, "archive-manifest.json"), "utf8").includes(tenantId));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
