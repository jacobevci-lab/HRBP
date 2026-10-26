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
import {
  readTrustAuthorityChain,
  resolveTrustAuthority,
  verifyTrustAuthorityChain
} from "./audit-trust-authority-chain.mjs";

const DOMAIN = "HRBP-AUDIT-SIGNER-TRUST-INVENTORY:1\n";
const MAX_FILE = 65_536;
const MAX_KEYS = 32;
const HASH = /^[a-f0-9]{64}$/;
const GENERATION_FILE = /^inventory-([0-9]{6})\.json$/;
const STATUS = new Set(["ACTIVE", "RETIRED", "REVOKED"]);
const MAX_AGE_MS = 10 * 365 * 24 * 60 * 60_000;

class TrustInventoryError extends Error {
  constructor(code) {
    super("Audit signer trust inventory operation did not complete safely.");
    this.code = code;
  }
}
function fail(code = "TRUST_INVENTORY_INPUT_INVALID") { throw new TrustInventoryError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function keyOf(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") {
    fail("TRUST_INVENTORY_KEY_INVALID");
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
function publicKeyFromSpki(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("TRUST_INVENTORY_KEY_INVALID");
  let der;
  try {
    der = Buffer.from(value, "base64");
    if (der.toString("base64") !== value) fail("TRUST_INVENTORY_KEY_INVALID");
    return keyOf(createPublicKey({ key: der, format: "der", type: "spki" }), "public");
  } catch (error) {
    if (error instanceof TrustInventoryError) throw error;
    fail("TRUST_INVENTORY_KEY_INVALID");
  }
}
function publicKeySpki(publicKey) {
  return keyOf(publicKey, "public").export({ format: "der", type: "spki" }).toString("base64");
}
function signerEntryOf(value) {
  exactKeys(value, [
    "keyId", "publicKeySpki", "status", "validFrom", "validUntil",
    "enrolledAt", "retiredAt", "revokedAt"
  ]);
  if (typeof value.keyId !== "string" || !HASH.test(value.keyId) || !STATUS.has(value.status)) fail();
  const publicKey = publicKeyFromSpki(value.publicKeySpki);
  if (checkpointKeyId(publicKey) !== value.keyId) fail("TRUST_INVENTORY_KEY_ID_MISMATCH");
  const validFrom = strictIso(value.validFrom);
  const enrolledAt = strictIso(value.enrolledAt);
  const validUntil = value.validUntil === null ? null : strictIso(value.validUntil);
  const retiredAt = value.retiredAt === null ? null : strictIso(value.retiredAt);
  const revokedAt = value.revokedAt === null ? null : strictIso(value.revokedAt);
  if (Date.parse(enrolledAt) > Date.parse(validFrom) ||
      (validUntil !== null && Date.parse(validUntil) <= Date.parse(validFrom))) fail();
  if (value.status === "ACTIVE" && (validUntil !== null || retiredAt !== null || revokedAt !== null)) fail();
  if (value.status === "RETIRED" &&
      (validUntil === null || retiredAt === null || revokedAt !== null || validUntil !== retiredAt)) fail();
  if (value.status === "REVOKED" && revokedAt === null) fail();
  return {
    keyId: value.keyId,
    publicKeySpki: value.publicKeySpki,
    status: value.status,
    validFrom,
    validUntil,
    enrolledAt,
    retiredAt,
    revokedAt
  };
}
function manifestOf(value) {
  exactKeys(value, [
    "version", "algorithm", "authorityKeyId", "subject", "scope", "generation",
    "previousInventorySha256", "issuedAt", "signingKeys"
  ]);
  if (value.version !== 1 || value.algorithm !== "Ed25519" ||
      value.scope !== "CHECKPOINT_SIGNER_TRUST_INVENTORY" ||
      typeof value.authorityKeyId !== "string" || !HASH.test(value.authorityKeyId) ||
      typeof value.subject !== "string" || !HASH.test(value.subject)) fail();
  const gen = generation(value.generation);
  if (gen === 1 ? value.previousInventorySha256 !== null :
      typeof value.previousInventorySha256 !== "string" || !HASH.test(value.previousInventorySha256)) fail();
  const issuedAt = strictIso(value.issuedAt);
  if (!Array.isArray(value.signingKeys) || value.signingKeys.length < 1 ||
      value.signingKeys.length > MAX_KEYS) fail();
  const signingKeys = value.signingKeys.map(signerEntryOf);
  const ids = new Set(signingKeys.map(entry => entry.keyId));
  if (ids.size !== signingKeys.length) fail("TRUST_INVENTORY_DUPLICATE_KEY");
  if (signingKeys.filter(entry => entry.status === "ACTIVE").length > 1) {
    fail("TRUST_INVENTORY_MULTIPLE_ACTIVE_KEYS");
  }
  if (signingKeys.some(entry => Date.parse(entry.enrolledAt) > Date.parse(issuedAt) + 30_000 ||
      (entry.retiredAt !== null && Date.parse(entry.retiredAt) > Date.parse(issuedAt) + 30_000) ||
      (entry.revokedAt !== null && Date.parse(entry.revokedAt) > Date.parse(issuedAt) + 30_000))) fail();
  return {
    version: 1,
    algorithm: "Ed25519",
    authorityKeyId: value.authorityKeyId,
    subject: value.subject,
    scope: "CHECKPOINT_SIGNER_TRUST_INVENTORY",
    generation: gen,
    previousInventorySha256: value.previousInventorySha256,
    issuedAt,
    signingKeys
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
export function encodeSignerTrustInventory(value) {
  return JSON.stringify(envelopeOf(value)) + "\n";
}
export function parseSignerTrustInventory(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_FILE) fail();
  let value;
  try { value = envelopeOf(JSON.parse(text)); } catch { fail(); }
  if (text !== encodeSignerTrustInventory(value)) fail();
  return value;
}
function signManifest(manifest, authorityPrivateKey) {
  keyOf(authorityPrivateKey, "private");
  return {
    manifest,
    signature: sign(null, signedBytes(manifest), authorityPrivateKey).toString("base64")
  };
}
function verifyEnvelope(envelope, authorityPublicKey, context, {
  expectedSha256,
  now,
  maxAgeMs
} = {}) {
  keyOf(authorityPublicKey, "public");
  const value = envelopeOf(envelope);
  const expectedSubject = checkpointSubject(context);
  if (value.manifest.authorityKeyId !== checkpointKeyId(authorityPublicKey)) {
    fail("TRUST_INVENTORY_AUTHORITY_UNTRUSTED");
  }
  if (!verify(null, signedBytes(value.manifest), authorityPublicKey,
      Buffer.from(value.signature, "base64"))) fail("TRUST_INVENTORY_SIGNATURE_INVALID");
  if (value.manifest.subject !== expectedSubject) fail("TRUST_INVENTORY_SUBJECT_MISMATCH");
  if (expectedSha256 !== undefined) {
    if (typeof expectedSha256 !== "string" || !HASH.test(expectedSha256)) fail();
    if (digest(encodeSignerTrustInventory(value)) !== expectedSha256) {
      fail("TRUST_INVENTORY_DIGEST_MISMATCH");
    }
  }
  if (now !== undefined) {
    if (!Number.isSafeInteger(now) || now < 0) fail();
    const issued = Date.parse(value.manifest.issuedAt);
    if (issued > now + 30_000) fail("TRUST_INVENTORY_FUTURE");
    if (maxAgeMs !== undefined) {
      if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 3600_000 || maxAgeMs > MAX_AGE_MS) fail();
      if (now - issued > maxAgeMs) fail("TRUST_INVENTORY_STALE");
    }
  }
  return value;
}

export function createInitialSignerTrustInventory(authorityPrivateKey, signerPublicKey, context, now = Date.now()) {
  keyOf(authorityPrivateKey, "private");
  keyOf(signerPublicKey, "public");
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const issuedAt = new Date(now).toISOString();
  const authorityPublicKey = keyOf(createPublicKey(authorityPrivateKey), "public");
  const manifest = manifestOf({
    version: 1,
    algorithm: "Ed25519",
    authorityKeyId: checkpointKeyId(authorityPublicKey),
    subject: checkpointSubject(context),
    scope: "CHECKPOINT_SIGNER_TRUST_INVENTORY",
    generation: 1,
    previousInventorySha256: null,
    issuedAt,
    signingKeys: [{
      keyId: checkpointKeyId(signerPublicKey),
      publicKeySpki: publicKeySpki(signerPublicKey),
      status: "ACTIVE",
      validFrom: issuedAt,
      validUntil: null,
      enrolledAt: issuedAt,
      retiredAt: null,
      revokedAt: null
    }]
  });
  return signManifest(manifest, authorityPrivateKey);
}

export function rotateSignerTrustInventory(current, authorityPrivateKey, newSignerPublicKey, context, now = Date.now()) {
  keyOf(authorityPrivateKey, "private");
  keyOf(newSignerPublicKey, "public");
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const authorityPublicKey = keyOf(createPublicKey(authorityPrivateKey), "public");
  const verified = verifyEnvelope(current, authorityPublicKey, context, { now });
  const active = verified.manifest.signingKeys.filter(entry => entry.status === "ACTIVE");
  if (active.length !== 1) fail("TRUST_INVENTORY_NO_ACTIVE_SIGNER");
  const newKeyId = checkpointKeyId(newSignerPublicKey);
  if (verified.manifest.signingKeys.some(entry => entry.keyId === newKeyId)) {
    fail("TRUST_INVENTORY_KEY_ALREADY_ENROLLED");
  }
  const issuedAt = new Date(now).toISOString();
  if (Date.parse(issuedAt) < Date.parse(verified.manifest.issuedAt)) fail("TRUST_INVENTORY_CLOCK_REGRESSION");
  const signingKeys = verified.manifest.signingKeys.map(entry => entry.keyId === active[0].keyId
    ? { ...entry, status: "RETIRED", validUntil: issuedAt, retiredAt: issuedAt }
    : entry);
  signingKeys.push({
    keyId: newKeyId,
    publicKeySpki: publicKeySpki(newSignerPublicKey),
    status: "ACTIVE",
    validFrom: issuedAt,
    validUntil: null,
    enrolledAt: issuedAt,
    retiredAt: null,
    revokedAt: null
  });
  const manifest = manifestOf({
    ...verified.manifest,
    generation: verified.manifest.generation + 1,
    previousInventorySha256: digest(encodeSignerTrustInventory(verified)),
    issuedAt,
    signingKeys
  });
  return signManifest(manifest, authorityPrivateKey);
}

export function revokeSignerTrustInventory(current, authorityPrivateKey, keyId, context, now = Date.now()) {
  keyOf(authorityPrivateKey, "private");
  if (typeof keyId !== "string" || !HASH.test(keyId) || !Number.isSafeInteger(now) || now < 0) fail();
  const authorityPublicKey = keyOf(createPublicKey(authorityPrivateKey), "public");
  const verified = verifyEnvelope(current, authorityPublicKey, context, { now });
  const target = verified.manifest.signingKeys.find(entry => entry.keyId === keyId);
  if (!target) fail("TRUST_INVENTORY_KEY_NOT_FOUND");
  if (target.status === "REVOKED") fail("TRUST_INVENTORY_KEY_ALREADY_REVOKED");
  const issuedAt = new Date(now).toISOString();
  if (Date.parse(issuedAt) < Date.parse(verified.manifest.issuedAt)) fail("TRUST_INVENTORY_CLOCK_REGRESSION");
  const signingKeys = verified.manifest.signingKeys.map(entry => entry.keyId !== keyId ? entry : {
    ...entry,
    status: "REVOKED",
    validUntil: entry.validUntil ?? issuedAt,
    retiredAt: entry.retiredAt,
    revokedAt: issuedAt
  });
  const manifest = manifestOf({
    ...verified.manifest,
    generation: verified.manifest.generation + 1,
    previousInventorySha256: digest(encodeSignerTrustInventory(verified)),
    issuedAt,
    signingKeys
  });
  return signManifest(manifest, authorityPrivateKey);
}

export function rebindSignerTrustAuthority(current, newAuthorityPrivateKey, context, now = Date.now()) {
  keyOf(newAuthorityPrivateKey, "private");
  if (!Number.isSafeInteger(now) || now < 0) fail();
  const verified = envelopeOf(current);
  if (verified.manifest.subject !== checkpointSubject(context)) {
    fail("TRUST_INVENTORY_SUBJECT_MISMATCH");
  }
  const newAuthorityPublicKey = keyOf(createPublicKey(newAuthorityPrivateKey), "public");
  const newAuthorityKeyId = checkpointKeyId(newAuthorityPublicKey);
  if (newAuthorityKeyId === verified.manifest.authorityKeyId) {
    fail("TRUST_INVENTORY_AUTHORITY_ALREADY_ACTIVE");
  }
  const issuedAt = new Date(now).toISOString();
  if (Date.parse(issuedAt) < Date.parse(verified.manifest.issuedAt)) {
    fail("TRUST_INVENTORY_CLOCK_REGRESSION");
  }
  const manifest = manifestOf({
    ...verified.manifest,
    authorityKeyId: newAuthorityKeyId,
    generation: verified.manifest.generation + 1,
    previousInventorySha256: digest(encodeSignerTrustInventory(verified)),
    issuedAt,
    signingKeys: verified.manifest.signingKeys
  });
  return signManifest(manifest, newAuthorityPrivateKey);
}

function assertTrustDirectory(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory === "/" || directory.includes("\0")) fail();
  let stat;
  try { stat = lstatSync(directory); } catch { fail("TRUST_INVENTORY_DIRECTORY_INVALID"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o002) !== 0) {
    fail("TRUST_INVENTORY_DIRECTORY_UNSAFE");
  }
}
function inventoryPath(directory, gen) {
  return join(directory, `inventory-${String(generation(gen)).padStart(6, "0")}.json`);
}
export function writeSignerTrustInventoryGeneration(directory, envelope) {
  assertTrustDirectory(directory);
  const value = envelopeOf(envelope);
  const path = inventoryPath(directory, value.manifest.generation);
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, encodeSignerTrustInventory(value));
    fsyncSync(fd);
  } catch (error) {
    fail(error?.code === "EEXIST" ? "TRUST_INVENTORY_GENERATION_EXISTS" : "TRUST_INVENTORY_WRITE_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(dir).isDirectory()) fail("TRUST_INVENTORY_DIRECTORY_INVALID");
    fsyncSync(dir);
  } finally { closeSync(dir); }
  return {
    generation: value.manifest.generation,
    inventorySha256: digest(encodeSignerTrustInventory(value))
  };
}
export function readSignerTrustInventoryChain(directory) {
  assertTrustDirectory(directory);
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && GENERATION_FILE.test(entry.name))
    .map(entry => entry.name)
    .sort();
  if (!files.length) return [];
  const chain = files.map((name, index) => {
    const match = GENERATION_FILE.exec(name);
    const expectedGeneration = index + 1;
    if (!match || Number(match[1]) !== expectedGeneration) fail("TRUST_INVENTORY_GENERATION_GAP");
    return parseSignerTrustInventory(readCheckpointFile(join(directory, name), { maxBytes: MAX_FILE }).toString("utf8"));
  });
  return chain;
}

