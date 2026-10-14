import { createHash, createPrivateKey, createPublicKey, KeyObject, randomUUID, sign, verify } from "node:crypto";
import { constants, openSync, fstatSync, readSync, closeSync, writeFileSync, fsyncSync, linkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { auditHistoryOptions, verifyFullAuditHistory } from "./audit-full-history-verification.mjs";

const DOMAIN = "HRBP-AUDIT-FULL-CHECKPOINT:1\n";
const MAX_FILE = 4096;
const HASH = /^[a-f0-9]{64}$/;
const SUBJECT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const YEAR_MS = 365 * 24 * 60 * 60_000;
class CheckpointError extends Error {
  constructor(code) { super("Audit checkpoint operation did not complete safely."); this.code = code; }
}
function fail(code = "CHECKPOINT_INPUT_INVALID") { throw new CheckpointError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail();
}
function sequence(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,6})$/.test(value) || BigInt(value) > 1_000_000n) fail();
  return value;
}
export function checkpointSubject({ tenantId, deploymentId }) {
  if (typeof tenantId !== "string" || !SUBJECT_ID.test(tenantId) ||
      typeof deploymentId !== "string" || !SUBJECT_ID.test(deploymentId)) fail();
  // Domain/deployment binding; a pseudonymous reference, NOT anonymization.
  return digest(JSON.stringify(["HRBP-AUDIT-SUBJECT:1", deploymentId, tenantId]));
}
function keyOf(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") {
    fail("CHECKPOINT_KEY_INVALID");
  }
  return key;
}
export function checkpointKeyId(publicKey) {
  return digest(keyOf(publicKey, "public").export({ type: "spki", format: "der" }));
}
function payloadOf(value) {
  exactKeys(value, ["version", "algorithm", "keyId", "subject", "scope", "sequence", "tailHash", "eventsChecked", "issuedAt"]);
  if (value.version !== 1 || value.algorithm !== "Ed25519" || value.scope !== "FULL_READ_ONLY_SNAPSHOT" ||
      typeof value.keyId !== "string" || !HASH.test(value.keyId) ||
      typeof value.subject !== "string" || !HASH.test(value.subject)) fail();
  const seq = sequence(value.sequence);
  if (value.eventsChecked !== Number(seq) ||
      (seq === "0" ? value.tailHash !== null : typeof value.tailHash !== "string" || !HASH.test(value.tailHash)) ||
      typeof value.issuedAt !== "string" || !Number.isFinite(Date.parse(value.issuedAt)) ||
      new Date(value.issuedAt).toISOString() !== value.issuedAt) fail();
  // Fixed primitive-only field order. No general/custom JSON canonicalizer.
  return { version: 1, algorithm: "Ed25519", keyId: value.keyId, subject: value.subject,
    scope: "FULL_READ_ONLY_SNAPSHOT", sequence: seq, tailHash: value.tailHash,
    eventsChecked: value.eventsChecked, issuedAt: value.issuedAt };
}
function envelopeOf(value) {
  exactKeys(value, ["payload", "signature"]);
  const payload = payloadOf(value.payload);
  if (typeof value.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature) ||
      Buffer.from(value.signature, "base64").toString("base64") !== value.signature) fail();
  return { payload, signature: value.signature };
}
export function encodeAuditCheckpoint(value) { return JSON.stringify(envelopeOf(value)) + "\n"; }
export function parseAuditCheckpoint(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_FILE) fail();
  let value;
  try { value = envelopeOf(JSON.parse(text)); } catch { fail(); }
  // Reject duplicate keys, extra fields, alternate encodings and ambiguous JSON.
  if (text !== encodeAuditCheckpoint(value)) fail();
  return value;
}
function signedBytes(payload) { return Buffer.from(DOMAIN + JSON.stringify(payload)); }

/** Always scans on this operator's trusted host. Never signs a server-provided
 * unsigned report. No caller-supplied head hash or timestamp is accepted by CLI.
 */
