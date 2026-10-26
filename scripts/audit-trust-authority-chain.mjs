import {
  createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify
} from "node:crypto";
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync,
  readdirSync, writeFileSync
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkpointKeyId, checkpointSubject, readCheckpointFile
} from "./audit-checkpoint.mjs";

const DOMAIN = "HRBP-AUDIT-TRUST-AUTHORITY-CHAIN:1\n";
const MAX_FILE = 32_768;
const HASH = /^[a-f0-9]{64}$/;
const FILE = /^authority-([0-9]{6})\.json$/;
const MODES = new Set(["BOOTSTRAP", "ROTATION", "RECOVERY"]);
const MAX_AGE_MS = 10 * 365 * 24 * 60 * 60_000;

class AuthorityChainError extends Error {
  constructor(code) {
    super("Audit trust authority chain operation did not complete safely.");
    this.code = code;
  }
}
function fail(code = "AUTHORITY_CHAIN_INPUT_INVALID") { throw new AuthorityChainError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function keyOf(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") {
    fail("AUTHORITY_CHAIN_KEY_INVALID");
  }
  return key;
}
function strictIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail();
  return value;
}
function generation(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 999999) fail();
  return value;
}
function publicKeySpki(key) {
  return keyOf(key, "public").export({ format: "der", type: "spki" }).toString("base64");
}
function publicKeyFromSpki(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("AUTHORITY_CHAIN_KEY_INVALID");
  try {
    const der = Buffer.from(value, "base64");
    if (der.toString("base64") !== value) fail("AUTHORITY_CHAIN_KEY_INVALID");
    return keyOf(createPublicKey({ key: der, format: "der", type: "spki" }), "public");
  } catch (error) {
    if (error instanceof AuthorityChainError) throw error;
    fail("AUTHORITY_CHAIN_KEY_INVALID");
  }
}
function signature(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value) ||
      Buffer.from(value, "base64").toString("base64") !== value) fail();
  return value;
}
function payloadOf(value) {
  exactKeys(value, [
    "version", "algorithm", "subject", "scope", "generation",
    "previousRecordSha256", "previousAuthorityKeyId",
    "authorityKeyId", "authorityPublicKeySpki",
    "recoveryKeyId", "recoveryPublicKeySpki",
    "transitionMode", "effectiveAt", "issuedAt"
  ]);
  if (value.version !== 1 || value.algorithm !== "Ed25519" ||
      value.scope !== "TRUST_AUTHORITY_CHAIN" ||
      typeof value.subject !== "string" || !HASH.test(value.subject) ||
      !MODES.has(value.transitionMode)) fail();
  const gen = generation(value.generation);
  if (gen === 1) {
    if (value.previousRecordSha256 !== null || value.previousAuthorityKeyId !== null ||
        value.transitionMode !== "BOOTSTRAP") fail();
  } else {
    if (typeof value.previousRecordSha256 !== "string" || !HASH.test(value.previousRecordSha256) ||
        typeof value.previousAuthorityKeyId !== "string" || !HASH.test(value.previousAuthorityKeyId) ||
        value.transitionMode === "BOOTSTRAP") fail();
  }
  if (typeof value.authorityKeyId !== "string" || !HASH.test(value.authorityKeyId) ||
      typeof value.recoveryKeyId !== "string" || !HASH.test(value.recoveryKeyId)) fail();
  const authority = publicKeyFromSpki(value.authorityPublicKeySpki);
  const recovery = publicKeyFromSpki(value.recoveryPublicKeySpki);
  if (checkpointKeyId(authority) !== value.authorityKeyId ||
      checkpointKeyId(recovery) !== value.recoveryKeyId ||
      value.authorityKeyId === value.recoveryKeyId) fail("AUTHORITY_CHAIN_KEY_ID_MISMATCH");
  const effectiveAt = strictIso(value.effectiveAt);
  const issuedAt = strictIso(value.issuedAt);
  if (Date.parse(effectiveAt) > Date.parse(issuedAt) + 30_000) fail();
  return {
    version: 1,
    algorithm: "Ed25519",
    subject: value.subject,
    scope: "TRUST_AUTHORITY_CHAIN",
    generation: gen,
    previousRecordSha256: value.previousRecordSha256,
    previousAuthorityKeyId: value.previousAuthorityKeyId,
    authorityKeyId: value.authorityKeyId,
    authorityPublicKeySpki: value.authorityPublicKeySpki,
    recoveryKeyId: value.recoveryKeyId,
    recoveryPublicKeySpki: value.recoveryPublicKeySpki,
    transitionMode: value.transitionMode,
    effectiveAt,
    issuedAt
  };
}
function signaturesOf(value, mode) {
  exactKeys(value, ["authority", "previousAuthority", "recovery"]);
  const result = {
    authority: signature(value.authority),
    previousAuthority: signature(value.previousAuthority, true),
    recovery: signature(value.recovery, true)
  };
  if (mode === "BOOTSTRAP" && (result.previousAuthority !== null || result.recovery !== null)) fail();
  if (mode === "ROTATION" && (result.previousAuthority === null || result.recovery !== null)) fail();
  if (mode === "RECOVERY" && (result.previousAuthority !== null || result.recovery === null)) fail();
  return result;
}
function envelopeOf(value) {
  exactKeys(value, ["payload", "signatures"]);
  const payload = payloadOf(value.payload);
  const signatures = signaturesOf(value.signatures, payload.transitionMode);
  return { payload, signatures };
}
function signedBytes(payload) { return Buffer.from(DOMAIN + JSON.stringify(payload)); }
export function encodeTrustAuthorityRecord(value) {
  return JSON.stringify(envelopeOf(value)) + "\n";
}
export function parseTrustAuthorityRecord(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_FILE) fail();
  let value;
  try { value = envelopeOf(JSON.parse(text)); } catch { fail(); }
  if (text !== encodeTrustAuthorityRecord(value)) fail();
  return value;
}