export function verifySignerTrustInventoryChain(chain, {
  authorityPublicKey, authorityChain, tenantId, deploymentId, expectedLatestSha256,
  maxAgeMs, now = Date.now()
}) {
  if (!Array.isArray(chain) || !chain.length) fail("TRUST_INVENTORY_EMPTY");
  if (typeof expectedLatestSha256 !== "string" || !HASH.test(expectedLatestSha256)) fail();
  if (Boolean(authorityPublicKey) === Boolean(authorityChain)) fail();
  const context = { tenantId, deploymentId };
  let previousSha = null;
  let latest;
  let latestAuthority;
  for (let index = 0; index < chain.length; index++) {
    const raw = envelopeOf(chain[index]);
    const authority = authorityChain
      ? resolveTrustAuthority(authorityChain, raw.manifest.issuedAt, raw.manifest.authorityKeyId)
      : authorityPublicKey;
    const current = verifyEnvelope(raw, authority, context, { now });
    if (current.manifest.generation !== index + 1 ||
        current.manifest.previousInventorySha256 !== previousSha) {
      fail("TRUST_INVENTORY_CHAIN_INVALID");
    }
    previousSha = digest(encodeSignerTrustInventory(current));
    latest = current;
    latestAuthority = authority;
  }
  verifyEnvelope(latest, latestAuthority, context, {
    expectedSha256: expectedLatestSha256,
    now,
    maxAgeMs
  });
  return {
    latest,
    latestSha256: previousSha,
    activeKeyId: latest.manifest.signingKeys.find(entry => entry.status === "ACTIVE")?.keyId ?? null
  };
}