export async function createAuditCheckpoint(client, scanOptions, privateKey, context, clock = Date.now) {
  keyOf(privateKey, "private");
  const subject = checkpointSubject({ ...context, tenantId: scanOptions.tenantId });
  const result = await verifyFullAuditHistory(client, scanOptions, clock, { includeVerifiedHead: true });
  if (!result.valid || !result.complete || !result.verifiedHead ||
      result.verifiedHead.sequence !== result.lastSequence) fail("CHECKPOINT_SCAN_FAILED");
  const payload = payloadOf({ version: 1, algorithm: "Ed25519",
    keyId: checkpointKeyId(createPublicKey(privateKey)), subject, scope: result.scope,
    sequence: result.lastSequence, tailHash: result.verifiedHead.hash,
    eventsChecked: result.eventsChecked, issuedAt: new Date(clock()).toISOString() });
  return { payload, signature: sign(null, signedBytes(payload), privateKey).toString("base64") };
}

/** Offline signature/identity/freshness verification. The public key, expected
 * subject, age policy and optional replay floor/digest come from OUTSIDE the
 * checkpoint. A good signature alone says nothing about today's database.
 */
export function verifyAuditCheckpoint(value, { publicKey, tenantId, deploymentId, maxAgeMs,
  minSequence = "0", expectedDigest, now = Date.now() }) {
  const envelope = envelopeOf(value), payload = envelope.payload;
  const subject = checkpointSubject({ tenantId, deploymentId });
  sequence(minSequence);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > YEAR_MS ||
      !Number.isSafeInteger(now) || now < 0 || (expectedDigest !== undefined && !HASH.test(expectedDigest))) fail();
  if (payload.keyId !== checkpointKeyId(publicKey)) fail("CHECKPOINT_KEY_UNTRUSTED");
  if (!verify(null, signedBytes(payload), publicKey, Buffer.from(envelope.signature, "base64"))) fail("CHECKPOINT_SIGNATURE_INVALID");
  if (payload.subject !== subject) fail("CHECKPOINT_SUBJECT_MISMATCH");
  if (expectedDigest !== undefined && digest(encodeAuditCheckpoint(envelope)) !== expectedDigest) fail("CHECKPOINT_DIGEST_MISMATCH");
  const age = now - Date.parse(payload.issuedAt);
  if (age < -30_000) fail("CHECKPOINT_FUTURE");
  if (age > maxAgeMs) fail("CHECKPOINT_STALE");
  if (BigInt(payload.sequence) < BigInt(minSequence)) fail("CHECKPOINT_SEQUENCE_ROLLBACK");
  return payload;
}
export async function compareAuditCheckpoint(client, scanOptions, value, trust, clock = Date.now) {
  if (scanOptions.tenantId !== trust.tenantId) fail("CHECKPOINT_SUBJECT_MISMATCH");
  const payload = verifyAuditCheckpoint(value, trust);
  return verifyFullAuditHistory(client, scanOptions, clock,
    { anchor: { sequence: payload.sequence, hash: payload.tailHash } });
}

/** Local POSIX operator files only; no URL, network fetch or trust-on-first-use.
 * Parent directories must be controlled by the operator. File descriptors bound
 * reads and avoid final-component symlinks, blocking FIFOs and unbounded input.
 */