export function createInitialTrustAuthorityRecord(authorityPrivateKey, recoveryPublicKey, context, now = Date.now()) {
  keyOf(authorityPrivateKey, "private");
  keyOf(recoveryPublicKey, "public");
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const authorityPublicKey = keyOf(createPublicKey(authorityPrivateKey), "public");
  if (checkpointKeyId(authorityPublicKey) === checkpointKeyId(recoveryPublicKey)) {
    fail("AUTHORITY_CHAIN_RECOVERY_NOT_SEPARATE");
  }
  const at = new Date(now).toISOString();
  const payload = payloadOf({
    version: 1,
    algorithm: "Ed25519",
    subject: checkpointSubject(context),
    scope: "TRUST_AUTHORITY_CHAIN",
    generation: 1,
    previousRecordSha256: null,
    previousAuthorityKeyId: null,
    authorityKeyId: checkpointKeyId(authorityPublicKey),
    authorityPublicKeySpki: publicKeySpki(authorityPublicKey),
    recoveryKeyId: checkpointKeyId(recoveryPublicKey),
    recoveryPublicKeySpki: publicKeySpki(recoveryPublicKey),
    transitionMode: "BOOTSTRAP",
    effectiveAt: at,
    issuedAt: at
  });
  return {
    payload,
    signatures: {
      authority: sign(null, signedBytes(payload), authorityPrivateKey).toString("base64"),
      previousAuthority: null,
      recovery: null
    }
  };
}

function transitionPayload(current, nextAuthorityPublicKey, context, mode, now) {
  const previous = envelopeOf(current);
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const nextKeyId = checkpointKeyId(nextAuthorityPublicKey);
  if (nextKeyId === previous.payload.authorityKeyId ||
      nextKeyId === previous.payload.recoveryKeyId) fail("AUTHORITY_CHAIN_KEY_REUSE");
  const at = new Date(now).toISOString();
  if (Date.parse(at) < Date.parse(previous.payload.issuedAt)) fail("AUTHORITY_CHAIN_CLOCK_REGRESSION");
  return payloadOf({
    ...previous.payload,
    generation: previous.payload.generation + 1,
    previousRecordSha256: digest(encodeTrustAuthorityRecord(previous)),
    previousAuthorityKeyId: previous.payload.authorityKeyId,
    authorityKeyId: nextKeyId,
    authorityPublicKeySpki: publicKeySpki(nextAuthorityPublicKey),
    transitionMode: mode,
    effectiveAt: at,
    issuedAt: at
  });
}

