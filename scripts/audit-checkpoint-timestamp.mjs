import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { readCheckpointFile } from "./audit-checkpoint.mjs";
import {
  encodeAuditCheckpointArchive, parseAuditCheckpointArchive
} from "./audit-checkpoint-archive.mjs";

const RECEIPT_SCOPE = "RFC3161_ARCHIVE_TIMESTAMP";
const HASH = /^[a-f0-9]{64}$/;
const OID = /^[0-9]+(?:\.[0-9]+)+$/;
const MAX_MANIFEST = 8192;
const MAX_REQUEST = 65536;
const MAX_RESPONSE = 262144;
const MAX_TRUST = 262144;
const MAX_RECEIPT = 8192;
const MAX_DELAY_MS = 7 * 24 * 60 * 60_000;
const MAX_SKEW_MS = 60 * 60_000;

class TrustedTimestampError extends Error {
  constructor(code) {
    super("Audit trusted timestamp operation did not complete safely.");
    this.code = code;
  }
}
function fail(code = "TRUSTED_TIMESTAMP_INPUT_INVALID") { throw new TrustedTimestampError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function strictIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail();
  return value;
}
function positiveInteger(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}
function secureDirectory(path, unsafeCode = "TRUSTED_TIMESTAMP_DIRECTORY_UNSAFE") {
  if (typeof path !== "string" || !isAbsolute(path) || path === "/" || path.includes("\0")) fail();
  let stat;
  try { stat = lstatSync(path); } catch { fail("TRUSTED_TIMESTAMP_DIRECTORY_INVALID"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o002) !== 0) fail(unsafeCode);
  return path;
}
function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isDirectory()) fail("TRUSTED_TIMESTAMP_DIRECTORY_INVALID");
    fsyncSync(fd);
  } finally { closeSync(fd); }
}
function writeNoReplace(path, bytes, mode = 0o600) {
  secureDirectory(dirname(path));
  let fd;
  try {
    fd = openSync(path, "wx", mode);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } catch (error) {
    fail(error?.code === "EEXIST" ? "TRUSTED_TIMESTAMP_OUTPUT_EXISTS" : "TRUSTED_TIMESTAMP_WRITE_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  fsyncDirectory(dirname(path));
  return digest(bytes);
}
function writeTemp(path, bytes, mode = 0o600) {
  const fd = openSync(path, "wx", mode);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}
function withTempDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), "hrbp-rfc3161-"));
  chmodSync(directory, 0o700);
  try { return callback(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
function openssl(args, code) {
  const result = spawnSync("openssl", args, {
    shell: false,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/nonexistent",
      LC_ALL: "C",
      LANG: "C"
    }
  });
  if (result.error || result.status !== 0) fail(code);
  return result.stdout;
}
function requireOpenSsl3() {
  const output = openssl(["version"], "TRUSTED_TIMESTAMP_OPENSSL_UNAVAILABLE");
  const match = /^OpenSSL\s+([0-9]+)\./.exec(output);
  if (!match || Number(match[1]) < 3) fail("TRUSTED_TIMESTAMP_OPENSSL_UNSUPPORTED");
}
function readArchiveManifest(directory) {
  secureDirectory(directory);
  const bytes = readCheckpointFile(join(directory, "archive-manifest.json"), { maxBytes: MAX_MANIFEST });
  const parsed = parseAuditCheckpointArchive(bytes.toString("utf8"));
  const canonical = Buffer.from(encodeAuditCheckpointArchive(parsed));
  if (!bytes.equals(canonical)) fail("TRUSTED_TIMESTAMP_ARCHIVE_MANIFEST_INVALID");
  return { archive: parsed, bytes: canonical };
}
function responseMetadata(text) {
  const policy = /^Policy OID:\s*(\S+)\s*$/m.exec(text)?.[1];
  const timestampText = /^Time stamp:\s*(.+?)\s*$/m.exec(text)?.[1];
  const serialNumber = /^Serial number:\s*(\S+)\s*$/m.exec(text)?.[1];
  if (!policy || !OID.test(policy) || !timestampText || !serialNumber ||
      serialNumber.length > 256 || !/^[A-Za-z0-9xX:+-]+$/.test(serialNumber)) {
    fail("TRUSTED_TIMESTAMP_RESPONSE_METADATA_INVALID");
  }
  const timestampMs = Date.parse(timestampText);
  if (!Number.isFinite(timestampMs)) fail("TRUSTED_TIMESTAMP_RESPONSE_TIME_INVALID");
  return {
    policyOid: policy,
    serialNumber,
    timestamp: new Date(timestampMs).toISOString()
  };
}
function receiptOf(value) {
  exactKeys(value, [
    "version", "scope", "archiveManifestSha256", "requestSha256", "responseSha256",
    "tsaTrustAnchorSha256", "tsaUntrustedChainSha256", "policyOid", "serialNumber",
    "timestamp", "verifiedAt"
  ]);
  if (value.version !== 1 || value.scope !== RECEIPT_SCOPE ||
      typeof value.archiveManifestSha256 !== "string" || !HASH.test(value.archiveManifestSha256) ||
      typeof value.requestSha256 !== "string" || !HASH.test(value.requestSha256) ||
      typeof value.responseSha256 !== "string" || !HASH.test(value.responseSha256) ||
      typeof value.tsaTrustAnchorSha256 !== "string" || !HASH.test(value.tsaTrustAnchorSha256) ||
      (value.tsaUntrustedChainSha256 !== null &&
        (typeof value.tsaUntrustedChainSha256 !== "string" || !HASH.test(value.tsaUntrustedChainSha256))) ||
      typeof value.policyOid !== "string" || !OID.test(value.policyOid) ||
      typeof value.serialNumber !== "string" || value.serialNumber.length < 1 ||
      value.serialNumber.length > 256 || !/^[A-Za-z0-9xX:+-]+$/.test(value.serialNumber)) fail();
  const timestamp = strictIso(value.timestamp);
  const verifiedAt = strictIso(value.verifiedAt);
  return {
    version: 1,
    scope: RECEIPT_SCOPE,
    archiveManifestSha256: value.archiveManifestSha256,
    requestSha256: value.requestSha256,
    responseSha256: value.responseSha256,
    tsaTrustAnchorSha256: value.tsaTrustAnchorSha256,
    tsaUntrustedChainSha256: value.tsaUntrustedChainSha256,
    policyOid: value.policyOid,
    serialNumber: value.serialNumber,
    timestamp,
    verifiedAt
  };
}
export function encodeTrustedTimestampReceipt(value) {
  return JSON.stringify(receiptOf(value)) + "\n";
}
export function parseTrustedTimestampReceipt(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_RECEIPT) fail();
  let value;
  try { value = receiptOf(JSON.parse(text)); } catch { fail(); }
  if (text !== encodeTrustedTimestampReceipt(value)) fail();
  return value;
}

