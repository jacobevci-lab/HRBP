import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import {
  chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fullAuditHash } from "./audit-full-history-verification.mjs";
import {
  createAuditCheckpoint, encodeAuditCheckpoint
} from "./audit-checkpoint.mjs";
import {
  createTimestampQuery,
  encodeTimestampEvidence,
  runTimestampCli,
  verifyTimestampResponse
} from "./audit-checkpoint-timestamp.mjs";

const enabled = process.env.CI === "true";
const tenantId = "timestamp-ci-tenant";
const deploymentId = "timestamp-ci-deployment";
const at = new Date("2026-10-27T00:00:00.000Z");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
    ...options
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result;
}
function rows(count = 4, suffix = "") {
  let previousHash = null;
  return Array.from({ length: count }, (_, index) => {
    const row = {
      tenantId,
      ledgerSequence: String(index + 1),
      actorId: "private-ts-actor",
      action: "timestamp.probe" + suffix,
      resourceType: "Synthetic",
      resourceId: "private-ts-resource-" + index,
      purpose: "RFC3161 timestamp regression",
      classification: "RESTRICTED",
      ipAddress: null,
      occurredAt: at,
      previousHash
    };
    row.hash = fullAuditHash(row, previousHash);
    previousHash = row.hash;
    return row;
  });
}
function harness(sourceRows = rows()) {
  let active = false;
  let snapshot = [];
  let state = null;
  return {
    async query(sql, params = []) {
      if (sql.startsWith("BEGIN ")) {
        active = true;
        snapshot = structuredClone(sourceRows);
        state = snapshot.length
          ? { eventCount: String(snapshot.length), tailHash: snapshot.at(-1).hash }
          : null;
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
    }
  };
}
async function checkpoint(sourceRows = rows()) {
  const keys = generateKeyPairSync("ed25519");
  return createAuditCheckpoint(
    harness(sourceRows),
    { tenantId, maxEvents: 100, batchSize: 2 },
    keys.privateKey,
    { deploymentId },
    () => +at
  );
}
function makeTsa(root) {
  const caKey = join(root, "ca.key.pem");
  const caCert = join(root, "ca.cert.pem");
  const tsaKey = join(root, "tsa.key.pem");
  const tsaCsr = join(root, "tsa.csr.pem");
  const tsaCert = join(root, "tsa.cert.pem");
  const tsaExt = join(root, "tsa.ext");
  const serial = join(root, "tsa.serial");
  const config = join(root, "tsa.cnf");

  run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-subj", "/CN=HRBP CI RFC3161 Root",
    "-keyout", caKey, "-out", caCert, "-days", "2"
  ]);
  run("openssl", [
    "req", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-subj", "/CN=HRBP CI Timestamp Authority",
    "-keyout", tsaKey, "-out", tsaCsr
  ]);
  writeFileSync(tsaExt, [
    "basicConstraints=critical,CA:FALSE",
    "extendedKeyUsage=critical,timeStamping",
    "subjectKeyIdentifier=hash",
    "authorityKeyIdentifier=keyid,issuer",
    ""
  ].join("\n"));
  run("openssl", [
    "x509", "-req", "-in", tsaCsr,
    "-CA", caCert, "-CAkey", caKey, "-CAcreateserial",
    "-out", tsaCert, "-days", "2", "-sha256", "-extfile", tsaExt
  ]);
  writeFileSync(serial, "01\n");
  const escaped = root.replaceAll("\\", "\\\\");
  writeFileSync(config, [
    "[ tsa ]",
    "default_tsa = tsa_config",
    "",
    "[ tsa_config ]",
    `dir = ${escaped}`,
    `serial = ${serial}`,
    `signer_cert = ${tsaCert}`,
    `signer_key = ${tsaKey}`,
    `certs = ${caCert}`,
    "signer_digest = sha256",
    "default_policy = 1.2.3.4.1",
    "digests = sha256",
    "accuracy = secs:1",
    "ordering = yes",
    "tsa_name = yes",
    "ess_cert_id_chain = yes",
    ""
  ].join("\n"));
  return { caKey, caCert, tsaKey, tsaCert, config };
}