export function readCheckpointFile(path, { privateKey = false, maxBytes = MAX_FILE } = {}) {
  if (typeof path !== "string" || !path || path.includes("\0") || !Number.isInteger(constants.O_NOFOLLOW)) fail();
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes || (privateKey &&
        ((stat.mode & 0o077) !== 0 || stat.nlink !== 1 || stat.uid !== process.geteuid()))) fail("CHECKPOINT_FILE_INVALID");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0, n;
    while (length < buffer.length && (n = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += n;
    if (length > maxBytes) { buffer.fill(0); fail("CHECKPOINT_FILE_INVALID"); }
    return buffer.subarray(0, length);
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function writeCheckpointFile(path, value) {
  const bytes = encodeAuditCheckpoint(value);
  // Stage in the same trusted directory, fsync, then atomically publish without
  // replacing an existing destination (including a symlink). Never truncate it.
  const directory = dirname(path), temporary = join(directory, `.hrbp-checkpoint-${randomUUID()}.tmp`);
  let fd, created = false;
  try {
    fd = openSync(temporary, "wx", 0o600); created = true;
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    linkSync(temporary, path);
    unlinkSync(temporary); created = false;
    const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created) unlinkSync(temporary);
  }
  return digest(bytes);
}
export function auditCheckpointArgs(argv) {
  const [command, ...args] = argv;
  if (!["create", "verify", "compare"].includes(command)) fail();
  const allowed = new Set(["--tenant-id", "--deployment-id",
    ...(command === "create" ? ["--private-key-file", "--out", "--acknowledge-independent-key"]
      : ["--checkpoint", "--public-key-file", "--max-age-hours", "--min-sequence", "--expected-sha256"]),
    ...(command !== "verify" ? ["--acknowledge-read-only-scan", "--max-events", "--batch-size"] : [])]);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) fail();
    if (flag.startsWith("--acknowledge-")) { values[flag] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  const required = ["--tenant-id", "--deployment-id", ...(command === "create"
    ? ["--private-key-file", "--out", "--acknowledge-independent-key"]
    : ["--checkpoint", "--public-key-file", "--max-age-hours"]),
    ...(command !== "verify" ? ["--acknowledge-read-only-scan"] : [])];
  if (required.some(flag => !values[flag])) fail();
  const context = { tenantId: values["--tenant-id"], deploymentId: values["--deployment-id"] };
  checkpointSubject(context);
  function count(flag, fallback) {
    if (values[flag] === undefined) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(values[flag])) fail();
    return Number(values[flag]);
  }
  const scan = command === "verify" ? null : auditHistoryOptions({ tenantId: context.tenantId,
    maxEvents: count("--max-events", 50_000), batchSize: count("--batch-size", 250) });
  const maxAgeMs = command === "create" ? null : count("--max-age-hours") * 3600_000;
  if (command !== "create" && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 3600_000 || maxAgeMs > YEAR_MS)) fail();
  if (values["--min-sequence"] !== undefined) sequence(values["--min-sequence"]);
  if (values["--expected-sha256"] !== undefined && !HASH.test(values["--expected-sha256"])) fail();
  return { command, values, context, scan, maxAgeMs };
}
async function connectDatabase() {
  if (!process.env.DATABASE_URL) fail("CHECKPOINT_DATABASE_UNCONFIGURED");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  try { await client.connect(); return client; } catch (error) { await client.end().catch(() => {}); throw error; }
}
export async function runCheckpointCli(argv, connect = connectDatabase) {
  const { command, values, context, scan, maxAgeMs } = auditCheckpointArgs(argv);
  if (command === "create") {
    const pem = readCheckpointFile(values["--private-key-file"], { privateKey: true, maxBytes: 16_384 });
    let key;
    try { key = keyOf(createPrivateKey(pem), "private"); } finally { pem.fill(0); }
    const client = await connect();
    try {
      const checkpoint = await createAuditCheckpoint(client, scan, key, context);
      const checkpointSha256 = writeCheckpointFile(values["--out"], checkpoint);
      return { ok: true, code: "CHECKPOINT_CREATED", sequence: checkpoint.payload.sequence, checkpointSha256 };
    } finally { await client.end().catch(() => {}); }
  }
  const pem = readCheckpointFile(values["--public-key-file"], { maxBytes: 16_384 });
  // Do not accidentally import a private key for the offline verification path.
  if (!pem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) fail("CHECKPOINT_KEY_INVALID");
  const publicKey = keyOf(createPublicKey(pem), "public");
  const checkpoint = parseAuditCheckpoint(readCheckpointFile(values["--checkpoint"]).toString("utf8"));
  const trust = { ...context, publicKey, maxAgeMs, minSequence: values["--min-sequence"] ?? "0",
    expectedDigest: values["--expected-sha256"] };
  const payload = verifyAuditCheckpoint(checkpoint, trust); // before ANY connection
  if (command === "verify") return { ok: true, code: "CHECKPOINT_SIGNATURE_VALID", scope: "SIGNED_SNAPSHOT_ONLY", sequence: payload.sequence };
  const client = await connect();
  try {
    const result = await compareAuditCheckpoint(client, scan, checkpoint, trust);
    return { ok: result.valid && result.complete, code: result.valid && result.complete ? "CHECKPOINT_HISTORY_MATCH" : result.code,
      eventsChecked: result.eventsChecked, lastSequence: result.lastSequence };
  } finally { await client.end().catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runCheckpointCli(process.argv.slice(2));
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    // Never print raw filesystem/crypto/database exceptions, paths or secrets.
    console.error(JSON.stringify({ ok: false, code: error instanceof CheckpointError ? error.code : "CHECKPOINT_OPERATION_FAILED" }));
    process.exitCode = 1;
  }
}
