import {
  createHash, createPrivateKey, createPublicKey, KeyObject, randomUUID, sign, verify
} from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, openSync, unlinkSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkpointKeyId, readCheckpointFile
} from "./audit-checkpoint.mjs";
import {
  encodeAuditCheckpointArchive, readAuditCheckpointArchiveBundle
} from "./audit-checkpoint-archive.mjs";
import {
  encodeTimestampEvidence, parseTimestampEvidence
} from "./audit-checkpoint-timestamp.mjs";

const DOMAIN = "HRBP-AUDIT-RETENTION-EVIDENCE:1\n";
const SCOPE = "EXTERNAL_RETENTION_EVIDENCE_BINDING";
const ASSURANCE = "OPERATOR_ATTESTED_PROVIDER_RECEIPT";
const HASH = /^[a-f0-9]{64}$/;
const MAX_ARCHIVE_MANIFEST = 16 * 1024;
const MAX_TIMESTAMP_EVIDENCE = 32 * 1024;
const MAX_PROVIDER_RECEIPT = 4 * 1024 * 1024;
const MAX_EVIDENCE = 64 * 1024;
const RETENTION_MODES = new Set([
  "OBJECT_LOCK_COMPLIANCE",
  "OBJECT_LOCK_GOVERNANCE",
  "VAULT_LOCK",
  "APPEND_ONLY_ARCHIVE",
  "REGULATED_ARCHIVE"
]);

class RetentionEvidenceError extends Error {
  constructor(code) {
    super("Audit retention evidence operation did not complete safely.");
    this.code = code;
  }
}
function fail(code = "RETENTION_EVIDENCE_INPUT_INVALID") { throw new RetentionEvidenceError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function keyOf(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") {
    fail("RETENTION_EVIDENCE_KEY_INVALID");
  }
  return key;
}
function strictIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail();
  return value;
}
function storageTargetRef(storageTargetId) {
  if (typeof storageTargetId !== "string" || !/^[A-Za-z0-9_.:@/-]{1,256}$/.test(storageTargetId)) fail();
  return digest(JSON.stringify(["HRBP-RETENTION-TARGET:1", storageTargetId]));
}
function safeFile(path, maxBytes) {
  const bytes = readCheckpointFile(path, { maxBytes });
  if (!bytes.length) fail("RETENTION_EVIDENCE_FILE_INVALID");
  return bytes;
}
function manifestOf(value) {
  const keys = [
    "version","algorithm","controllerKeyId","subject","scope","assuranceLevel",
    "archiveManifestSha256","checkpointSha256","timestampEvidenceSha256",
    "timestampResponseSha256","timestampAt","providerReceiptSha256","storageTargetRef",
    "retentionMode","requestedRetentionUntil","providerRetentionUntil","recordedAt"
  ];
  exactKeys(value, keys);
  if (value.version !== 1 || value.algorithm !== "Ed25519" || value.scope !== SCOPE ||
      value.assuranceLevel !== ASSURANCE ||
      typeof value.controllerKeyId !== "string" || !HASH.test(value.controllerKeyId) ||
      typeof value.subject !== "string" || !HASH.test(value.subject) ||
      typeof value.archiveManifestSha256 !== "string" || !HASH.test(value.archiveManifestSha256) ||
      typeof value.checkpointSha256 !== "string" || !HASH.test(value.checkpointSha256) ||
      typeof value.timestampEvidenceSha256 !== "string" || !HASH.test(value.timestampEvidenceSha256) ||
      typeof value.timestampResponseSha256 !== "string" || !HASH.test(value.timestampResponseSha256) ||
      typeof value.providerReceiptSha256 !== "string" || !HASH.test(value.providerReceiptSha256) ||
      typeof value.storageTargetRef !== "string" || !HASH.test(value.storageTargetRef) ||
      !RETENTION_MODES.has(value.retentionMode)) fail();

  const timestampAt = strictIso(value.timestampAt);
  const requestedRetentionUntil = strictIso(value.requestedRetentionUntil);
  const providerRetentionUntil = strictIso(value.providerRetentionUntil);
  const recordedAt = strictIso(value.recordedAt);
  if (Date.parse(providerRetentionUntil) < Date.parse(requestedRetentionUntil)) {
    fail("RETENTION_EVIDENCE_RETENTION_POLICY_UNMET");
  }
  if (Date.parse(providerRetentionUntil) <= Date.parse(recordedAt)) {
    fail("RETENTION_EVIDENCE_RETENTION_EXPIRED");
  }
  if (Date.parse(timestampAt) > Date.parse(recordedAt) + 30_000) {
    fail("RETENTION_EVIDENCE_TIMESTAMP_FUTURE");
  }
  return {
    version:1,
    algorithm:"Ed25519",
    controllerKeyId:value.controllerKeyId,
    subject:value.subject,
    scope:SCOPE,
    assuranceLevel:ASSURANCE,
    archiveManifestSha256:value.archiveManifestSha256,
    checkpointSha256:value.checkpointSha256,
    timestampEvidenceSha256:value.timestampEvidenceSha256,
    timestampResponseSha256:value.timestampResponseSha256,
    timestampAt,
    providerReceiptSha256:value.providerReceiptSha256,
    storageTargetRef:value.storageTargetRef,
    retentionMode:value.retentionMode,
    requestedRetentionUntil,
    providerRetentionUntil,
    recordedAt
  };
}
function envelopeOf(value) {
  exactKeys(value, ["manifest","signature"]);
  const manifest = manifestOf(value.manifest);
  if (typeof value.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature) ||
      Buffer.from(value.signature, "base64").toString("base64") !== value.signature) fail();
  return { manifest, signature:value.signature };
}
function signedBytes(manifest) {
  return Buffer.from(DOMAIN + JSON.stringify(manifest));
}
export function encodeRetentionEvidence(value) {
  return JSON.stringify(envelopeOf(value)) + "\n";
}
export function parseRetentionEvidence(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_EVIDENCE) fail();
  let value;
  try { value = envelopeOf(JSON.parse(text)); } catch { fail(); }
  if (text !== encodeRetentionEvidence(value)) fail();
  return value;
}

