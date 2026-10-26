import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, symlinkSync, openSync, fstatSync, closeSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fullAuditHash, verifyFullAuditHistory } from "./audit-full-history-verification.mjs";
import { createAuditCheckpoint, verifyAuditCheckpoint, compareAuditCheckpoint, encodeAuditCheckpoint,
  parseAuditCheckpoint, checkpointSubject, checkpointKeyId, readCheckpointFile, writeCheckpointFile,
  auditCheckpointArgs, runCheckpointCli } from "./audit-checkpoint.mjs";

const tenantId = "ci-checkpoint-subject", deploymentId = "ci-independent-deployment";
const context = { tenantId, deploymentId };
const at = new Date("2026-10-14T12:00:00.000Z"), now = +at;
const keys = generateKeyPairSync("ed25519"), otherKeys = generateKeyPairSync("ed25519");
const trust = { ...context, publicKey: keys.publicKey, maxAgeMs: 3600_000, now };
const scan = { tenantId, maxEvents: 100, batchSize: 3 };
function events(count, changed = false) {
  let previousHash = null;
  return Array.from({ length: count }, (_, i) => {
    const row = { tenantId, ledgerSequence: String(i + 1), actorId: "private-employee-id",
      action: changed && i === 0 ? "rewritten-action" : "probe", resourceType: "Synthetic",
      resourceId: `secret-resource-${i}`, purpose: "Protected operator checkpoint test", classification: "RESTRICTED",
      ipAddress: "192.0.2.23", occurredAt: at, previousHash };
    row.hash = fullAuditHash(row, previousHash); previousHash = row.hash; return row;
  });
}
function harness(rows = events(7), { afterSnapshot, onQuery, missing = false, rollbackFailure = false } = {}) {
  const calls = [];
  let snapshot, state, active = false;
  return { calls, client: {
    async query(sql, params = []) {
      calls.push({ sql, params });
      onQuery?.(sql);
      if (sql.startsWith("BEGIN ")) {
        assert.match(sql, /REPEATABLE READ READ ONLY/); active = true;
        snapshot = structuredClone(rows);
        state = snapshot.length ? { eventCount: String(snapshot.length), tailHash: snapshot.at(-1).hash } : null;
        afterSnapshot?.(rows); return { rows: [] };
      }
      assert.ok(active);
      if (sql === "ROLLBACK") { active = false; if (rollbackFailure) throw new Error("sensitive-database-error"); return { rows: [] }; }
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/);
      assert.equal(params[0], tenantId);
      if (sql.includes('FROM "Tenant"')) return { rows: missing ? [] : [{ id: tenantId }] };
      if (sql.includes('FROM "AuditLedgerState"')) return { rows: state ? [state] : [] };
      assert.match(sql, /ORDER BY "ledgerSequence" ASC LIMIT \$3/);
      return { rows: snapshot.filter(row => BigInt(row.ledgerSequence) > BigInt(params[1])).slice(0, params[2]) };
    }, async end() { assert.equal(active, false); }
  } };
}
const create = (h = harness(), options = scan) => createAuditCheckpoint(h.client, options, keys.privateKey, context, () => now);
const errorCode = code => e => e.code === code;