export function createArchiveTimestampRequest(archiveDirectory, outputPath) {
  if (typeof outputPath !== "string" || !isAbsolute(outputPath) || outputPath.includes("\0")) fail();
  requireOpenSsl3();
  const { bytes } = readArchiveManifest(archiveDirectory);
  return withTempDirectory(directory => {
    const manifestPath = join(directory, "archive-manifest.json");
    const requestPath = join(directory, "request.tsq");
    writeTemp(manifestPath, bytes);
    openssl([
      "ts", "-query", "-data", manifestPath, "-sha256", "-cert", "-out", requestPath
    ], "TRUSTED_TIMESTAMP_REQUEST_FAILED");
    const request = readFileSync(requestPath);
    if (request.length < 1 || request.length > MAX_REQUEST) fail("TRUSTED_TIMESTAMP_REQUEST_INVALID");
    const requestSha256 = writeNoReplace(outputPath, request);
    return {
      ok: true,
      code: "TRUSTED_TIMESTAMP_REQUEST_CREATED",
      archiveManifestSha256: digest(bytes),
      requestSha256
    };
  });
}

export function verifyArchiveTrustedTimestamp({
  archiveDirectory,
  requestBytes,
  responseBytes,
  trustAnchorBytes,
  untrustedChainBytes = null,
  expectedTrustAnchorSha256,
  expectedPolicyOid,
  maxTimestampDelayMs,
  maxClockSkewMs,
  now = Date.now()
}) {
  requireOpenSsl3();
  if (!Buffer.isBuffer(requestBytes) || requestBytes.length < 1 || requestBytes.length > MAX_REQUEST ||
      !Buffer.isBuffer(responseBytes) || responseBytes.length < 1 || responseBytes.length > MAX_RESPONSE ||
      !Buffer.isBuffer(trustAnchorBytes) || trustAnchorBytes.length < 1 || trustAnchorBytes.length > MAX_TRUST ||
      (untrustedChainBytes !== null &&
        (!Buffer.isBuffer(untrustedChainBytes) || untrustedChainBytes.length < 1 ||
          untrustedChainBytes.length > MAX_TRUST)) ||
      typeof expectedTrustAnchorSha256 !== "string" || !HASH.test(expectedTrustAnchorSha256) ||
      typeof expectedPolicyOid !== "string" || !OID.test(expectedPolicyOid) ||
      !Number.isSafeInteger(now) || now < 0) fail();
  if (digest(trustAnchorBytes) !== expectedTrustAnchorSha256) {
    fail("TRUSTED_TIMESTAMP_TRUST_ANCHOR_MISMATCH");
  }
  positiveInteger(maxTimestampDelayMs, 1000, MAX_DELAY_MS);
  positiveInteger(maxClockSkewMs, 0, MAX_SKEW_MS);

  const { archive, bytes: manifestBytes } = readArchiveManifest(archiveDirectory);
  return withTempDirectory(directory => {
    const manifestPath = join(directory, "archive-manifest.json");
    const requestPath = join(directory, "request.tsq");
    const responsePath = join(directory, "response.tsr");
    const caPath = join(directory, "tsa-ca.pem");
    const untrustedPath = join(directory, "tsa-untrusted.pem");
    writeTemp(manifestPath, manifestBytes);
    writeTemp(requestPath, requestBytes);
    writeTemp(responsePath, responseBytes);
    writeTemp(caPath, trustAnchorBytes);
    if (untrustedChainBytes !== null) writeTemp(untrustedPath, untrustedChainBytes);

    const trustArgs = ["-CAfile", caPath,
      ...(untrustedChainBytes !== null ? ["-untrusted", untrustedPath] : [])];
    openssl([
      "ts", "-verify", "-queryfile", requestPath, "-in", responsePath, ...trustArgs
    ], "TRUSTED_TIMESTAMP_QUERY_VERIFY_FAILED");
    openssl([
      "ts", "-verify", "-data", manifestPath, "-in", responsePath, ...trustArgs
    ], "TRUSTED_TIMESTAMP_DATA_VERIFY_FAILED");

    const metadata = responseMetadata(openssl([
      "ts", "-reply", "-in", responsePath, "-text"
    ], "TRUSTED_TIMESTAMP_RESPONSE_PARSE_FAILED"));
    if (metadata.policyOid !== expectedPolicyOid) fail("TRUSTED_TIMESTAMP_POLICY_MISMATCH");

    const timestampMs = Date.parse(metadata.timestamp);
    const archiveExportedMs = Date.parse(archive.manifest.exportedAt);
    if (timestampMs > now + maxClockSkewMs) fail("TRUSTED_TIMESTAMP_FUTURE");
    if (timestampMs < archiveExportedMs - maxClockSkewMs) fail("TRUSTED_TIMESTAMP_BEFORE_ARCHIVE");
    if (timestampMs - archiveExportedMs > maxTimestampDelayMs + maxClockSkewMs) {
      fail("TRUSTED_TIMESTAMP_DELAY_EXCEEDED");
    }

    return receiptOf({
      version: 1,
      scope: RECEIPT_SCOPE,
      archiveManifestSha256: digest(manifestBytes),
      requestSha256: digest(requestBytes),
      responseSha256: digest(responseBytes),
      tsaTrustAnchorSha256: digest(trustAnchorBytes),
      tsaUntrustedChainSha256: untrustedChainBytes === null ? null : digest(untrustedChainBytes),
      policyOid: metadata.policyOid,
      serialNumber: metadata.serialNumber,
      timestamp: metadata.timestamp,
      verifiedAt: new Date(now).toISOString()
    });
  });
}