function archiveInputs(archiveDir, expectedArchiveManifestSha256) {
  if (typeof expectedArchiveManifestSha256 !== "string" || !HASH.test(expectedArchiveManifestSha256)) fail();
  const bundle = readAuditCheckpointArchiveBundle(archiveDir);
  const archiveBytes = safeFile(join(archiveDir, "archive-manifest.json"), MAX_ARCHIVE_MANIFEST);
  const archiveSha256 = digest(archiveBytes);
  if (archiveSha256 !== expectedArchiveManifestSha256) fail("RETENTION_EVIDENCE_ARCHIVE_DIGEST_MISMATCH");
  if (archiveBytes.toString("utf8") !== encodeAuditCheckpointArchive(bundle.archive)) {
    fail("RETENTION_EVIDENCE_ARCHIVE_INVALID");
  }
  return { bundle, archiveBytes, archiveSha256 };
}
function timestampInputs(timestampEvidencePath, expectedTimestampEvidenceSha256) {
  if (typeof expectedTimestampEvidenceSha256 !== "string" || !HASH.test(expectedTimestampEvidenceSha256)) fail();
  const bytes = safeFile(timestampEvidencePath, MAX_TIMESTAMP_EVIDENCE);
  const evidence = parseTimestampEvidence(bytes.toString("utf8"));
  if (bytes.toString("utf8") !== encodeTimestampEvidence(evidence)) fail("RETENTION_EVIDENCE_TIMESTAMP_INVALID");
  const sha256 = digest(bytes);
  if (sha256 !== expectedTimestampEvidenceSha256) fail("RETENTION_EVIDENCE_TIMESTAMP_DIGEST_MISMATCH");
  return { evidence, bytes, sha256 };
}

export function createRetentionEvidence({
  archiveDir,
  expectedArchiveManifestSha256,
  timestampEvidencePath,
  expectedTimestampEvidenceSha256,
  providerReceiptPath,
  controllerPrivateKey,
  storageTargetId,
  retentionMode,
  providerRetentionUntil,
  now = Date.now()
}) {
  keyOf(controllerPrivateKey, "private");
  if (!Number.isSafeInteger(now) || now < 0 || !RETENTION_MODES.has(retentionMode)) fail();
  const { bundle, archiveSha256 } = archiveInputs(archiveDir, expectedArchiveManifestSha256);
  const { evidence: timestampEvidence, sha256: timestampEvidenceSha256 } =
    timestampInputs(timestampEvidencePath, expectedTimestampEvidenceSha256);
  const providerReceipt = safeFile(providerReceiptPath, MAX_PROVIDER_RECEIPT);
  const controllerPublicKey = keyOf(createPublicKey(controllerPrivateKey), "public");
  const controllerKeyId = checkpointKeyId(controllerPublicKey);

  if (controllerKeyId === bundle.archive.manifest.keyId) {
    fail("RETENTION_EVIDENCE_SEPARATION_VIOLATION");
  }
  if (timestampEvidence.checkpointSha256 !== bundle.archive.manifest.checkpointSha256) {
    fail("RETENTION_EVIDENCE_CHECKPOINT_MISMATCH");
  }

  const manifest = manifestOf({
    version:1,
    algorithm:"Ed25519",
    controllerKeyId,
    subject:bundle.archive.manifest.subject,
    scope:SCOPE,
    assuranceLevel:ASSURANCE,
    archiveManifestSha256:archiveSha256,
    checkpointSha256:bundle.archive.manifest.checkpointSha256,
    timestampEvidenceSha256,
    timestampResponseSha256:timestampEvidence.timestampResponseSha256,
    timestampAt:timestampEvidence.timestampAt,
    providerReceiptSha256:digest(providerReceipt),
    storageTargetRef:storageTargetRef(storageTargetId),
    retentionMode,
    requestedRetentionUntil:bundle.archive.manifest.retentionUntil,
    providerRetentionUntil,
    recordedAt:new Date(now).toISOString()
  });
  return {
    manifest,
    signature:sign(null, signedBytes(manifest), controllerPrivateKey).toString("base64")
  };
}

