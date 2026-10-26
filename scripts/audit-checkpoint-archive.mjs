import { createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkpointKeyId,
  checkpointSubject,
  encodeAuditCheckpoint,
  parseAuditCheckpoint,
  readCheckpointFile,
  verifyAuditCheckpoint
} from "./audit-checkpoint.mjs";
import {
  readSignerTrustInventoryChain,
  resolveCheckpointSigner,
  verifySignerTrustInventoryChain
} from "./audit-signer-trust-inventory.mjs";
import {
  readTrustAuthorityChain,
  verifyTrustAuthorityChain
} from "./audit-trust-authority-chain.mjs";

const DOMAIN = "HRBP-AUDIT-CHECKPOINT-ARCHIVE:1\n";
const MAX_ARCHIVE_FILE = 8192;
const DAY_MS = 24 * 60 * 60_000;
const YEAR_MS = 365 * DAY_MS;
const HASH = /^[a-f0-9]{64}$/;
const SEQUENCE = /^(0|[1-9][0-9]{0,6})$/;
const STORAGE_PROFILE = "OPERATOR_EXTERNAL_RETENTION_TARGET";

class ArchiveError extends Error {
  constructor(code) {
    super("Audit checkpoint archive operation did not complete safely.");
    this.code = code;
  }
}
function fail(code = "CHECKPOINT_ARCHIVE_INPUT_INVALID") { throw new ArchiveError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function keyOf(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") {
    fail("CHECKPOINT_ARCHIVE_KEY_INVALID");
  }
  return key;
}
function strictIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail();
  return value;
}
function sequence(value) {
  if (typeof value !== "string" || !SEQUENCE.test(value) || BigInt(value) > 1_000_000n) fail();
  return value;
}
function retentionDays(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3650) fail();
  return value;
}
function boundedMs(value, maximum = YEAR_MS) {
  if (!Number.isSafeInteger(value) || value < 1000 || value > maximum) fail();
  return value;
}
function manifestOf(value) {
  exactKeys(value, [
    "version", "algorithm", "keyId", "subject", "scope", "checkpointSha256",
    "checkpointSequence", "checkpointIssuedAt", "exportedAt", "retentionUntil", "storageProfile"
  ]);
  if (value.version !== 1 || value.algorithm !== "Ed25519" ||
      value.scope !== "CHECKPOINT_ARCHIVE_MANIFEST" || value.storageProfile !== STORAGE_PROFILE ||
      typeof value.keyId !== "string" || !HASH.test(value.keyId) ||
      typeof value.subject !== "string" || !HASH.test(value.subject) ||
      typeof value.checkpointSha256 !== "string" || !HASH.test(value.checkpointSha256)) fail();
  const checkpointSequence = sequence(value.checkpointSequence);
  const checkpointIssuedAt = strictIso(value.checkpointIssuedAt);
  const exportedAt = strictIso(value.exportedAt);
  const retentionUntil = strictIso(value.retentionUntil);
  if (Date.parse(exportedAt) < Date.parse(checkpointIssuedAt) ||
      Date.parse(retentionUntil) <= Date.parse(exportedAt)) fail();
  return {
    version: 1,
    algorithm: "Ed25519",
    keyId: value.keyId,
    subject: value.subject,
    scope: "CHECKPOINT_ARCHIVE_MANIFEST",
    checkpointSha256: value.checkpointSha256,
    checkpointSequence,
    checkpointIssuedAt,
    exportedAt,
    retentionUntil,
    storageProfile: STORAGE_PROFILE
  };
}
function envelopeOf(value) {
  exactKeys(value, ["manifest", "signature"]);
  const manifest = manifestOf(value.manifest);
  if (typeof value.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature) ||
      Buffer.from(value.signature, "base64").toString("base64") !== value.signature) fail();
  return { manifest, signature: value.signature };
}
function signedBytes(manifest) { return Buffer.from(DOMAIN + JSON.stringify(manifest)); }