export function resolveCheckpointSigner(inventory, { keyId, issuedAt }) {
  const value = envelopeOf(inventory);
  if (typeof keyId !== "string" || !HASH.test(keyId)) fail();
  strictIso(issuedAt);
  const entry = value.manifest.signingKeys.find(candidate => candidate.keyId === keyId);
  if (!entry) fail("TRUST_INVENTORY_SIGNER_NOT_ENROLLED");
  if (entry.status === "REVOKED") fail("TRUST_INVENTORY_SIGNER_REVOKED");
  const at = Date.parse(issuedAt);
  if (at < Date.parse(entry.validFrom) ||
      (entry.validUntil !== null && at >= Date.parse(entry.validUntil))) {
    fail("TRUST_INVENTORY_SIGNER_OUTSIDE_VALIDITY");
  }
  return publicKeyFromSpki(entry.publicKeySpki);
}

function readPublicKey(path) {
  const pem = readCheckpointFile(path, { maxBytes: 16_384 });
  if (!pem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) fail("TRUST_INVENTORY_KEY_INVALID");
  return keyOf(createPublicKey(pem), "public");
}
function readPrivateKey(path) {
  const pem = readCheckpointFile(path, { privateKey: true, maxBytes: 16_384 });
  try { return keyOf(createPrivateKey(pem), "private"); }
  finally { pem.fill(0); }
}
function authorityChainFlagNames() {
  return [
    "--authority-chain-dir",
    "--bootstrap-authority-public-key-file",
    "--expected-authority-chain-sha256",
    "--authority-chain-max-age-hours"
  ];
}
function parseFlags(argv, command) {
  const chainFlags = authorityChainFlagNames();
  const allowed = new Set([
    "--tenant-id", "--deployment-id", "--inventory-dir",
    ...(command === "verify"
      ? ["--authority-public-key-file", "--expected-latest-sha256", "--max-age-hours", ...chainFlags]
      : ["--authority-private-key-file", "--expected-current-sha256", "--acknowledge-separate-trust-authority",
          ...(command === "init" ? [] : chainFlags)]),
    ...(command === "init" || command === "rotate" ? ["--signer-public-key-file"] : []),
    ...(command === "revoke" ? ["--key-id"] : [])
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) fail();
    if (flag === "--acknowledge-separate-trust-authority") { values[flag] = true; continue; }
    const value = argv[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  return values;
}
function maxAge(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value)) fail();
  const hours = Number(value);
  const ms = hours * 3600_000;
  if (!Number.isSafeInteger(ms) || ms < 3600_000 || ms > MAX_AGE_MS) fail();
  return ms;
}
function governedAuthorityFlags(values) {
  const flags = authorityChainFlagNames();
  const some = flags.some(flag => Boolean(values[flag]));
  const all = flags.every(flag => Boolean(values[flag]));
  if (some && !all) fail();
  return all;
}
export function signerTrustInventoryArgs(argv) {
  const [command, ...rest] = argv;
  if (!["init", "rotate", "revoke", "verify", "adopt-authority"].includes(command)) fail();
  const values = parseFlags(rest, command);
  const governed = governedAuthorityFlags(values);
  const required = ["--tenant-id", "--deployment-id", "--inventory-dir",
    ...(command === "verify"
      ? ["--expected-latest-sha256", "--max-age-hours"]
      : ["--authority-private-key-file", "--acknowledge-separate-trust-authority"]),
    ...(command === "init" || command === "rotate" ? ["--signer-public-key-file"] : []),
    ...(command === "rotate" || command === "revoke" || command === "adopt-authority"
      ? ["--expected-current-sha256"] : []),
    ...(command === "revoke" ? ["--key-id"] : [])];
  if (required.some(flag => !values[flag])) fail();
  if (command === "verify") {
    if (Boolean(values["--authority-public-key-file"]) === governed) fail();
  } else if (command === "init") {
    if (governed) fail();
  } else if (command === "adopt-authority") {
    if (!governed) fail();
  }
  const context = { tenantId: values["--tenant-id"], deploymentId: values["--deployment-id"] };
  checkpointSubject(context);
  if (!isAbsolute(values["--inventory-dir"])) fail();
  if (values["--authority-chain-dir"] !== undefined && !isAbsolute(values["--authority-chain-dir"])) fail();
  for (const flag of ["--expected-current-sha256", "--expected-latest-sha256", "--expected-authority-chain-sha256"]) {
    if (values[flag] !== undefined && !HASH.test(values[flag])) fail();
  }
  if (values["--key-id"] !== undefined && !HASH.test(values["--key-id"])) fail();
  return {
    command,
    values,
    context,
    governed,
    maxAgeMs: command === "verify" ? maxAge(values["--max-age-hours"]) : null,
    authorityChainMaxAgeMs: governed ? maxAge(values["--authority-chain-max-age-hours"]) : null
  };
}
function loadGovernedAuthorityChain(parsed, now) {
  if (!parsed.governed) return null;
  return verifyTrustAuthorityChain(
    readTrustAuthorityChain(parsed.values["--authority-chain-dir"]),
    {
      ...parsed.context,
      bootstrapAuthorityPublicKey: readPublicKey(parsed.values["--bootstrap-authority-public-key-file"]),
      expectedLatestSha256: parsed.values["--expected-authority-chain-sha256"],
      maxAgeMs: parsed.authorityChainMaxAgeMs,
      now
    }
  );
}