export function verifyRetentionEvidence(value, {
  archiveDir,
  expectedArchiveManifestSha256,
  timestampEvidencePath,
  expectedTimestampEvidenceSha256,
  providerReceiptPath,
  controllerPublicKey,
  storageTargetId,
  expectedEvidenceSha256,
  minRetentionUntil,
  now = Date.now()
}) {
  keyOf(controllerPublicKey, "public");
  if (!Number.isSafeInteger(now) || now < 0 ||
      typeof expectedEvidenceSha256 !== "string" || !HASH.test(expectedEvidenceSha256)) fail();

  const envelope = envelopeOf(value);
  const encoded = encodeRetentionEvidence(envelope);
  if (digest(encoded) !== expectedEvidenceSha256) fail("RETENTION_EVIDENCE_DIGEST_MISMATCH");

  const { bundle, archiveSha256 } = archiveInputs(archiveDir, expectedArchiveManifestSha256);
  const { evidence: timestampEvidence, sha256: timestampEvidenceSha256 } =
    timestampInputs(timestampEvidencePath, expectedTimestampEvidenceSha256);
  const providerReceipt = safeFile(providerReceiptPath, MAX_PROVIDER_RECEIPT);
  const controllerKeyId = checkpointKeyId(controllerPublicKey);

  if (envelope.manifest.controllerKeyId !== controllerKeyId) fail("RETENTION_EVIDENCE_CONTROLLER_UNTRUSTED");
  if (!verify(null, signedBytes(envelope.manifest), controllerPublicKey,
      Buffer.from(envelope.signature, "base64"))) {
    fail("RETENTION_EVIDENCE_SIGNATURE_INVALID");
  }
  if (controllerKeyId === bundle.archive.manifest.keyId) {
    fail("RETENTION_EVIDENCE_SEPARATION_VIOLATION");
  }
  const expected = {
    subject:bundle.archive.manifest.subject,
    archiveManifestSha256:archiveSha256,
    checkpointSha256:bundle.archive.manifest.checkpointSha256,
    timestampEvidenceSha256,
    timestampResponseSha256:timestampEvidence.timestampResponseSha256,
    timestampAt:timestampEvidence.timestampAt,
    providerReceiptSha256:digest(providerReceipt),
    storageTargetRef:storageTargetRef(storageTargetId),
    requestedRetentionUntil:bundle.archive.manifest.retentionUntil
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (envelope.manifest[field] !== expectedValue) fail("RETENTION_EVIDENCE_SOURCE_MISMATCH");
  }
  if (minRetentionUntil !== undefined) {
    const floor = strictIso(minRetentionUntil);
    if (Date.parse(envelope.manifest.providerRetentionUntil) < Date.parse(floor)) {
      fail("RETENTION_EVIDENCE_RETENTION_POLICY_UNMET");
    }
  }
  if (Date.parse(envelope.manifest.providerRetentionUntil) <= now) {
    fail("RETENTION_EVIDENCE_RETENTION_EXPIRED");
  }
  return envelope.manifest;
}