export function rotateTrustAuthorityRecord(current, currentAuthorityPrivateKey, nextAuthorityPrivateKey, context, now = Date.now()) {
  keyOf(currentAuthorityPrivateKey, "private");
  keyOf(nextAuthorityPrivateKey, "private");
  const previous = envelopeOf(current);
  const currentPublic = keyOf(createPublicKey(currentAuthorityPrivateKey), "public");
  if (checkpointKeyId(currentPublic) !== previous.payload.authorityKeyId) {
    fail("AUTHORITY_CHAIN_PREVIOUS_KEY_MISMATCH");
  }
  const nextPublic = keyOf(createPublicKey(nextAuthorityPrivateKey), "public");
  const payload = transitionPayload(previous, nextPublic, context, "ROTATION", now);
  return {
    payload,
    signatures: {
      authority: sign(null, signedBytes(payload), nextAuthorityPrivateKey).toString("base64"),
      previousAuthority: sign(null, signedBytes(payload), currentAuthorityPrivateKey).toString("base64"),
      recovery: null
    }
  };
}

export function recoverTrustAuthorityRecord(current, recoveryPrivateKey, nextAuthorityPrivateKey, context, now = Date.now()) {
  keyOf(recoveryPrivateKey, "private");
  keyOf(nextAuthorityPrivateKey, "private");
  const previous = envelopeOf(current);
  const recoveryPublic = keyOf(createPublicKey(recoveryPrivateKey), "public");
  if (checkpointKeyId(recoveryPublic) !== previous.payload.recoveryKeyId) {
    fail("AUTHORITY_CHAIN_RECOVERY_KEY_MISMATCH");
  }
  const nextPublic = keyOf(createPublicKey(nextAuthorityPrivateKey), "public");
  const payload = transitionPayload(previous, nextPublic, context, "RECOVERY", now);
  return {
    payload,
    signatures: {
      authority: sign(null, signedBytes(payload), nextAuthorityPrivateKey).toString("base64"),
      previousAuthority: null,
      recovery: sign(null, signedBytes(payload), recoveryPrivateKey).toString("base64")
    }
  };
}

function verifyRecord(record, {
  expectedSubject,
  previousRecord,
  previousAuthorityPublicKey,
  recoveryPublicKey,
  bootstrapAuthorityPublicKey
}) {
  const value = envelopeOf(record);
  if (value.payload.subject !== expectedSubject) fail("AUTHORITY_CHAIN_SUBJECT_MISMATCH");
  const authorityPublicKey = publicKeyFromSpki(value.payload.authorityPublicKeySpki);
  const recordRecoveryPublicKey = publicKeyFromSpki(value.payload.recoveryPublicKeySpki);
  if (!verify(null, signedBytes(value.payload), authorityPublicKey,
      Buffer.from(value.signatures.authority, "base64"))) {
    fail("AUTHORITY_CHAIN_AUTHORITY_SIGNATURE_INVALID");
  }

  if (value.payload.generation === 1) {
    if (checkpointKeyId(bootstrapAuthorityPublicKey) !== value.payload.authorityKeyId ||
        checkpointKeyId(recordRecoveryPublicKey) !== value.payload.recoveryKeyId) {
      fail("AUTHORITY_CHAIN_BOOTSTRAP_MISMATCH");
    }
    return { value, authorityPublicKey, recoveryPublicKey: recordRecoveryPublicKey };
  }

  if (!previousRecord || !previousAuthorityPublicKey || !recoveryPublicKey) fail();
  if (value.payload.previousRecordSha256 !== digest(encodeTrustAuthorityRecord(previousRecord)) ||
      value.payload.previousAuthorityKeyId !== checkpointKeyId(previousAuthorityPublicKey)) {
    fail("AUTHORITY_CHAIN_LINK_INVALID");
  }
  if (value.payload.recoveryKeyId !== checkpointKeyId(recoveryPublicKey) ||
      value.payload.recoveryPublicKeySpki !== publicKeySpki(recoveryPublicKey)) {
    fail("AUTHORITY_CHAIN_RECOVERY_CHANGED");
  }
  if (Date.parse(value.payload.effectiveAt) < Date.parse(previousRecord.payload.effectiveAt)) {
    fail("AUTHORITY_CHAIN_CLOCK_REGRESSION");
  }

  if (value.payload.transitionMode === "ROTATION") {
    if (!verify(null, signedBytes(value.payload), previousAuthorityPublicKey,
        Buffer.from(value.signatures.previousAuthority, "base64"))) {
      fail("AUTHORITY_CHAIN_PREVIOUS_SIGNATURE_INVALID");
    }
  } else if (value.payload.transitionMode === "RECOVERY") {
    if (!verify(null, signedBytes(value.payload), recoveryPublicKey,
        Buffer.from(value.signatures.recovery, "base64"))) {
      fail("AUTHORITY_CHAIN_RECOVERY_SIGNATURE_INVALID");
    }
  } else fail();
  return { value, authorityPublicKey, recoveryPublicKey };
}