export function publishTrustedTimestampEvidence(outputDirectory, {
  requestBytes, responseBytes, receipt
}) {
  if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory) ||
      outputDirectory === "/" || outputDirectory.includes("\0")) fail();
  secureDirectory(dirname(outputDirectory));
  try { mkdirSync(outputDirectory, { mode: 0o700 }); }
  catch { fail("TRUSTED_TIMESTAMP_OUTPUT_EXISTS"); }
  try {
    const requestSha256 = writeNoReplace(join(outputDirectory, "timestamp-request.tsq"), requestBytes);
    const responseSha256 = writeNoReplace(join(outputDirectory, "timestamp-response.tsr"), responseBytes);
    const receiptBytes = Buffer.from(encodeTrustedTimestampReceipt(receipt));
    const receiptSha256 = writeNoReplace(join(outputDirectory, "timestamp-receipt.json"), receiptBytes);
    fsyncDirectory(outputDirectory);
    fsyncDirectory(dirname(outputDirectory));
    if (requestSha256 !== receipt.requestSha256 || responseSha256 !== receipt.responseSha256) {
      fail("TRUSTED_TIMESTAMP_EVIDENCE_MISMATCH");
    }
    return { requestSha256, responseSha256, receiptSha256 };
  } catch (error) {
    if (error instanceof TrustedTimestampError) throw error;
    fail("TRUSTED_TIMESTAMP_WRITE_FAILED");
  }
}