function writeNoReplace(path, bytes) {
  if (typeof path !== "string" || !path || path.includes("\0")) fail();
  const directory = dirname(path);
  const temporary = join(directory, `.hrbp-retention-${randomUUID()}.tmp`);
  let fd, created = false;
  try {
    fd = openSync(temporary, "wx", 0o600); created = true;
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    linkSync(temporary, path);
    unlinkSync(temporary); created = false;
    const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(dir).isDirectory()) fail("RETENTION_EVIDENCE_OUTPUT_INVALID");
      fsyncSync(dir);
    } finally { closeSync(dir); }
  } catch (error) {
    if (error instanceof RetentionEvidenceError) throw error;
    fail(error?.code === "EEXIST" ? "RETENTION_EVIDENCE_OUTPUT_EXISTS" : "RETENTION_EVIDENCE_OUTPUT_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created) {
      try { unlinkSync(temporary); } catch {}
    }
  }
  return digest(bytes);
}
function readPrivateKey(path) {
  const pem = readCheckpointFile(path, { privateKey:true, maxBytes:16_384 });
  try { return keyOf(createPrivateKey(pem), "private"); }
  finally { pem.fill(0); }
}
function readPublicKey(path) {
  const pem = readCheckpointFile(path, { maxBytes:16_384 });
  if (!pem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) fail("RETENTION_EVIDENCE_KEY_INVALID");
  return keyOf(createPublicKey(pem), "public");
}
function flags(argv, command) {
  const common = [
    "--archive-dir","--expected-archive-manifest-sha256",
    "--timestamp-evidence","--expected-timestamp-evidence-sha256",
    "--provider-receipt","--storage-target-id"
  ];
  const allowed = new Set([
    ...common,
    ...(command === "create"
      ? [
          "--controller-private-key-file","--retention-mode","--provider-retention-until","--out",
          "--acknowledge-provider-retention-verified"
        ]
      : [
          "--evidence","--controller-public-key-file","--expected-evidence-sha256",
          "--min-retention-until"
        ])
  ]);
  const values = {};
  for (let index=0; index<argv.length; index++) {
    const flag = argv[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) fail();
    if (flag === "--acknowledge-provider-retention-verified") {
      values[flag] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  return values;
}
export async function runRetentionEvidenceCli(argv, clock = Date.now) {
  const [command, ...rest] = argv;
  if (!["create","verify"].includes(command)) fail();
  const values = flags(rest, command);
  const commonRequired = [
    "--archive-dir","--expected-archive-manifest-sha256",
    "--timestamp-evidence","--expected-timestamp-evidence-sha256",
    "--provider-receipt","--storage-target-id"
  ];
  const required = [
    ...commonRequired,
    ...(command === "create"
      ? [
          "--controller-private-key-file","--retention-mode","--provider-retention-until","--out",
          "--acknowledge-provider-retention-verified"
        ]
      : ["--evidence","--controller-public-key-file","--expected-evidence-sha256"])
  ];
  if (required.some(flag => !values[flag])) fail();

  if (command === "create") {
    const evidence = createRetentionEvidence({
      archiveDir:values["--archive-dir"],
      expectedArchiveManifestSha256:values["--expected-archive-manifest-sha256"],
      timestampEvidencePath:values["--timestamp-evidence"],
      expectedTimestampEvidenceSha256:values["--expected-timestamp-evidence-sha256"],
      providerReceiptPath:values["--provider-receipt"],
      controllerPrivateKey:readPrivateKey(values["--controller-private-key-file"]),
      storageTargetId:values["--storage-target-id"],
      retentionMode:values["--retention-mode"],
      providerRetentionUntil:values["--provider-retention-until"],
      now:clock()
    });
    const bytes = Buffer.from(encodeRetentionEvidence(evidence));
    const evidenceSha256 = writeNoReplace(values["--out"], bytes);
    return {
      ok:true,
      code:"RETENTION_EVIDENCE_CREATED",
      checkpointSha256:evidence.manifest.checkpointSha256,
      providerReceiptSha256:evidence.manifest.providerReceiptSha256,
      providerRetentionUntil:evidence.manifest.providerRetentionUntil,
      evidenceSha256
    };
  }

  const evidenceBytes = safeFile(values["--evidence"], MAX_EVIDENCE);
  const evidence = parseRetentionEvidence(evidenceBytes.toString("utf8"));
  const manifest = verifyRetentionEvidence(evidence, {
    archiveDir:values["--archive-dir"],
    expectedArchiveManifestSha256:values["--expected-archive-manifest-sha256"],
    timestampEvidencePath:values["--timestamp-evidence"],
    expectedTimestampEvidenceSha256:values["--expected-timestamp-evidence-sha256"],
    providerReceiptPath:values["--provider-receipt"],
    controllerPublicKey:readPublicKey(values["--controller-public-key-file"]),
    storageTargetId:values["--storage-target-id"],
    expectedEvidenceSha256:values["--expected-evidence-sha256"],
    minRetentionUntil:values["--min-retention-until"],
    now:clock()
  });
  return {
    ok:true,
    code:"RETENTION_EVIDENCE_VALID",
    checkpointSha256:manifest.checkpointSha256,
    providerReceiptSha256:manifest.providerReceiptSha256,
    providerRetentionUntil:manifest.providerRetentionUntil,
    retentionMode:manifest.retentionMode
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runRetentionEvidenceCli(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({
      ok:false,
      code:error instanceof RetentionEvidenceError
        ? error.code
        : "RETENTION_EVIDENCE_OPERATION_FAILED"
    }));
    process.exitCode=1;
  }
}
