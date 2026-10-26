import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
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
import {
  createInitialSignerTrustInventory,
  revokeSignerTrustInventory,
  rotateSignerTrustInventory,
  writeSignerTrustInventoryGeneration
} from "./audit-signer-trust-inventory.mjs";
import {
  approveGovernanceProposal,
  createGovernanceApprovalPolicy,
  createGovernanceProposal,
  encodeGovernanceApprovalPolicy,
  governanceApprovalPolicySha256
} from "./audit-governance-approval.mjs";
import {
  authorityTrustInventorySha256,
  createInitialAuthorityTrustInventory,
  recoverAuthorityTrustInventory,
  rotateAuthorityTrustInventory,
  writeAuthorityTrustInventoryGeneration
} from "./audit-trust-authority-inventory.mjs";

const tenantId = "archive-ci-tenant";
const deploymentId = "archive-ci-deployment";
const context = { tenantId, deploymentId };
const keys = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const authority1 = generateKeyPairSync("ed25519");
const authority2 = generateKeyPairSync("ed25519");
const approver1 = generateKeyPairSync("ed25519");
const approver2 = generateKeyPairSync("ed25519");
const issuedAt = Date.parse("2026-10-25T10:00:00.000Z");
const exportedAt = issuedAt + 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const approvalPolicy = createGovernanceApprovalPolicy({
  approverPublicKeys: [approver1.publicKey, approver2.publicKey],
  minApprovals: 2,
  ...context,
  issuedAt: issuedAt - 2 * 60 * 60_000,
  expiresAt: issuedAt + 24 * 60 * 60_000
});
const approvalPolicySha = governanceApprovalPolicySha256(approvalPolicy);
function approvals(operation, currentGeneration, currentSha256, targetKeyId, now) {
  let bundle = {
    proposal: createGovernanceProposal({
      ...context, operation, currentGeneration, currentSha256, targetKeyId,
      now, expiresAt: now + 30 * 60_000
    }),
    approvals: []
  };
  bundle = approveGovernanceProposal(bundle, approver1.privateKey, now + 1000);
  bundle = approveGovernanceProposal(bundle, approver2.privateKey, now + 2000);
  return bundle;
}
function initialAuthority(now = issuedAt - 2 * 60_000) {
  return createInitialAuthorityTrustInventory(
    authority1.publicKey,
    approvalPolicy,
    approvals("INIT_AUTHORITY", 0, null, checkpointKeyId(authority1.publicKey), now),
    context,
    { expectedPolicySha256: approvalPolicySha, now }
  );
}

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