export function encodeAuditCheckpointArchive(value) {
  return JSON.stringify(envelopeOf(value)) + "\n";
}
export function parseAuditCheckpointArchive(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_ARCHIVE_FILE) fail();
  let value;
  try { value = envelopeOf(JSON.parse(text)); } catch { fail(); }
  if (text !== encodeAuditCheckpointArchive(value)) fail();
  return value;
}
function authenticateCheckpointAtIssue(checkpoint, { publicKey, tenantId, deploymentId }) {
  const parsed = parseAuditCheckpoint(encodeAuditCheckpoint(checkpoint));
  return verifyAuditCheckpoint(parsed, {
    publicKey,
    tenantId,
    deploymentId,
    maxAgeMs: 1000,
    minSequence: "0",
    now: Date.parse(parsed.payload.issuedAt)
  });
}

export function createAuditCheckpointArchive(checkpoint, privateKey, context, {
  maxAgeMs,
  retentionDays: requestedRetentionDays,
  now = Date.now()
}) {
  keyOf(privateKey, "private");
  boundedMs(maxAgeMs);
  retentionDays(requestedRetentionDays);
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const publicKey = keyOf(createPublicKey(privateKey), "public");
  const checkpointPayload = verifyAuditCheckpoint(checkpoint, {
    ...context,
    publicKey,
    maxAgeMs,
    minSequence: "0",
    now
  });
  const checkpointSha256 = digest(encodeAuditCheckpoint(checkpoint));
  const exportedAt = new Date(now).toISOString();
  const retentionUntil = new Date(now + requestedRetentionDays * DAY_MS).toISOString();
  const manifest = manifestOf({
    version: 1,
    algorithm: "Ed25519",
    keyId: checkpointPayload.keyId,
    subject: checkpointPayload.subject,
    scope: "CHECKPOINT_ARCHIVE_MANIFEST",
    checkpointSha256,
    checkpointSequence: checkpointPayload.sequence,
    checkpointIssuedAt: checkpointPayload.issuedAt,
    exportedAt,
    retentionUntil,
    storageProfile: STORAGE_PROFILE
  });
  return {
    manifest,
    signature: sign(null, signedBytes(manifest), privateKey).toString("base64")
  };
}

export function verifyAuditCheckpointArchive(archive, checkpoint, {
  publicKey,
  tenantId,
  deploymentId,
  maxExportDelayMs,
  minRetentionUntil,
  now = Date.now()
}) {
  keyOf(publicKey, "public");
  boundedMs(maxExportDelayMs);
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const envelope = envelopeOf(archive);
  const checkpointPayload = authenticateCheckpointAtIssue(checkpoint, { publicKey, tenantId, deploymentId });
  const expectedSubject = checkpointSubject({ tenantId, deploymentId });
  if (envelope.manifest.keyId !== checkpointKeyId(publicKey)) fail("CHECKPOINT_ARCHIVE_KEY_UNTRUSTED");
  if (!verify(null, signedBytes(envelope.manifest), publicKey, Buffer.from(envelope.signature, "base64"))) {
    fail("CHECKPOINT_ARCHIVE_SIGNATURE_INVALID");
  }
  if (envelope.manifest.subject !== expectedSubject || checkpointPayload.subject !== expectedSubject) {
    fail("CHECKPOINT_ARCHIVE_SUBJECT_MISMATCH");
  }
  if (envelope.manifest.checkpointSha256 !== digest(encodeAuditCheckpoint(checkpoint)) ||
      envelope.manifest.checkpointSequence !== checkpointPayload.sequence ||
      envelope.manifest.checkpointIssuedAt !== checkpointPayload.issuedAt ||
      envelope.manifest.keyId !== checkpointPayload.keyId) {
    fail("CHECKPOINT_ARCHIVE_CHECKPOINT_MISMATCH");
  }
  const exportedAtMs = Date.parse(envelope.manifest.exportedAt);
  if (exportedAtMs > now + 30_000) fail("CHECKPOINT_ARCHIVE_FUTURE");
  const exportDelay = exportedAtMs - Date.parse(envelope.manifest.checkpointIssuedAt);
  if (exportDelay < 0 || exportDelay > maxExportDelayMs) fail("CHECKPOINT_ARCHIVE_EXPORT_DELAY_EXCEEDED");
  if (minRetentionUntil !== undefined) {
    strictIso(minRetentionUntil);
    if (Date.parse(envelope.manifest.retentionUntil) < Date.parse(minRetentionUntil)) {
      fail("CHECKPOINT_ARCHIVE_RETENTION_POLICY_UNMET");
    }
  }
  if (Date.parse(envelope.manifest.retentionUntil) < now) fail("CHECKPOINT_ARCHIVE_RETENTION_EXPIRED");
  return envelope.manifest;
}