test("RFC3161 query is generated from canonical checkpoint bytes and is no-overwrite", {
  skip: !enabled
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-ts-query-"));
  try {
    chmodSync(root, 0o700);
    const checkpointPath = join(root, "checkpoint.json");
    const queryPath = join(root, "checkpoint.tsq");
    writeFileSync(checkpointPath, encodeAuditCheckpoint(await checkpoint()), { mode: 0o600 });

    const result = await runTimestampCli([
      "query", "--checkpoint", checkpointPath, "--out", queryPath
    ]);
    assert.equal(result.code, "TIMESTAMP_QUERY_CREATED");
    assert.ok(readFileSync(queryPath).length > 0);
    await assert.rejects(runTimestampCli([
      "query", "--checkpoint", checkpointPath, "--out", queryPath
    ]), error => error?.code === "TIMESTAMP_OUTPUT_EXISTS");
    assert.ok(!JSON.stringify(result).includes(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real OpenSSL RFC3161 response verifies against checkpoint and pinned CA trust store", {
  skip: !enabled,
  timeout: 30_000
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-ts-verify-"));
  try {
    chmodSync(root, 0o700);
    const checkpointPath = join(root, "checkpoint.json");
    const queryPath = join(root, "checkpoint.tsq");
    const responsePath = join(root, "checkpoint.tsr");
    const evidencePath = join(root, "timestamp-evidence.json");
    const saved = await checkpoint();
    writeFileSync(checkpointPath, encodeAuditCheckpoint(saved), { mode: 0o600 });
    const tsa = makeTsa(root);

    const query = createTimestampQuery(checkpointPath);
    writeFileSync(queryPath, query, { mode: 0o600 });
    run("openssl", [
      "ts", "-reply",
      "-config", tsa.config,
      "-section", "tsa_config",
      "-queryfile", queryPath,
      "-out", responsePath
    ]);

    const verified = await runTimestampCli([
      "verify",
      "--checkpoint", checkpointPath,
      "--response", responsePath,
      "--ca-file", tsa.caCert,
      "--untrusted-chain-file", tsa.tsaCert,
      "--out", evidencePath
    ], () => Date.now() + 60_000);

    assert.equal(verified.code, "TIMESTAMP_RESPONSE_VALID");
    assert.equal(verified.checkpointSha256.length, 64);
    assert.equal(verified.timestampResponseSha256.length, 64);
    assert.ok(["1.2.3.4.1", "tsa_policy1"].includes(verified.policyOid),
      "OpenSSL may render a registered policy OID using its symbolic object name");
    assert.ok(Number.isFinite(Date.parse(verified.timestampAt)));
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.scope, "RFC3161_CHECKPOINT_TIMESTAMP_VERIFICATION");
    assert.equal(evidence.checkpointSha256, verified.checkpointSha256);
    assert.equal(evidence.timestampResponseSha256, verified.timestampResponseSha256);
    assert.ok(!JSON.stringify(verified).includes(root));
    assert.ok(!readFileSync(evidencePath, "utf8").includes(tenantId));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("timestamp response cannot be replayed onto a different valid checkpoint", {
  skip: !enabled,
  timeout: 30_000
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-ts-mismatch-"));
  try {
    chmodSync(root, 0o700);
    const originalPath = join(root, "original.json");
    const replacementPath = join(root, "replacement.json");
    const queryPath = join(root, "original.tsq");
    const responsePath = join(root, "original.tsr");
    writeFileSync(originalPath, encodeAuditCheckpoint(await checkpoint(rows(4))), { mode: 0o600 });
    writeFileSync(replacementPath, encodeAuditCheckpoint(await checkpoint(rows(5, "-other"))), { mode: 0o600 });
    const tsa = makeTsa(root);
    writeFileSync(queryPath, createTimestampQuery(originalPath), { mode: 0o600 });
    run("openssl", [
      "ts", "-reply", "-config", tsa.config, "-section", "tsa_config",
      "-queryfile", queryPath, "-out", responsePath
    ]);
    assert.throws(() => verifyTimestampResponse({
      checkpointPath: replacementPath,
      responsePath,
      caFile: tsa.caCert,
      untrustedChainFile: tsa.tsaCert,
      now: Date.now() + 60_000
    }), error => error?.code === "TIMESTAMP_OPENSSL_VERIFY_FAILED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("timestamp response signed by an untrusted TSA root fails closed", {
  skip: !enabled,
  timeout: 30_000
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "hrbp-ts-root-"));
  const other = mkdtempSync(join(tmpdir(), "hrbp-ts-other-root-"));
  try {
    chmodSync(root, 0o700); chmodSync(other, 0o700);
    const checkpointPath = join(root, "checkpoint.json");
    const queryPath = join(root, "checkpoint.tsq");
    const responsePath = join(root, "checkpoint.tsr");
    writeFileSync(checkpointPath, encodeAuditCheckpoint(await checkpoint()), { mode: 0o600 });
    const tsa = makeTsa(root);
    const wrong = makeTsa(other);
    writeFileSync(queryPath, createTimestampQuery(checkpointPath), { mode: 0o600 });
    run("openssl", [
      "ts", "-reply", "-config", tsa.config, "-section", "tsa_config",
      "-queryfile", queryPath, "-out", responsePath
    ]);
    assert.throws(() => verifyTimestampResponse({
      checkpointPath,
      responsePath,
      caFile: wrong.caCert,
      untrustedChainFile: tsa.tsaCert,
      now: Date.now() + 60_000
    }), error => error?.code === "TIMESTAMP_OPENSSL_VERIFY_FAILED");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test("timestamp evidence serialization rejects unknown or malformed fields", () => {
  const valid = {
    version: 1,
    scope: "RFC3161_CHECKPOINT_TIMESTAMP_VERIFICATION",
    algorithm: "SHA256",
    checkpointSha256: "a".repeat(64),
    timestampResponseSha256: "b".repeat(64),
    trustStoreSha256: "c".repeat(64),
    policyOid: "1.2.3.4.1",
    timestampAt: "2026-10-27T00:00:00.000Z",
    verifiedAt: "2026-10-27T00:01:00.000Z"
  };
  assert.equal(JSON.parse(encodeTimestampEvidence(valid)).policyOid, "1.2.3.4.1");
  for (const changed of [
    { ...valid, version: 2 },
    { ...valid, checkpointSha256: "x" },
    { ...valid, policyOid: "" },
    { ...valid, extra: true }
  ]) assert.throws(() => encodeTimestampEvidence(changed));
});
