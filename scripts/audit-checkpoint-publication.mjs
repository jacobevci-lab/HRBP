import { createPrivateKey, createPublicKey, KeyObject } from "node:crypto";
import {
  closeSync, fstatSync, lstatSync, openSync, unlinkSync
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  auditHistoryOptions
} from "./audit-full-history-verification.mjs";
import {
  checkpointKeyId,
  createAuditCheckpoint,
  readCheckpointFile
} from "./audit-checkpoint.mjs";
import {
  createAuditCheckpointArchive,
  readAuditCheckpointArchiveBundle,
  verifyAuditCheckpointArchive,
  writeAuditCheckpointArchiveBundle
} from "./audit-checkpoint-archive.mjs";
import {
  readSignerTrustInventoryChain,
  resolveCheckpointSigner,
  verifySignerTrustInventoryChain
} from "./audit-signer-trust-inventory.mjs";
import {
  readTrustAuthorityChain,
  verifyTrustAuthorityChain
} from "./audit-trust-authority-chain.mjs";

const HASH = /^[a-f0-9]{64}$/;
const MAX_TRUST_AGE_MS = 10 * 365 * 24 * 60 * 60_000;
const MAX_ARCHIVE_AGE_MS = 365 * 24 * 60 * 60_000;

class PublicationError extends Error {
  constructor(code) {
    super("Independent audit checkpoint publication did not complete safely.");
    this.code = code;
  }
}
function fail(code = "CHECKPOINT_PUBLICATION_INPUT_INVALID") { throw new PublicationError(code); }
function keyOf(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") {
    fail("CHECKPOINT_PUBLICATION_KEY_INVALID");
  }
  return key;
}
function hours(value, maximumMs) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value)) fail();
  const ms = Number(value) * 3600_000;
  if (!Number.isSafeInteger(ms) || ms < 3600_000 || ms > maximumMs) fail();
  return ms;
}
function days(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,4}$/.test(value)) fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 3650) fail();
  return parsed;
}
function count(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail();
  return Number(value);
}
function safeRoot(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path === "/" || path.includes("\0")) fail();
  let stat;
  try { stat = lstatSync(path); } catch { fail("CHECKPOINT_PUBLICATION_ARCHIVE_ROOT_INVALID"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o002) !== 0) {
    fail("CHECKPOINT_PUBLICATION_ARCHIVE_ROOT_UNSAFE");
  }
  return path;
}
function safeLock(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path === "/" || path.includes("\0")) fail();
  let parent;
  try { parent = lstatSync(dirname(path)); } catch { fail("CHECKPOINT_PUBLICATION_LOCK_INVALID"); }
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o002) !== 0) {
    fail("CHECKPOINT_PUBLICATION_LOCK_UNSAFE");
  }
  return path;
}
function readPrivateKey(path) {
  const pem = readCheckpointFile(path, { privateKey: true, maxBytes: 16_384 });
  try { return keyOf(createPrivateKey(pem), "private"); }
  finally { pem.fill(0); }
}
function readPublicKey(path) {
  const pem = readCheckpointFile(path, { maxBytes: 16_384 });
  if (!pem.toString("ascii").startsWith("-----BEGIN PUBLIC KEY-----")) {
    fail("CHECKPOINT_PUBLICATION_KEY_INVALID");
  }
  return keyOf(createPublicKey(pem), "public");
}
function bundleId(checkpoint, archive) {
  const stamp = archive.manifest.exportedAt.replace(/[-:.]/g, "");
  const sequence = checkpoint.payload.sequence.padStart(7, "0");
  return `checkpoint-${stamp}-seq${sequence}-${archive.manifest.checkpointSha256.slice(0, 12)}`;
}

export function acquirePublicationLock(path) {
  safeLock(path);
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) fail("CHECKPOINT_PUBLICATION_LOCK_INVALID");
    return { path, fd };
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (error instanceof PublicationError) throw error;
    fail(error?.code === "EEXIST" ? "CHECKPOINT_PUBLICATION_LOCKED" : "CHECKPOINT_PUBLICATION_LOCK_FAILED");
  }
}
export function releasePublicationLock(lock) {
  if (!lock || typeof lock.path !== "string" || !Number.isInteger(lock.fd)) fail("CHECKPOINT_PUBLICATION_LOCK_INVALID");
  try { closeSync(lock.fd); }
  finally {
    try { unlinkSync(lock.path); }
    catch { fail("CHECKPOINT_PUBLICATION_LOCK_RELEASE_FAILED"); }
  }
}