export async function runSignerTrustInventoryCli(argv, clock = Date.now) {
  const parsed = signerTrustInventoryArgs(argv);
  const directory = parsed.values["--inventory-dir"];
  const now = clock();
  const governedAuthorityChain = loadGovernedAuthorityChain(parsed, now);

  if (parsed.command === "verify") {
    const result = verifySignerTrustInventoryChain(readSignerTrustInventoryChain(directory), {
      ...parsed.context,
      ...(governedAuthorityChain
        ? { authorityChain: governedAuthorityChain }
        : { authorityPublicKey: readPublicKey(parsed.values["--authority-public-key-file"]) }),
      expectedLatestSha256: parsed.values["--expected-latest-sha256"],
      maxAgeMs: parsed.maxAgeMs,
      now
    });
    return {
      ok: true,
      code: "TRUST_INVENTORY_VALID",
      generation: result.latest.manifest.generation,
      latestSha256: result.latestSha256,
      activeKeyId: result.activeKeyId,
      ...(governedAuthorityChain ? {
        authorityChainGeneration: governedAuthorityChain.latest.payload.generation,
        authorityChainSha256: governedAuthorityChain.latestSha256
      } : {})
    };
  }

  const authorityPrivateKey = readPrivateKey(parsed.values["--authority-private-key-file"]);
  const authorityPublicKey = keyOf(createPublicKey(authorityPrivateKey), "public");
  const chain = readSignerTrustInventoryChain(directory);
  let next;

  if (parsed.command === "init") {
    if (chain.length) fail("TRUST_INVENTORY_ALREADY_INITIALIZED");
    next = createInitialSignerTrustInventory(
      authorityPrivateKey,
      readPublicKey(parsed.values["--signer-public-key-file"]),
      parsed.context,
      now
    );
  } else {
    if (!chain.length) fail("TRUST_INVENTORY_EMPTY");
    const current = verifySignerTrustInventoryChain(chain, {
      ...parsed.context,
      ...(governedAuthorityChain
        ? { authorityChain: governedAuthorityChain }
        : { authorityPublicKey }),
      expectedLatestSha256: parsed.values["--expected-current-sha256"],
      now
    }).latest;

    if (governedAuthorityChain &&
        checkpointKeyId(authorityPublicKey) !== governedAuthorityChain.latest.payload.authorityKeyId) {
      fail("TRUST_INVENTORY_AUTHORITY_NOT_CURRENT");
    }

    if (parsed.command === "rotate") {
      next = rotateSignerTrustInventory(
        current,
        authorityPrivateKey,
        readPublicKey(parsed.values["--signer-public-key-file"]),
        parsed.context,
        now
      );
    } else if (parsed.command === "revoke") {
      next = revokeSignerTrustInventory(
        current,
        authorityPrivateKey,
        parsed.values["--key-id"],
        parsed.context,
        now
      );
    } else {
      if (!governedAuthorityChain) fail();
      next = rebindSignerTrustAuthority(
        current,
        authorityPrivateKey,
        parsed.context,
        now
      );
      if (next.manifest.authorityKeyId !== governedAuthorityChain.latest.payload.authorityKeyId ||
          Date.parse(next.manifest.issuedAt) < Date.parse(governedAuthorityChain.latest.payload.effectiveAt)) {
        fail("TRUST_INVENTORY_AUTHORITY_NOT_CURRENT");
      }
    }
  }

  const written = writeSignerTrustInventoryGeneration(directory, next);
  return {
    ok: true,
    code: parsed.command === "init" ? "TRUST_INVENTORY_INITIALIZED" :
      parsed.command === "rotate" ? "TRUST_INVENTORY_ROTATED" :
      parsed.command === "revoke" ? "TRUST_INVENTORY_REVOKED" : "TRUST_INVENTORY_AUTHORITY_ADOPTED",
    generation: written.generation,
    latestSha256: written.inventorySha256,
    activeKeyId: next.manifest.signingKeys.find(entry => entry.status === "ACTIVE")?.keyId ?? null,
    ...(governedAuthorityChain ? {
      authorityChainGeneration: governedAuthorityChain.latest.payload.generation,
      authorityChainSha256: governedAuthorityChain.latestSha256
    } : {})
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runSignerTrustInventoryCli(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof TrustInventoryError ? error.code : "TRUST_INVENTORY_OPERATION_FAILED"
    }));
    process.exitCode = 1;
  }
}