function writeNoReplaceFile(path, text) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return digest(text);
}
function fsyncDirectory(path, { rejectWorldWritable = false } = {}) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isDirectory()) fail("CHECKPOINT_ARCHIVE_OUTPUT_INVALID");
    if (rejectWorldWritable && (stat.mode & 0o002) !== 0) fail("CHECKPOINT_ARCHIVE_OUTPUT_UNSAFE");
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

export function writeAuditCheckpointArchiveBundle(directory, checkpoint, archive) {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory === "/" || directory.includes("\0")) fail();
  const parent = dirname(directory);
  try {
    fsyncDirectory(parent, { rejectWorldWritable: true });
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    fail("CHECKPOINT_ARCHIVE_OUTPUT_INVALID");
  }
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch {
    fail("CHECKPOINT_ARCHIVE_OUTPUT_EXISTS");
  }
  try {
    const checkpointSha256 = writeNoReplaceFile(join(directory, "checkpoint.json"), encodeAuditCheckpoint(checkpoint));
    const archiveManifestSha256 = writeNoReplaceFile(
      join(directory, "archive-manifest.json"),
      encodeAuditCheckpointArchive(archive)
    );
    fsyncDirectory(directory);
    fsyncDirectory(parent);
    return { checkpointSha256, archiveManifestSha256 };
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    fail("CHECKPOINT_ARCHIVE_WRITE_FAILED");
  }
}

export function readAuditCheckpointArchiveBundle(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory === "/" || directory.includes("\0")) fail();
  const checkpoint = parseAuditCheckpoint(
    readCheckpointFile(join(directory, "checkpoint.json"), { maxBytes: 4096 }).toString("utf8")
  );
  const archive = parseAuditCheckpointArchive(
    readCheckpointFile(join(directory, "archive-manifest.json"), { maxBytes: MAX_ARCHIVE_FILE }).toString("utf8")
  );
  return { checkpoint, archive };
}