export function verifyTrustAuthorityChain(chain, {
  bootstrapAuthorityPublicKey,
  tenantId,
  deploymentId,
  expectedLatestSha256,
  maxAgeMs,
  now = Date.now()
}) {
  keyOf(bootstrapAuthorityPublicKey, "public");
  if (!Array.isArray(chain) || !chain.length ||
      typeof expectedLatestSha256 !== "string" || !HASH.test(expectedLatestSha256) ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 3600_000 || maxAgeMs > MAX_AGE_MS ||
      !Number.isSafeInteger(now) || now < 0) fail();
  const expectedSubject = checkpointSubject({ tenantId, deploymentId });
  let previousRecord = null;
  let authorityPublicKey = null;
  let recoveryPublicKey = null;
  const verifiedRecords = [];
  for (let index = 0; index < chain.length; index++) {
    const record = envelopeOf(chain[index]);
    if (record.payload.generation !== index + 1) fail("AUTHORITY_CHAIN_GENERATION_GAP");
    const verified = verifyRecord(record, {
      expectedSubject,
      previousRecord,
      previousAuthorityPublicKey: authorityPublicKey,
      recoveryPublicKey,
      bootstrapAuthorityPublicKey
    });
    previousRecord = verified.value;
    authorityPublicKey = verified.authorityPublicKey;
    recoveryPublicKey = verified.recoveryPublicKey;
    verifiedRecords.push(verified.value);
  }
  const latestSha256 = digest(encodeTrustAuthorityRecord(previousRecord));
  if (latestSha256 !== expectedLatestSha256) fail("AUTHORITY_CHAIN_DIGEST_MISMATCH");
  const issuedAt = Date.parse(previousRecord.payload.issuedAt);
  if (issuedAt > now + 30_000) fail("AUTHORITY_CHAIN_FUTURE");
  if (now - issuedAt > maxAgeMs) fail("AUTHORITY_CHAIN_STALE");
  return {
    records: verifiedRecords,
    latest: previousRecord,
    latestSha256,
    latestAuthorityPublicKey: authorityPublicKey,
    recoveryPublicKey
  };
}

export function resolveTrustAuthority(authorityChain, issuedAt, expectedAuthorityKeyId) {
  strictIso(issuedAt);
  if (!authorityChain || !Array.isArray(authorityChain.records) || !authorityChain.records.length) fail();
  const at = Date.parse(issuedAt);
  let selected = null;
  for (const record of authorityChain.records) {
    if (Date.parse(record.payload.effectiveAt) <= at) selected = record;
    else break;
  }
  if (!selected) fail("AUTHORITY_CHAIN_NO_AUTHORITY_FOR_TIME");
  if (expectedAuthorityKeyId !== undefined &&
      selected.payload.authorityKeyId !== expectedAuthorityKeyId) {
    fail("AUTHORITY_CHAIN_AUTHORITY_ID_MISMATCH");
  }
  return publicKeyFromSpki(selected.payload.authorityPublicKeySpki);
}

