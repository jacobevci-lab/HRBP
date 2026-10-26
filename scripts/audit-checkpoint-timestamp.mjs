import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, openSync,
  readFileSync, unlinkSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  parseAuditCheckpoint,
  readCheckpointFile
} from "./audit-checkpoint.mjs";

const MAX_CHECKPOINT = 4096;
const MAX_QUERY = 64 * 1024;
const MAX_RESPONSE = 256 * 1024;
const MAX_CA_FILE = 512 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const MAX_STDIO = 1024 * 1024;
const EVIDENCE_SCOPE = "RFC3161_CHECKPOINT_TIMESTAMP_VERIFICATION";

class TimestampError extends Error {
  constructor(code) {
    super("Audit checkpoint timestamp operation did not complete safely.");
    this.code = code;
  }
}
function fail(code = "TIMESTAMP_INPUT_INVALID") { throw new TimestampError(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function safeFile(path, maxBytes) {
  const buffer = readCheckpointFile(path, { maxBytes });
  if (!buffer.length) fail("TIMESTAMP_FILE_INVALID");
  return buffer;
}
function writeNoReplace(path, bytes) {
  if (typeof path !== "string" || !path || path.includes("\0")) fail();
  const directory = dirname(path);
  const temporary = join(directory, `.hrbp-timestamp-${randomUUID()}.tmp`);
  let fd, created = false;
  try {
    fd = openSync(temporary, "wx", 0o600); created = true;
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    linkSync(temporary, path);
    unlinkSync(temporary); created = false;
    const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(dir).isDirectory()) fail("TIMESTAMP_OUTPUT_INVALID");
      fsyncSync(dir);
    } finally { closeSync(dir); }
  } catch (error) {
    if (error instanceof TimestampError) throw error;
    fail(error?.code === "EEXIST" ? "TIMESTAMP_OUTPUT_EXISTS" : "TIMESTAMP_OUTPUT_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (created) {
      try { unlinkSync(temporary); } catch {}
    }
  }
  return digest(bytes);
}
function openssl(args) {
  const result = spawnSync("openssl", args, {
    encoding: null,
    maxBuffer: MAX_STDIO,
    env: { ...process.env, LANG: "C", LC_ALL: "C" }
  });
  if (result.error) fail("TIMESTAMP_OPENSSL_UNAVAILABLE");
  if (result.status !== 0) fail("TIMESTAMP_OPENSSL_VERIFY_FAILED");
  return {
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ""),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? "")
  };
}
function checkpointBytes(path) {
  const bytes = safeFile(path, MAX_CHECKPOINT);
  parseAuditCheckpoint(bytes.toString("utf8"));
  return bytes;
}
function parseReplyText(text) {
  if (typeof text !== "string" || text.length > 200_000) fail("TIMESTAMP_RESPONSE_INVALID");
  const status = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const policyOid = text.match(/^Policy OID:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const timestampRaw = text.match(/^Time stamp:\s*(.+)$/m)?.[1]?.trim() ?? null;
  if (!status || !/Granted/i.test(status) || !timestampRaw || !policyOid) {
    fail("TIMESTAMP_RESPONSE_INVALID");
  }
  const timestampMs = Date.parse(timestampRaw);
  if (!Number.isFinite(timestampMs)) fail("TIMESTAMP_RESPONSE_INVALID");
  return {
    status,
    policyOid,
    timestampAt: new Date(timestampMs).toISOString()
  };
}

export function createTimestampQuery(checkpointPath) {
  checkpointBytes(checkpointPath);
  const result = openssl([
    "ts", "-query",
    "-data", checkpointPath,
    "-sha256",
    "-cert"
  ]);
  if (!result.stdout.length || result.stdout.length > MAX_QUERY) fail("TIMESTAMP_QUERY_INVALID");
  return result.stdout;
}

export function verifyTimestampResponse({
  checkpointPath,
  responsePath,
  caFile,
  untrustedChainFile,
  now = Date.now(),
  maxFutureSeconds = 30
}) {
  const checkpoint = checkpointBytes(checkpointPath);
  const response = safeFile(responsePath, MAX_RESPONSE);
  const ca = safeFile(caFile, MAX_CA_FILE);
  if (untrustedChainFile !== undefined) safeFile(untrustedChainFile, MAX_CA_FILE);
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(maxFutureSeconds) || maxFutureSeconds < 0 || maxFutureSeconds > 300) fail();

  const verifyArgs = [
    "ts", "-verify",
    "-in", responsePath,
    "-data", checkpointPath,
    "-CAfile", caFile
  ];
  if (untrustedChainFile !== undefined) {
    verifyArgs.push("-untrusted", untrustedChainFile);
  }
  openssl(verifyArgs);

  const reply = openssl(["ts", "-reply", "-in", responsePath, "-text"]);
  const parsed = parseReplyText(reply.stdout.toString("utf8"));
  const timestampMs = Date.parse(parsed.timestampAt);
  if (timestampMs > now + maxFutureSeconds * 1000) fail("TIMESTAMP_FUTURE");

  return {
    version: 1,
    scope: EVIDENCE_SCOPE,
    algorithm: "SHA256",
    checkpointSha256: digest(checkpoint),
    timestampResponseSha256: digest(response),
    trustStoreSha256: digest(ca),
    policyOid: parsed.policyOid,
    timestampAt: parsed.timestampAt,
    verifiedAt: new Date(now).toISOString()
  };
}