// Core evidence/trust-boundary regressions run without pg, credentials or a network.
test("signed checkpoint binds the complete snapshot and verifies using an externally pinned public key", async () => {
  const h = harness(), value = await create(h);
  const payload = verifyAuditCheckpoint(value, trust);
  assert.equal(payload.sequence, "7"); assert.equal(payload.eventsChecked, 7);
  assert.equal(payload.tailHash, events(7).at(-1).hash);
  assert.equal(payload.keyId, checkpointKeyId(keys.publicKey));
  assert.equal(payload.subject, checkpointSubject(context));
  assert.equal(h.calls.at(-1).sql, "ROLLBACK");
});
test("checkpoint serialization is deterministic and contains neither employee fields nor raw tenant identity", async () => {
  const value = await create(), text = encodeAuditCheckpoint(value);
  assert.deepEqual(parseAuditCheckpoint(text), value);
  assert.equal(encodeAuditCheckpoint(await create()), text);
  for (const secret of [tenantId, deploymentId, "private-employee", "secret-resource", "192.0.2.23", "PRIVATE KEY"]) {
    assert.ok(!text.includes(secret));
  }
  assert.ok(Buffer.byteLength(text) < 4096);
});
test("a consistently rewritten entire ledger passes a fresh unanchored scan but fails the retained signed anchor", async () => {
  const value = await create(harness(events(7)));
  assert.equal((await verifyFullAuditHistory(harness(events(9, true)).client, scan)).valid, true);
  const result = await compareAuditCheckpoint(harness(events(9, true)).client, scan, value, trust, () => now);
  assert.equal(result.valid, false); assert.equal(result.code, "CHECKPOINT_HASH_MISMATCH");
});
test("legitimate append after the checkpoint matches the old anchor, not the newer tail", async () => {
  const value = await create(harness(events(4)));
  const result = await compareAuditCheckpoint(harness(events(9)).client, scan, value, trust, () => now);
  assert.equal(result.valid, true); assert.equal(result.eventsChecked, 9);
  assert.ok(!("verifiedHead" in result));
});
test("a truncated but internally consistent database cannot hide a missing checkpoint sequence", async () => {
  const value = await create();
  for (const count of [0, 3]) {
    const result = await compareAuditCheckpoint(harness(events(count)).client, scan, value, trust, () => now);
    assert.equal(result.code, "CHECKPOINT_SEQUENCE_MISSING"); assert.equal(result.valid, false);
  }
});
test("an empty checkpoint is explicitly empty and does not claim protection of later events", async () => {
  const value = await create(harness([]));
  assert.equal(value.payload.sequence, "0"); assert.equal(value.payload.tailHash, null);
  assert.equal(verifyAuditCheckpoint(value, trust).eventsChecked, 0);
  assert.equal((await compareAuditCheckpoint(harness(events(3)).client, scan, value, trust, () => now)).valid, true);
});
test("the captured head remains tied to its snapshot while concurrent external rows change", async () => {
  const rows = events(5);
  const value = await create(harness(rows, { afterSnapshot: live => { live.splice(0, live.length, ...events(8, true)); } }));
  assert.equal(value.payload.sequence, "5"); assert.equal(value.payload.tailHash, events(5).at(-1).hash);
});
test("incomplete, missing or corrupted history is never signed", async () => {
  await assert.rejects(create(harness(events(7)), { ...scan, maxEvents: 3 }), errorCode("CHECKPOINT_SCAN_FAILED"));
  await assert.rejects(create(harness([], { missing: true })), errorCode("CHECKPOINT_SCAN_FAILED"));
  const rows = events(7); rows[1].action = "corrupted";
  await assert.rejects(create(harness(rows)), errorCode("CHECKPOINT_SCAN_FAILED"));
});
test("failed rollback prevents a checkpoint even after otherwise valid reads", async () => {
  await assert.rejects(create(harness(events(7), { rollbackFailure: true })), /sensitive-database-error/);
});
test("elapsed budget at the final empty page cannot be signed as a complete scan", async () => {
  let clock = now, reads = 0;
  const h = harness(events(2), { onQuery: sql => {
    if (sql.includes('FROM "AuditEvent"') && ++reads === 2) clock += 46_000;
  } });
  await assert.rejects(createAuditCheckpoint(h.client, scan, keys.privateKey, context, () => clock), errorCode("CHECKPOINT_SCAN_FAILED"));
});
test("altered signature or payload fails verification", async () => {
  const value = await create(), changed = structuredClone(value);
  changed.payload.tailHash = "a".repeat(64);
  assert.throws(() => verifyAuditCheckpoint(changed, trust), errorCode("CHECKPOINT_SIGNATURE_INVALID"));
  const bytes = Buffer.from(value.signature, "base64"); bytes[0] ^= 1;
  value.signature = bytes.toString("base64");
  assert.throws(() => verifyAuditCheckpoint(value, trust), errorCode("CHECKPOINT_SIGNATURE_INVALID"));
});
test("a substituted public key is never trusted merely because it is present or self-signed", async () => {
  const value = await create();
  assert.throws(() => verifyAuditCheckpoint(value, { ...trust, publicKey: otherKeys.publicKey }), errorCode("CHECKPOINT_KEY_UNTRUSTED"));
  value.publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => verifyAuditCheckpoint(value, trust), errorCode("CHECKPOINT_INPUT_INVALID"));
});
test("different tenants and deployment identities cannot reuse the same signed artifact", async () => {
  const value = await create();
  for (const replacement of [{ tenantId: "other" }, { deploymentId: "other" }]) {
    assert.throws(() => verifyAuditCheckpoint(value, { ...trust, ...replacement }), errorCode("CHECKPOINT_SUBJECT_MISMATCH"));
  }
  const h = harness();
  await assert.rejects(compareAuditCheckpoint(h.client, { ...scan, tenantId: "other" }, value, trust), errorCode("CHECKPOINT_SUBJECT_MISMATCH"));
  assert.equal(h.calls.length, 0);
});
test("freshness, future timestamps and externally supplied sequence/digest expectations are enforced", async () => {
  const value = await create();
  assert.throws(() => verifyAuditCheckpoint(value, { ...trust, now: now + 3600_001 }), errorCode("CHECKPOINT_STALE"));
  assert.throws(() => verifyAuditCheckpoint(value, { ...trust, now: now - 30_001 }), errorCode("CHECKPOINT_FUTURE"));
  assert.throws(() => verifyAuditCheckpoint(value, { ...trust, minSequence: "8" }), errorCode("CHECKPOINT_SEQUENCE_ROLLBACK"));
  assert.throws(() => verifyAuditCheckpoint(value, { ...trust, expectedDigest: "b".repeat(64) }), errorCode("CHECKPOINT_DIGEST_MISMATCH"));
  const expectedDigest = createHash("sha256").update(encodeAuditCheckpoint(value)).digest("hex");
  assert.equal(verifyAuditCheckpoint(value, { ...trust, expectedDigest, minSequence: "7" }).sequence, "7");
});
test("algorithm, version, scope, count and unknown field confusion are rejected", async () => {
  const value = await create();
  for (const changes of [{ version: 2 }, { algorithm: "none" }, { scope: "TAIL" }, { eventsChecked: 6 },
    { sequence: "07" }, { sequence: "1000001" }, { tailHash: null }, { issuedAt: "yesterday" }, { arbitrary: true }]) {
    assert.throws(() => verifyAuditCheckpoint({ ...value, payload: { ...value.payload, ...changes } }, trust), errorCode("CHECKPOINT_INPUT_INVALID"));
  }
});
test("duplicate JSON keys, noncanonical text, oversized input and malformed base64 fail closed", async () => {
  const value = await create(), text = encodeAuditCheckpoint(value);
  for (const input of [text.replace('"version":1', '"version":2,"version":1'), JSON.stringify(value, null, 2),
    " ".repeat(4097), text.replace(value.signature, value.signature.slice(1)), text + "\n", "null"]) {
    assert.throws(() => parseAuditCheckpoint(input), errorCode("CHECKPOINT_INPUT_INVALID"));
  }
});
test("wrong key types are rejected before any ledger scan", async () => {
  const h = harness(), rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const key of [keys.publicKey, rsa.privateKey, "not-a-key"]) {
    await assert.rejects(createAuditCheckpoint(h.client, scan, key, context), errorCode("CHECKPOINT_KEY_INVALID"));
  }
  assert.equal(h.calls.length, 0);
});
test("malformed anchors are rejected before database access and no default report shape changes", async () => {
  const h = harness();
  for (const anchor of [{ sequence: "-1", hash: null }, { sequence: "0", hash: "a".repeat(64) },
    { sequence: "9223372036854775808", hash: "a".repeat(64) }, { sequence: "3", hash: null }]) {
    await assert.rejects(verifyFullAuditHistory(h.client, scan, () => now, { anchor }), RangeError);
  }
  assert.equal(h.calls.length, 0);
  const result = await verifyFullAuditHistory(h.client, scan);
  assert.deepEqual(Object.keys(result), ["valid", "complete", "code", "eventsChecked", "lastSequence", "scope"]);
});