test("future-dated archive publication is rejected during offline verification", async () => {
  const saved = await archive();
  assert.throws(() => verifyAuditCheckpointArchive(saved.archive, saved.checkpoint, {
    ...context,
    publicKey: keys.publicKey,
    maxExportDelayMs: 3600_000,
    now: exportedAt - 60_000
  }), throwsCode("CHECKPOINT_ARCHIVE_FUTURE"));
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

test("world-writable archive parents are rejected before bundle creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-audit-archive-unsafe-"));
  try {
    const saved = await archive();
    chmodSync(root, 0o777);
    assert.throws(() => writeAuditCheckpointArchiveBundle(join(root, "bundle"), saved.checkpoint, saved.archive),
      throwsCode("CHECKPOINT_ARCHIVE_OUTPUT_UNSAFE"));
    assert.equal(existsSync(join(root, "bundle")), false);
  } finally {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
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

test("governed archive verification follows authority rotation and recovery semantics", async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-audit-archive-governed-"));
  try {
    chmodSync(root, 0o700);
    const replacementSigner = generateKeyPairSync("ed25519");
    const saved = await checkpoint();
    const checkpointPath = join(root, "checkpoint.json");
    const privatePath = join(root, "signer-private.pem");
    const policyPath = join(root, "authority-policy.json");
    const bundleParent = join(root, "external");
    const bundlePath = join(bundleParent, "bundle");
    const trustDir = join(root, "trust");
    const authorityDir = join(root, "authority");
    mkdirSync(bundleParent, { mode: 0o700 });
    mkdirSync(trustDir, { mode: 0o700 });
    mkdirSync(authorityDir, { mode: 0o700 });
    writeFileSync(checkpointPath, encodeAuditCheckpoint(saved), { mode: 0o600 });
    writeFileSync(privatePath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(privatePath, 0o600);
    writeFileSync(policyPath, encodeGovernanceApprovalPolicy(approvalPolicy), { mode: 0o600 });

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
    assert.equal(exported.code, "CHECKPOINT_ARCHIVE_EXPORTED");

    const authorityInventory1 = initialAuthority();
    const authorityWritten1 = writeAuthorityTrustInventoryGeneration(authorityDir, authorityInventory1);
    const inventory1 = createInitialSignerTrustInventory(
      authority1.privateKey, keys.publicKey, context, issuedAt - 60_000
    );
    const firstWritten = writeSignerTrustInventoryGeneration(trustDir, inventory1);

    const governedArgs = (authoritySha) => [
      "--trust-inventory-dir", trustDir,
      "--expected-trust-sha256", firstWritten.inventorySha256,
      "--trust-max-age-hours", "48",
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authoritySha,
      "--authority-max-age-hours", "48"
    ];

    const verified1 = await runAuditCheckpointArchiveCli([
      "verify",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--archive-dir", bundlePath,
      ...governedArgs(authorityWritten1.inventorySha256),
      "--max-export-delay-hours", "24"
    ], () => exportedAt + 60_000);
    assert.equal(verified1.code, "CHECKPOINT_ARCHIVE_VALID");
    assert.equal(verified1.trustGeneration, 1);
    assert.equal(verified1.authorityGeneration, 1);

    const rotated = rotateAuthorityTrustInventory(
      authorityInventory1,
      authority2.publicKey,
      approvalPolicy,
      approvals(
        "ROTATE_AUTHORITY", 1, authorityWritten1.inventorySha256,
        checkpointKeyId(authority2.publicKey), issuedAt + 60 * 60_000
      ),
      context,
      {
        expectedPolicySha256: approvalPolicySha,
        expectedCurrentSha256: authorityWritten1.inventorySha256,
        now: issuedAt + 60 * 60_000
      }
    );
    const authorityWritten2 = writeAuthorityTrustInventoryGeneration(authorityDir, rotated);
    const verifiedAfterRotation = await runAuditCheckpointArchiveCli([
      "verify",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--archive-dir", bundlePath,
      ...governedArgs(authorityWritten2.inventorySha256),
      "--max-export-delay-hours", "24"
    ], () => issuedAt + 2 * 60 * 60_000);
    assert.equal(verifiedAfterRotation.code, "CHECKPOINT_ARCHIVE_VALID");
    assert.equal(verifiedAfterRotation.authorityGeneration, 2);

    const recoveryDir = join(root, "authority-recovery");
    mkdirSync(recoveryDir, { mode: 0o700 });
    writeAuthorityTrustInventoryGeneration(recoveryDir, authorityInventory1);
    const recovered = recoverAuthorityTrustInventory(
      authorityInventory1,
      authority2.publicKey,
      approvalPolicy,
      approvals(
        "RECOVER_AUTHORITY", 1, authorityWritten1.inventorySha256,
        checkpointKeyId(authority2.publicKey), issuedAt + 60 * 60_000
      ),
      context,
      {
        expectedPolicySha256: approvalPolicySha,
        expectedCurrentSha256: authorityWritten1.inventorySha256,
        now: issuedAt + 60 * 60_000
      }
    );
    const recoveredWritten = writeAuthorityTrustInventoryGeneration(recoveryDir, recovered);
    await assert.rejects(runAuditCheckpointArchiveCli([
      "verify",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--archive-dir", bundlePath,
      "--trust-inventory-dir", trustDir,
      "--expected-trust-sha256", firstWritten.inventorySha256,
      "--trust-max-age-hours", "48",
      "--authority-inventory-dir", recoveryDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", recoveredWritten.inventorySha256,
      "--authority-max-age-hours", "48",
      "--max-export-delay-hours", "24"
    ], () => issuedAt + 2 * 60 * 60_000), error => error?.code === "AUTHORITY_INVENTORY_KEY_REVOKED");

    const inventory2 = revokeSignerTrustInventory(
      inventory1, authority1.privateKey, saved.payload.keyId, context, issuedAt + 30 * 60_000
    );
    const secondWritten = writeSignerTrustInventoryGeneration(trustDir, inventory2);
    await assert.rejects(runAuditCheckpointArchiveCli([
      "verify",
      "--tenant-id", tenantId,
      "--deployment-id", deploymentId,
      "--archive-dir", bundlePath,
      "--trust-inventory-dir", trustDir,
      "--expected-trust-sha256", secondWritten.inventorySha256,
      "--trust-max-age-hours", "48",
      "--authority-inventory-dir", authorityDir,
      "--authority-policy", policyPath,
      "--expected-authority-policy-sha256", approvalPolicySha,
      "--expected-authority-sha256", authorityWritten2.inventorySha256,
      "--authority-max-age-hours", "48",
      "--max-export-delay-hours", "24"
    ], () => issuedAt + 2 * 60 * 60_000), error => error?.code === "TRUST_INVENTORY_SIGNER_REVOKED");

    assert.equal(checkpointKeyId(replacementSigner.publicKey).length, 64);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("archive verify accepts exactly one trust source mode", () => {
  assert.throws(() => auditCheckpointArchiveArgs([
    "verify",
    "--tenant-id", tenantId,
    "--deployment-id", deploymentId,
    "--archive-dir", "/tmp/archive",
    "--max-export-delay-hours", "24"
  ]));
  assert.throws(() => auditCheckpointArchiveArgs([
    "verify",
    "--tenant-id", tenantId,
    "--deployment-id", deploymentId,
    "--archive-dir", "/tmp/archive",
    "--public-key-file", "/tmp/signer.pem",
    "--trust-inventory-dir", "/tmp/trust",
    "--expected-trust-sha256", "a".repeat(64),
    "--trust-max-age-hours", "24",
    "--authority-inventory-dir", "/tmp/authority",
    "--authority-policy", "/tmp/policy.json",
    "--expected-authority-policy-sha256", "b".repeat(64),
    "--expected-authority-sha256", "c".repeat(64),
    "--authority-max-age-hours", "24",
    "--max-export-delay-hours", "24"
  ]));
  assert.throws(() => auditCheckpointArchiveArgs([
    "verify",
    "--tenant-id", tenantId,
    "--deployment-id", deploymentId,
    "--archive-dir", "/tmp/archive",
    "--trust-inventory-dir", "/tmp/trust",
    "--max-export-delay-hours", "24"
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