export function verifyPublishedTrustedTimestampEvidence({
  archiveDirectory, evidenceDirectory, trustAnchorBytes, untrustedChainBytes = null,
  expectedTrustAnchorSha256, expectedPolicyOid, maxTimestampDelayMs, maxClockSkewMs,
  now = Date.now()
}) {
  secureDirectory(evidenceDirectory);
  const requestBytes = readCheckpointFile(join(evidenceDirectory, "timestamp-request.tsq"), { maxBytes: MAX_REQUEST });
  const responseBytes = readCheckpointFile(join(evidenceDirectory, "timestamp-response.tsr"), { maxBytes: MAX_RESPONSE });
  const retainedReceipt = parseTrustedTimestampReceipt(
    readCheckpointFile(join(evidenceDirectory, "timestamp-receipt.json"), { maxBytes: MAX_RECEIPT }).toString("utf8")
  );
  const currentReceipt = verifyArchiveTrustedTimestamp({
    archiveDirectory, requestBytes, responseBytes, trustAnchorBytes, untrustedChainBytes,
    expectedTrustAnchorSha256, expectedPolicyOid, maxTimestampDelayMs, maxClockSkewMs, now
  });
  for (const key of [
    "archiveManifestSha256", "requestSha256", "responseSha256", "tsaTrustAnchorSha256",
    "tsaUntrustedChainSha256", "policyOid", "serialNumber", "timestamp"
  ]) {
    if (currentReceipt[key] !== retainedReceipt[key]) fail("TRUSTED_TIMESTAMP_RECEIPT_MISMATCH");
  }
  return { ...retainedReceipt, verifiedAt: currentReceipt.verifiedAt };
}