export function encodeTimestampEvidence(value) {
  const keys = [
    "version","scope","algorithm","checkpointSha256","timestampResponseSha256",
    "trustStoreSha256","policyOid","timestampAt","verifiedAt"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key)) ||
      value.version !== 1 || value.scope !== EVIDENCE_SCOPE || value.algorithm !== "SHA256" ||
      !HASH.test(value.checkpointSha256) || !HASH.test(value.timestampResponseSha256) ||
      !HASH.test(value.trustStoreSha256) || typeof value.policyOid !== "string" ||
      value.policyOid.length < 3 || value.policyOid.length > 128 ||
      !Number.isFinite(Date.parse(value.timestampAt)) || new Date(value.timestampAt).toISOString() !== value.timestampAt ||
      !Number.isFinite(Date.parse(value.verifiedAt)) || new Date(value.verifiedAt).toISOString() !== value.verifiedAt) fail();
  return JSON.stringify({
    version:1,scope:EVIDENCE_SCOPE,algorithm:"SHA256",
    checkpointSha256:value.checkpointSha256,
    timestampResponseSha256:value.timestampResponseSha256,
    trustStoreSha256:value.trustStoreSha256,
    policyOid:value.policyOid,
    timestampAt:value.timestampAt,
    verifiedAt:value.verifiedAt
  })+"\n";
}

function integer(value,min,max) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail();
  return parsed;
}
function flags(argv, command) {
  const allowed = new Set([
    "--checkpoint","--out",
    ...(command === "verify"
      ? ["--response","--ca-file","--untrusted-chain-file","--max-future-seconds"]
      : [])
  ]);
  const values = {};
  for (let i=0;i<argv.length;i++) {
    const flag = argv[i];
    if (!allowed.has(flag) || Object.hasOwn(values,flag)) fail();
    const value = argv[++i];
    if (!value || value.startsWith("--") || value.includes("\0")) fail();
    values[flag] = value;
  }
  return values;
}
export async function runTimestampCli(argv, clock = Date.now) {
  const [command,...rest] = argv;
  if (!["query","verify"].includes(command)) fail();
  const values = flags(rest, command);
  const required = command === "query"
    ? ["--checkpoint","--out"]
    : ["--checkpoint","--response","--ca-file","--out"];
  if (required.some(flag => !values[flag])) fail();

  if (command === "query") {
    const query = createTimestampQuery(values["--checkpoint"]);
    const querySha256 = writeNoReplace(values["--out"], query);
    return {
      ok:true,
      code:"TIMESTAMP_QUERY_CREATED",
      checkpointSha256:digest(checkpointBytes(values["--checkpoint"])),
      querySha256
    };
  }

  const evidence = verifyTimestampResponse({
    checkpointPath:values["--checkpoint"],
    responsePath:values["--response"],
    caFile:values["--ca-file"],
    untrustedChainFile:values["--untrusted-chain-file"],
    maxFutureSeconds:values["--max-future-seconds"] === undefined
      ? 30
      : integer(values["--max-future-seconds"],0,300),
    now:clock()
  });
  const evidenceSha256 = writeNoReplace(values["--out"], Buffer.from(encodeTimestampEvidence(evidence)));
  return {
    ok:true,
    code:"TIMESTAMP_RESPONSE_VALID",
    checkpointSha256:evidence.checkpointSha256,
    timestampResponseSha256:evidence.timestampResponseSha256,
    timestampAt:evidence.timestampAt,
    policyOid:evidence.policyOid,
    evidenceSha256
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runTimestampCli(process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({
      ok:false,
      code:error instanceof TimestampError ? error.code : "TIMESTAMP_OPERATION_FAILED"
    }));
    process.exitCode=1;
  }
}