export async function publishIndependentAuditCheckpoint({
  client,
  signerPrivateKey,
  authorityPublicKey,
  authorityChain,
  trustChain,
  expectedTrustSha256,
  trustMaxAgeMs,
  context,
  scanOptions,
  archiveRoot,
  retentionDays,
  archiveMaxAgeMs,
  clock = Date.now
}) {
  keyOf(signerPrivateKey, "private");
  if (Boolean(authorityPublicKey) === Boolean(authorityChain)) fail();
  if (authorityPublicKey) keyOf(authorityPublicKey, "public");
  safeRoot(archiveRoot);
  if (typeof expectedTrustSha256 !== "string" || !HASH.test(expectedTrustSha256) ||
      !Number.isSafeInteger(trustMaxAgeMs) || trustMaxAgeMs < 3600_000 || trustMaxAgeMs > MAX_TRUST_AGE_MS ||
      !Number.isSafeInteger(archiveMaxAgeMs) || archiveMaxAgeMs < 3600_000 || archiveMaxAgeMs > MAX_ARCHIVE_AGE_MS ||
      !Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) fail();
  const trustNow = clock();
  const trust = verifySignerTrustInventoryChain(trustChain, {
    ...context,
    ...(authorityChain ? { authorityChain } : { authorityPublicKey }),
    expectedLatestSha256: expectedTrustSha256,
    maxAgeMs: trustMaxAgeMs,
    now: trustNow
  });
  const signerPublicKey = keyOf(createPublicKey(signerPrivateKey), "public");
  const signerKeyId = checkpointKeyId(signerPublicKey);
  if (trust.activeKeyId === null) fail("CHECKPOINT_PUBLICATION_NO_ACTIVE_SIGNER");
  if (trust.activeKeyId !== signerKeyId) fail("CHECKPOINT_PUBLICATION_SIGNER_NOT_ACTIVE");

  const checkpoint = await createAuditCheckpoint(
    client, scanOptions, signerPrivateKey, context, clock
  );
  const resolvedSigner = resolveCheckpointSigner(trust.latest, {
    keyId: checkpoint.payload.keyId,
    issuedAt: checkpoint.payload.issuedAt
  });
  if (checkpointKeyId(resolvedSigner) !== signerKeyId) fail("CHECKPOINT_PUBLICATION_SIGNER_NOT_TRUSTED");

  const archive = createAuditCheckpointArchive(checkpoint, signerPrivateKey, context, {
    maxAgeMs: archiveMaxAgeMs,
    retentionDays,
    now: clock()
  });
  const id = bundleId(checkpoint, archive);
  const output = join(archiveRoot, id);
  const written = writeAuditCheckpointArchiveBundle(output, checkpoint, archive);

  const retained = readAuditCheckpointArchiveBundle(output);
  const verified = verifyAuditCheckpointArchive(retained.archive, retained.checkpoint, {
    ...context,
    publicKey: resolvedSigner,
    maxExportDelayMs: archiveMaxAgeMs,
    minRetentionUntil: archive.manifest.retentionUntil,
    now: clock()
  });
  if (verified.checkpointSha256 !== written.checkpointSha256 ||
      retained.archive.manifest.checkpointSha256 !== written.checkpointSha256) {
    fail("CHECKPOINT_PUBLICATION_READBACK_MISMATCH");
  }
  return {
    ok: true,
    code: "CHECKPOINT_PUBLICATION_COMPLETE",
    bundleId: id,
    sequence: checkpoint.payload.sequence,
    checkpointSha256: written.checkpointSha256,
    archiveManifestSha256: written.archiveManifestSha256,
    retentionUntil: archive.manifest.retentionUntil,
    trustGeneration: trust.latest.manifest.generation,
    trustInventorySha256: trust.latestSha256
  };
}