const args = (command, extra = []) => [command, "--tenant-id", tenantId, "--deployment-id", deploymentId, ...extra];
const createFlags = ["--private-key-file", "key.pem", "--out", "out.json", "--acknowledge-independent-key", "--acknowledge-read-only-scan"];
const verifyFlags = ["--checkpoint", "evidence.json", "--public-key-file", "public.pem", "--max-age-hours", "24"];
test("CLI explicitly acknowledges both independent key custody and a bounded read-only scan", () => {
  assert.equal(auditCheckpointArgs(args("create", createFlags)).scan.maxEvents, 50_000);
  assert.equal(auditCheckpointArgs(args("verify", verifyFlags)).scan, null);
  assert.equal(auditCheckpointArgs(args("compare", [...verifyFlags, "--acknowledge-read-only-scan"])).command, "compare");
  for (const argv of [[], args("create", createFlags.slice(0, -1)), args("create", createFlags.filter(v => v !== "--acknowledge-independent-key")),
    args("verify", [...verifyFlags, "--private-key-file", "bad"]), args("verify", [...verifyFlags, "--max-age-hours", "1"]),
    args("create", [...createFlags, "--max-events", "1000001"]), args("compare", verifyFlags),
    args("verify", verifyFlags.slice(0, -2)), args("create", [...createFlags, "--acknowledge-read-only-scan"])]) {
    assert.throws(() => auditCheckpointArgs(argv));
  }
});
function files() {
  const dir = mkdtempSync(join(tmpdir(), "hrbp-checkpoint-test-"));
  const priv = join(dir, "private.pem"), pub = join(dir, "public.pem"), out = join(dir, "checkpoint.json");
  writeFileSync(priv, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(pub, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
  return { dir, priv, pub, out, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
test("artifact publication uses restrictive permissions and never overwrites existing files or symlinks", async () => {
  const f = files();
  try {
    const value = await create();
    writeCheckpointFile(f.out, value);
    // Bind the permission assertion and contents to one opened inode; a
    // pathname stat followed by a separate read is an avoidable TOCTOU pattern.
    const fd = openSync(f.out, "r");
    try {
      assert.equal(fstatSync(fd).mode & 0o777, 0o600);
      assert.deepEqual(parseAuditCheckpoint(readFileSync(fd, "utf8")), value);
    } finally { closeSync(fd); }
    assert.throws(() => writeCheckpointFile(f.out, value));
    // Re-open through the bounded no-follow reader, which rechecks the actual
    // opened descriptor; never reuse an earlier permission check for a path read.
    assert.equal(readCheckpointFile(f.out).toString("utf8"), encodeAuditCheckpoint(value));
    const link = join(f.dir, "link.json"); symlinkSync(f.out, link);
    assert.throws(() => writeCheckpointFile(link, value));
    assert.throws(() => readCheckpointFile(link));
    assert.ok(!readdirSync(f.dir).some(name => name.endsWith(".tmp")));
  } finally { f.cleanup(); }
});
test("private keys must be regular owner-only files; bounded inputs cannot read a directory or huge data", () => {
  const f = files();
  try {
    assert.ok(readCheckpointFile(f.priv, { privateKey: true, maxBytes: 16_384 }).length > 0);
    chmodSync(f.priv, 0o644);
    assert.throws(() => readCheckpointFile(f.priv, { privateKey: true }), errorCode("CHECKPOINT_FILE_INVALID"));
    assert.throws(() => readCheckpointFile(f.dir));
    writeFileSync(f.out, "x".repeat(4097));
    assert.throws(() => readCheckpointFile(f.out), errorCode("CHECKPOINT_FILE_INVALID"));
  } finally { f.cleanup(); }
});
test("offline CLI verification never opens the database and does not print identifiers or keys", async () => {
  const f = files();
  try {
    const h = harness();
    const value = await createAuditCheckpoint(h.client, scan, keys.privateKey, context);
    writeCheckpointFile(f.out, value);
    const argv = args("verify", ["--checkpoint", f.out, "--public-key-file", f.pub, "--max-age-hours", "24"]);
    const result = await runCheckpointCli(argv, () => { throw new Error("must not connect"); });
    assert.equal(result.ok, true); assert.equal(result.scope, "SIGNED_SNAPSHOT_ONLY");
    const child = spawnSync(process.execPath, ["scripts/audit-checkpoint.mjs", ...argv], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgresql://private:secret@invalid/never-connect" }
    });
    assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).ok, true);
    assert.doesNotMatch(child.stdout + child.stderr, /private:secret|ci-checkpoint-subject|PRIVATE KEY|private\.pem/);
  } finally { f.cleanup(); }
});
test("CLI creation verifies on its own client and publishes no artifact on scan failure", async () => {
  const f = files();
  try {
    const argv = args("create", ["--private-key-file", f.priv, "--out", f.out, "--acknowledge-independent-key", "--acknowledge-read-only-scan"]);
    const rows = events(3); rows[0].purpose = "corruption";
    await assert.rejects(runCheckpointCli(argv, async () => harness(rows).client), errorCode("CHECKPOINT_SCAN_FAILED"));
    assert.equal(existsSync(f.out), false);
    const result = await runCheckpointCli(argv, async () => harness(events(3)).client);
    assert.equal(result.ok, true); assert.equal(result.sequence, "3");
    assert.equal(result.checkpointSha256.length, 64);
  } finally { f.cleanup(); }
});
test("CLI compare rejects an untrusted checkpoint before connecting and accepts a valid extended chain", async () => {
  const f = files();
  try {
    const value = await createAuditCheckpoint(harness(events(3)).client, scan, keys.privateKey, context);
    writeCheckpointFile(f.out, value);
    const argv = args("compare", ["--checkpoint", f.out, "--public-key-file", f.pub, "--max-age-hours", "24", "--acknowledge-read-only-scan"]);
    assert.equal((await runCheckpointCli(argv, async () => harness(events(5)).client)).code, "CHECKPOINT_HISTORY_MATCH");
    writeFileSync(f.pub, otherKeys.publicKey.export({ type: "spki", format: "pem" }));
    await assert.rejects(runCheckpointCli(argv, () => { throw new Error("must not connect"); }), errorCode("CHECKPOINT_KEY_UNTRUSTED"));
  } finally { f.cleanup(); }
});
test("CLI failure output is bounded and never returns raw filesystem or key material errors", () => {
  const child = spawnSync(process.execPath, ["scripts/audit-checkpoint.mjs", ...args("verify", [
    "--checkpoint", "/not-present-sensitive-name", "--public-key-file", "/sensitive/key.pem", "--max-age-hours", "24"
  ])], { encoding: "utf8" });
  assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.deepEqual(JSON.parse(child.stderr), { ok: false, code: "CHECKPOINT_OPERATION_FAILED" });
  assert.doesNotMatch(child.stderr, /sensitive|ENOENT|at /);
});