function integerArg(value, min, max) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail();
  return parsed;
}
export function auditCheckpointArchiveArgs(argv) {
  const [command, ...args] = argv;
  if (!["export", "verify"].includes(command)) fail();
  const allowed = new Set([
    "--tenant-id", "--deployment-id",
    ...(command === "export"
      ? ["--checkpoint", "--private-key-file", "--max-age-hours", "--retention-days", "--out-dir", "--acknowledge-external-retention-target"]
      : [
          "--archive-dir", "--public-key-file",
          "--trust-inventory-dir", "--trust-authority-public-key-file",
          "--trust-authority-chain-dir", "--trust-bootstrap-authority-public-key-file",
          "--expected-trust-authority-chain-sha256", "--trust-authority-chain-max-age-hours",
          "--expected-trust-sha256", "--trust-max-age-hours",
          "--max-export-delay-hours", "--min-retention-until"
        ])
  ]);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) fail();
    if (flag === "--acknowledge-external-retention-target") { values[flag] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  const required = ["--tenant-id", "--deployment-id", ...(command === "export"
    ? ["--checkpoint", "--private-key-file", "--max-age-hours", "--retention-days", "--out-dir", "--acknowledge-external-retention-target"]
    : ["--archive-dir", "--max-export-delay-hours"])];
  if (required.some(flag => !values[flag])) fail();
  if (command === "verify") {
    const direct = Boolean(values["--public-key-file"]);
    const governedBase = [
      "--trust-inventory-dir", "--expected-trust-sha256", "--trust-max-age-hours"
    ];
    const chainFlags = [
      "--trust-authority-chain-dir", "--trust-bootstrap-authority-public-key-file",
      "--expected-trust-authority-chain-sha256", "--trust-authority-chain-max-age-hours"
    ];
    const baseReady = governedBase.every(flag => Boolean(values[flag]));
    const basePartial = governedBase.some(flag => Boolean(values[flag]));
    const chainReady = chainFlags.every(flag => Boolean(values[flag]));
    const chainPartial = chainFlags.some(flag => Boolean(values[flag]));
    const directAuthority = Boolean(values["--trust-authority-public-key-file"]);
    const governed = baseReady && (directAuthority !== chainReady);
    if (direct === governed || basePartial && !baseReady || chainPartial && !chainReady ||
        directAuthority && chainReady) fail();
  }
  const context = { tenantId: values["--tenant-id"], deploymentId: values["--deployment-id"] };
  checkpointSubject(context);
  if (command === "export" && !isAbsolute(values["--out-dir"])) fail();
  if (command === "verify" && !isAbsolute(values["--archive-dir"])) fail();
  if (command === "verify" && values["--trust-inventory-dir"] !== undefined &&
      !isAbsolute(values["--trust-inventory-dir"])) fail();
  if (command === "verify" && values["--trust-authority-chain-dir"] !== undefined &&
      !isAbsolute(values["--trust-authority-chain-dir"])) fail();
  for (const flag of ["--expected-trust-sha256", "--expected-trust-authority-chain-sha256"]) {
    if (values[flag] !== undefined && !HASH.test(values[flag])) fail();
  }
  const maxAgeMs = command === "export"
    ? integerArg(values["--max-age-hours"], 1, 24 * 365) * 3600_000
    : null;
  const requestedRetentionDays = command === "export"
    ? integerArg(values["--retention-days"], 1, 3650)
    : null;
  const maxExportDelayMs = command === "verify"
    ? integerArg(values["--max-export-delay-hours"], 1, 24 * 365) * 3600_000
    : null;
  const trustMaxAgeMs = command === "verify" && values["--trust-max-age-hours"] !== undefined
    ? integerArg(values["--trust-max-age-hours"], 1, 24 * 3650) * 3600_000
    : null;
  const trustAuthorityChainMaxAgeMs = command === "verify" && values["--trust-authority-chain-max-age-hours"] !== undefined
    ? integerArg(values["--trust-authority-chain-max-age-hours"], 1, 24 * 3650) * 3600_000
    : null;
  if (values["--min-retention-until"] !== undefined) strictIso(values["--min-retention-until"]);
  return {
    command, values, context, maxAgeMs, requestedRetentionDays,
    maxExportDelayMs, trustMaxAgeMs, trustAuthorityChainMaxAgeMs
  };
}