function assertDirectory(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory === "/" || directory.includes("\0")) fail();
  let stat;
  try { stat = lstatSync(directory); } catch { fail("AUTHORITY_CHAIN_DIRECTORY_INVALID"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o002) !== 0) {
    fail("AUTHORITY_CHAIN_DIRECTORY_UNSAFE");
  }
}
function recordPath(directory, gen) {
  return join(directory, `authority-${String(generation(gen)).padStart(6, "0")}.json`);
}
export function writeTrustAuthorityRecord(directory, record) {
  assertDirectory(directory);
  const value = envelopeOf(record);
  const path = recordPath(directory, value.payload.generation);
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, encodeTrustAuthorityRecord(value));
    fsyncSync(fd);
  } catch (error) {
    fail(error?.code === "EEXIST" ? "AUTHORITY_CHAIN_RECORD_EXISTS" : "AUTHORITY_CHAIN_WRITE_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(dir); } finally { closeSync(dir); }
  return {
    generation: value.payload.generation,
    recordSha256: digest(encodeTrustAuthorityRecord(value)),
    authorityKeyId: value.payload.authorityKeyId
  };
}
export function readTrustAuthorityChain(directory) {
  assertDirectory(directory);
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && FILE.test(entry.name))
    .map(entry => entry.name)
    .sort();
  if (!files.length) return [];
  return files.map((name, index) => {
    const match = FILE.exec(name);
    if (!match || Number(match[1]) !== index + 1) fail("AUTHORITY_CHAIN_GENERATION_GAP");
    return parseTrustAuthorityRecord(
      readCheckpointFile(join(directory, name), { maxBytes: MAX_FILE }).toString("utf8")
    );
  });
}

function readPrivateKey(path) {
  const pem = readCheckpointFile(path, { privateKey: true, maxBytes: 16_384 });
  try { return keyOf(createPrivateKey(pem), "private"); }
  finally { pem.fill(0); }
}
function readPublicKey(path) {
  const pem = readCheckpointFile(path, { maxBytes: 16_384 });
  if (!pem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) fail("AUTHORITY_CHAIN_KEY_INVALID");
  return keyOf(createPublicKey(pem), "public");
}
function parseHours(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value)) fail();
  const ms = Number(value) * 3600_000;
  if (!Number.isSafeInteger(ms) || ms < 3600_000 || ms > MAX_AGE_MS) fail();
  return ms;
}
function parseFlags(args, command) {
  const allowed = new Set([
    "--tenant-id", "--deployment-id", "--chain-dir",
    ...(command === "verify"
      ? ["--bootstrap-authority-public-key-file", "--expected-latest-sha256", "--max-age-hours"]
      : ["--acknowledge-independent-authority-governance"]),
    ...(command === "init"
      ? ["--authority-private-key-file", "--recovery-public-key-file"]
      : []),
    ...(command === "rotate"
      ? ["--current-authority-private-key-file", "--next-authority-private-key-file", "--expected-current-sha256"]
      : []),
    ...(command === "recover"
      ? ["--recovery-private-key-file", "--next-authority-private-key-file", "--expected-current-sha256"]
      : [])
  ]);
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) fail();
    if (flag === "--acknowledge-independent-authority-governance") { values[flag] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  return values;
}
export function trustAuthorityArgs(argv) {
  const [command, ...rest] = argv;
  if (!["init", "rotate", "recover", "verify"].includes(command)) fail();
  const values = parseFlags(rest, command);
  const required = ["--tenant-id", "--deployment-id", "--chain-dir",
    ...(command === "verify"
      ? ["--bootstrap-authority-public-key-file", "--expected-latest-sha256", "--max-age-hours"]
      : ["--acknowledge-independent-authority-governance"]),
    ...(command === "init" ? ["--authority-private-key-file", "--recovery-public-key-file"] : []),
    ...(command === "rotate" ? ["--current-authority-private-key-file", "--next-authority-private-key-file", "--expected-current-sha256"] : []),
    ...(command === "recover" ? ["--recovery-private-key-file", "--next-authority-private-key-file", "--expected-current-sha256"] : [])
  ];
  if (required.some(flag => !values[flag])) fail();
  checkpointSubject({ tenantId: values["--tenant-id"], deploymentId: values["--deployment-id"] });
  if (!isAbsolute(values["--chain-dir"])) fail();
  if (values["--expected-current-sha256"] !== undefined && !HASH.test(values["--expected-current-sha256"])) fail();
  if (values["--expected-latest-sha256"] !== undefined && !HASH.test(values["--expected-latest-sha256"])) fail();
  return {
    command,
    values,
    context: { tenantId: values["--tenant-id"], deploymentId: values["--deployment-id"] },
    maxAgeMs: command === "verify" ? parseHours(values["--max-age-hours"]) : null
  };
}