function readTrust(path, maxBytes = MAX_TRUST) {
  return readCheckpointFile(path, { maxBytes });
}
function integerArg(value, min, max) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail();
  return parsed;
}
function flags(argv, command) {
  const common = ["--archive-dir"];
  const verify = [
    "--request", "--response", "--ca-file", "--untrusted-file", "--expected-ca-sha256",
    "--expected-policy-oid", "--max-delay-hours", "--max-clock-skew-seconds"
  ];
  const allowed = new Set([
    ...common,
    ...(command === "request" ? ["--out"] :
      command === "publish" ? [...verify, "--out-dir"] :
      [...verify, "--evidence-dir"])
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!allowed.has(flag) || Object.hasOwn(values, flag)) fail();
    const value = argv[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  return values;
}
export async function runTrustedTimestampCli(argv, clock = Date.now) {
  const [command, ...rest] = argv;
  if (!["request", "publish", "verify"].includes(command)) fail();
  const values = flags(rest, command);
  const required = ["--archive-dir", ...(command === "request" ? ["--out"] :
    command === "publish"
      ? ["--request","--response","--ca-file","--expected-ca-sha256","--expected-policy-oid",
          "--max-delay-hours","--max-clock-skew-seconds","--out-dir"]
      : ["--ca-file","--expected-ca-sha256","--expected-policy-oid","--max-delay-hours",
          "--max-clock-skew-seconds","--evidence-dir"])];
  if (required.some(flag => !values[flag])) fail();
  if (!isAbsolute(values["--archive-dir"]) ||
      (values["--out"] !== undefined && !isAbsolute(values["--out"])) ||
      (values["--out-dir"] !== undefined && !isAbsolute(values["--out-dir"])) ||
      (values["--evidence-dir"] !== undefined && !isAbsolute(values["--evidence-dir"])) ||
      !HASH.test(values["--expected-ca-sha256"]) && command !== "request" ||
      values["--expected-policy-oid"] !== undefined && !OID.test(values["--expected-policy-oid"])) fail();

  if (command === "request") return createArchiveTimestampRequest(values["--archive-dir"], values["--out"]);

  const trustAnchorBytes = readTrust(values["--ca-file"]);
  const untrustedChainBytes = values["--untrusted-file"] ? readTrust(values["--untrusted-file"]) : null;
  const policy = {
    expectedTrustAnchorSha256: values["--expected-ca-sha256"],
    expectedPolicyOid: values["--expected-policy-oid"],
    maxTimestampDelayMs: integerArg(values["--max-delay-hours"], 1, 7 * 24) * 3600_000,
    maxClockSkewMs: integerArg(values["--max-clock-skew-seconds"], 0, 3600) * 1000,
    now: clock()
  };
  if (command === "verify") {
    const receipt = verifyPublishedTrustedTimestampEvidence({
      archiveDirectory: values["--archive-dir"],
      evidenceDirectory: values["--evidence-dir"],
      trustAnchorBytes, untrustedChainBytes, ...policy
    });
    return {
      ok: true, code: "TRUSTED_TIMESTAMP_VALID",
      timestamp: receipt.timestamp, policyOid: receipt.policyOid,
      archiveManifestSha256: receipt.archiveManifestSha256,
      responseSha256: receipt.responseSha256
    };
  }
  const requestBytes = readCheckpointFile(values["--request"], { maxBytes: MAX_REQUEST });
  const responseBytes = readCheckpointFile(values["--response"], { maxBytes: MAX_RESPONSE });
  const receipt = verifyArchiveTrustedTimestamp({
    archiveDirectory: values["--archive-dir"], requestBytes, responseBytes,
    trustAnchorBytes, untrustedChainBytes, ...policy
  });
  const written = publishTrustedTimestampEvidence(values["--out-dir"], {
    requestBytes, responseBytes, receipt
  });
  return {
    ok: true, code: "TRUSTED_TIMESTAMP_EVIDENCE_PUBLISHED",
    timestamp: receipt.timestamp, policyOid: receipt.policyOid,
    archiveManifestSha256: receipt.archiveManifestSha256,
    responseSha256: written.responseSha256,
    receiptSha256: written.receiptSha256
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runTrustedTimestampCli(process.argv.slice(2)))); }
  catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof TrustedTimestampError ? error.code : "TRUSTED_TIMESTAMP_OPERATION_FAILED"
    }));
    process.exitCode = 1;
  }
}