function parseArgs(argv) {
  const [command, ...args] = argv;
  if (command !== "run") fail();
  const allowed = new Set([
    "--tenant-id", "--deployment-id",
    "--signer-private-key-file",
    "--trust-inventory-dir", "--trust-authority-public-key-file",
    "--trust-authority-chain-dir", "--trust-bootstrap-authority-public-key-file",
    "--expected-trust-authority-chain-sha256", "--trust-authority-chain-max-age-hours",
    "--expected-trust-sha256", "--trust-max-age-hours",
    "--archive-root", "--retention-days", "--archive-max-age-hours",
    "--lock-file", "--max-events", "--batch-size",
    "--acknowledge-read-only-scan", "--acknowledge-external-retention-target"
  ]);
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) fail();
    if (flag.startsWith("--acknowledge-")) { values[flag] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  const required = [
    "--tenant-id", "--deployment-id", "--signer-private-key-file",
    "--trust-inventory-dir",
    "--expected-trust-sha256", "--trust-max-age-hours",
    "--archive-root", "--retention-days", "--archive-max-age-hours",
    "--lock-file", "--acknowledge-read-only-scan", "--acknowledge-external-retention-target"
  ];
  if (required.some(flag => !values[flag])) fail();
  if (!HASH.test(values["--expected-trust-sha256"])) fail();
  const chainFlags = [
    "--trust-authority-chain-dir", "--trust-bootstrap-authority-public-key-file",
    "--expected-trust-authority-chain-sha256", "--trust-authority-chain-max-age-hours"
  ];
  const chainReady = chainFlags.every(flag => Boolean(values[flag]));
  const chainPartial = chainFlags.some(flag => Boolean(values[flag]));
  const directAuthority = Boolean(values["--trust-authority-public-key-file"]);
  if (chainPartial && !chainReady || directAuthority === chainReady) fail();
  if (values["--expected-trust-authority-chain-sha256"] !== undefined &&
      !HASH.test(values["--expected-trust-authority-chain-sha256"])) fail();
  if (values["--trust-authority-chain-dir"] !== undefined &&
      !isAbsolute(values["--trust-authority-chain-dir"])) fail();
  safeRoot(values["--archive-root"]);
  safeLock(values["--lock-file"]);
  const scanOptions = auditHistoryOptions({
    tenantId: values["--tenant-id"],
    maxEvents: count(values["--max-events"], 50_000),
    batchSize: count(values["--batch-size"], 250)
  });
  return {
    values,
    context: { tenantId: values["--tenant-id"], deploymentId: values["--deployment-id"] },
    scanOptions,
    trustMaxAgeMs: hours(values["--trust-max-age-hours"], MAX_TRUST_AGE_MS),
    trustAuthorityChainMaxAgeMs: chainReady
      ? hours(values["--trust-authority-chain-max-age-hours"], MAX_TRUST_AGE_MS)
      : null,
    authorityChainMode: chainReady,
    archiveMaxAgeMs: hours(values["--archive-max-age-hours"], MAX_ARCHIVE_AGE_MS),
    retentionDays: days(values["--retention-days"])
  };
}

async function connectDatabase() {
  if (!process.env.DATABASE_URL) fail("CHECKPOINT_PUBLICATION_DATABASE_UNCONFIGURED");
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    options: "-c default_transaction_read_only=on"
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

export async function runAuditCheckpointPublicationCli(argv, {
  clock = Date.now,
  connect = connectDatabase
} = {}) {
  const parsed = parseArgs(argv);
  const signerPrivateKey = readPrivateKey(parsed.values["--signer-private-key-file"]);
  const trustChain = readSignerTrustInventoryChain(parsed.values["--trust-inventory-dir"]);
  const preflightNow = clock();
  let authorityPublicKey;
  let governedAuthorityChain = null;
  if (parsed.authorityChainMode) {
    governedAuthorityChain = verifyTrustAuthorityChain(
      readTrustAuthorityChain(parsed.values["--trust-authority-chain-dir"]),
      {
        ...parsed.context,
        bootstrapAuthorityPublicKey: readPublicKey(parsed.values["--trust-bootstrap-authority-public-key-file"]),
        expectedLatestSha256: parsed.values["--expected-trust-authority-chain-sha256"],
        maxAgeMs: parsed.trustAuthorityChainMaxAgeMs,
        now: preflightNow
      }
    );
  } else {
    authorityPublicKey = readPublicKey(parsed.values["--trust-authority-public-key-file"]);
  }

  // Trust/key validation intentionally happens before any database connection.
  const preflight = verifySignerTrustInventoryChain(trustChain, {
    ...parsed.context,
    ...(governedAuthorityChain ? { authorityChain: governedAuthorityChain } : { authorityPublicKey }),
    expectedLatestSha256: parsed.values["--expected-trust-sha256"],
    maxAgeMs: parsed.trustMaxAgeMs,
    now: preflightNow
  });
  if (preflight.activeKeyId !== checkpointKeyId(createPublicKey(signerPrivateKey))) {
    fail(preflight.activeKeyId === null
      ? "CHECKPOINT_PUBLICATION_NO_ACTIVE_SIGNER"
      : "CHECKPOINT_PUBLICATION_SIGNER_NOT_ACTIVE");
  }

  const lock = acquirePublicationLock(parsed.values["--lock-file"]);
  let client;
  try {
    client = await connect();
    return await publishIndependentAuditCheckpoint({
      client,
      signerPrivateKey,
      authorityPublicKey,
      authorityChain: governedAuthorityChain,
      trustChain,
      expectedTrustSha256: parsed.values["--expected-trust-sha256"],
      trustMaxAgeMs: parsed.trustMaxAgeMs,
      context: parsed.context,
      scanOptions: parsed.scanOptions,
      archiveRoot: parsed.values["--archive-root"],
      retentionDays: parsed.retentionDays,
      archiveMaxAgeMs: parsed.archiveMaxAgeMs,
      clock
    });
  } finally {
    if (client) await client.end().catch(() => {});
    releasePublicationLock(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runAuditCheckpointPublicationCli(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof PublicationError || typeof error?.code === "string"
        ? error.code
        : "CHECKPOINT_PUBLICATION_OPERATION_FAILED"
    }));
    process.exitCode = 1;
  }
}