export async function runTrustAuthorityCli(argv, clock = Date.now) {
  const parsed = trustAuthorityArgs(argv);
  const chain = readTrustAuthorityChain(parsed.values["--chain-dir"]);
  if (parsed.command === "verify") {
    const result = verifyTrustAuthorityChain(chain, {
      ...parsed.context,
      bootstrapAuthorityPublicKey: readPublicKey(parsed.values["--bootstrap-authority-public-key-file"]),
      expectedLatestSha256: parsed.values["--expected-latest-sha256"],
      maxAgeMs: parsed.maxAgeMs,
      now: clock()
    });
    return {
      ok: true,
      code: "AUTHORITY_CHAIN_VALID",
      generation: result.latest.payload.generation,
      latestSha256: result.latestSha256,
      authorityKeyId: result.latest.payload.authorityKeyId,
      recoveryKeyId: result.latest.payload.recoveryKeyId
    };
  }

  let next;
  if (parsed.command === "init") {
    if (chain.length) fail("AUTHORITY_CHAIN_ALREADY_INITIALIZED");
    next = createInitialTrustAuthorityRecord(
      readPrivateKey(parsed.values["--authority-private-key-file"]),
      readPublicKey(parsed.values["--recovery-public-key-file"]),
      parsed.context,
      clock()
    );
  } else {
    if (!chain.length) fail("AUTHORITY_CHAIN_EMPTY");
    const current = chain.at(-1);
    const currentSha = digest(encodeTrustAuthorityRecord(current));
    if (currentSha !== parsed.values["--expected-current-sha256"]) {
      fail("AUTHORITY_CHAIN_DIGEST_MISMATCH");
    }
    next = parsed.command === "rotate"
      ? rotateTrustAuthorityRecord(
          current,
          readPrivateKey(parsed.values["--current-authority-private-key-file"]),
          readPrivateKey(parsed.values["--next-authority-private-key-file"]),
          parsed.context,
          clock()
        )
      : recoverTrustAuthorityRecord(
          current,
          readPrivateKey(parsed.values["--recovery-private-key-file"]),
          readPrivateKey(parsed.values["--next-authority-private-key-file"]),
          parsed.context,
          clock()
        );
  }
  const written = writeTrustAuthorityRecord(parsed.values["--chain-dir"], next);
  return {
    ok: true,
    code: parsed.command === "init" ? "AUTHORITY_CHAIN_INITIALIZED" :
      parsed.command === "rotate" ? "AUTHORITY_CHAIN_ROTATED" : "AUTHORITY_CHAIN_RECOVERED",
    generation: written.generation,
    latestSha256: written.recordSha256,
    authorityKeyId: written.authorityKeyId
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runTrustAuthorityCli(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof AuthorityChainError ? error.code : "AUTHORITY_CHAIN_OPERATION_FAILED"
    }));
    process.exitCode = 1;
  }
}