export async function runAuditCheckpointArchiveCli(argv, clock = Date.now) {
  const parsed = auditCheckpointArchiveArgs(argv);
  if (parsed.command === "export") {
    const privatePem = readCheckpointFile(parsed.values["--private-key-file"], { privateKey: true, maxBytes: 16_384 });
    let privateKey;
    try { privateKey = keyOf(createPrivateKey(privatePem), "private"); } finally { privatePem.fill(0); }
    const checkpoint = parseAuditCheckpoint(
      readCheckpointFile(parsed.values["--checkpoint"], { maxBytes: 4096 }).toString("utf8")
    );
    const archive = createAuditCheckpointArchive(checkpoint, privateKey, parsed.context, {
      maxAgeMs: parsed.maxAgeMs,
      retentionDays: parsed.requestedRetentionDays,
      now: clock()
    });
    const written = writeAuditCheckpointArchiveBundle(parsed.values["--out-dir"], checkpoint, archive);
    return {
      ok: true,
      code: "CHECKPOINT_ARCHIVE_EXPORTED",
      sequence: archive.manifest.checkpointSequence,
      checkpointSha256: written.checkpointSha256,
      archiveManifestSha256: written.archiveManifestSha256,
      retentionUntil: archive.manifest.retentionUntil
    };
  }
  const now = clock();
  const { checkpoint, archive } = readAuditCheckpointArchiveBundle(parsed.values["--archive-dir"]);
  let publicKey;
  let trustInventory = null;
  if (parsed.values["--public-key-file"]) {
    const publicPem = readCheckpointFile(parsed.values["--public-key-file"], { maxBytes: 16_384 });
    if (!publicPem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) fail("CHECKPOINT_ARCHIVE_KEY_INVALID");
    publicKey = keyOf(createPublicKey(publicPem), "public");
  } else {
    let authorityPublicKey;
    let governedAuthorityChain = null;
    if (parsed.values["--trust-authority-public-key-file"]) {
      const authorityPem = readCheckpointFile(parsed.values["--trust-authority-public-key-file"], { maxBytes: 16_384 });
      if (!authorityPem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) fail("CHECKPOINT_ARCHIVE_KEY_INVALID");
      authorityPublicKey = keyOf(createPublicKey(authorityPem), "public");
    } else {
      const bootstrapPem = readCheckpointFile(parsed.values["--trust-bootstrap-authority-public-key-file"], { maxBytes: 16_384 });
      if (!bootstrapPem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) fail("CHECKPOINT_ARCHIVE_KEY_INVALID");
      governedAuthorityChain = verifyTrustAuthorityChain(
        readTrustAuthorityChain(parsed.values["--trust-authority-chain-dir"]),
        {
          ...parsed.context,
          bootstrapAuthorityPublicKey: keyOf(createPublicKey(bootstrapPem), "public"),
          expectedLatestSha256: parsed.values["--expected-trust-authority-chain-sha256"],
          maxAgeMs: parsed.trustAuthorityChainMaxAgeMs,
          now
        }
      );
    }
    trustInventory = verifySignerTrustInventoryChain(
      readSignerTrustInventoryChain(parsed.values["--trust-inventory-dir"]),
      {
        ...parsed.context,
        ...(governedAuthorityChain ? { authorityChain: governedAuthorityChain } : { authorityPublicKey }),
        expectedLatestSha256: parsed.values["--expected-trust-sha256"],
        maxAgeMs: parsed.trustMaxAgeMs,
        now
      }
    );
    publicKey = resolveCheckpointSigner(trustInventory.latest, {
      keyId: checkpoint.payload.keyId,
      issuedAt: checkpoint.payload.issuedAt
    });
    if (governedAuthorityChain) {
      trustInventory.authorityChainGeneration = governedAuthorityChain.latest.payload.generation;
      trustInventory.authorityChainSha256 = governedAuthorityChain.latestSha256;
    }
  }
  const manifest = verifyAuditCheckpointArchive(archive, checkpoint, {
    ...parsed.context,
    publicKey,
    maxExportDelayMs: parsed.maxExportDelayMs,
    minRetentionUntil: parsed.values["--min-retention-until"],
    now
  });
  return {
    ok: true,
    code: "CHECKPOINT_ARCHIVE_VALID",
    sequence: manifest.checkpointSequence,
    retentionUntil: manifest.retentionUntil,
    checkpointSha256: manifest.checkpointSha256,
    ...(trustInventory ? {
      trustGeneration: trustInventory.latest.manifest.generation,
      trustInventorySha256: trustInventory.latestSha256,
      ...(trustInventory.authorityChainGeneration ? {
        trustAuthorityChainGeneration: trustInventory.authorityChainGeneration,
        trustAuthorityChainSha256: trustInventory.authorityChainSha256
      } : {})
    } : {})
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runAuditCheckpointArchiveCli(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof ArchiveError ? error.code : "CHECKPOINT_ARCHIVE_OPERATION_FAILED"
    }));
    process.exitCode = 1;
  }
}
