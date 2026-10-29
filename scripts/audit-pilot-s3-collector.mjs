/** Operator-only, explicitly opted-in AWS CLI v2 reader. Never imported by HRBP runtime. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readPilotBytes } from "./audit-pilot-gate-evaluator.mjs";
import { S3RetentionError, validateS3RetentionObservation } from "./audit-pilot-s3-retention.mjs";

import { S3ReadbackError, normalizeS3Readback, parseS3CollectionJson, parseS3CollectionRequest } from "./audit-pilot-s3-readback.mjs";
export { normalizeS3Readback } from "./audit-pilot-s3-readback.mjs";

const OPERATIONS = Object.freeze([
  ["bucketVersioning", "get-bucket-versioning"],
  ["objectLockConfiguration", "get-object-lock-configuration"],
  ["headObject", "head-object"],
  ["objectRetention", "get-object-retention"],
  ["legalHold", "get-object-legal-hold"]
]);
const MAX_RESPONSE = 64 * 1024;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => Buffer.from(JSON.stringify(value) + "\n");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
class CollectionError extends Error {
  constructor(code) { super("S3 evidence collection did not complete safely."); this.code = code; }
}
function requireCondition(condition, code = "COLLECTION_INPUT_INVALID") {
  if (!condition) throw new CollectionError(code);
}
/** No shared profiles, credential_process, metadata service, custom endpoints, proxies or injected loader environment. */
export function collectorChildEnvironment(source) {
  requireCondition(object(source), "COLLECTION_CREDENTIALS_MISSING");
  const env = {
    PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    AWS_CONFIG_FILE: "/dev/null", AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
    AWS_EC2_METADATA_DISABLED: "true", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
    AWS_MAX_ATTEMPTS: "1", AWS_RETRY_MODE: "standard", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off"
  };
  for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) {
    requireCondition(typeof source[name] === "string" && source[name].length > 0 && source[name].length <= 16_384 &&
      !/[\s\u0000-\u001f\u007f]/.test(source[name]), "COLLECTION_CREDENTIALS_MISSING");
    env[name] = source[name];
  }
  return env;
}
function run(executable, args, env, version = false) {
  const result = spawnSync(executable, args, {
    shell: false, env, timeout: version ? 5000 : 20_000, killSignal: "SIGKILL",
    maxBuffer: MAX_RESPONSE, stdio: ["ignore", "pipe", "pipe"]
  });
  requireCondition(!result.error && result.status === 0 && result.signal === null &&
    Buffer.isBuffer(result.stdout) && result.stdout.length > 0 && result.stdout.length <= MAX_RESPONSE,
    "AWS_COMMAND_FAILED");
  // Never forward AWS stderr, raw errors or request arguments to the terminal.
  return result.stdout;
}
function writeNew(path, bytes) {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function publish(outputDirectory, files, manifest) {
  // Exclusive directory creation prevents overwriting any existing result. No cleanup of user paths.
  mkdirSync(outputDirectory, { mode: 0o700 });
  const directoryFd = openSync(outputDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const [name, bytes] of files) writeNew(join(outputDirectory, name), bytes);
    fsyncSync(directoryFd);
    writeNew(join(outputDirectory, "collection-manifest.json"), encoded(manifest));
    fsyncSync(directoryFd);
  } finally { closeSync(directoryFd); }
}

/** Collection occurs BEFORE the G04 review, packet construction, trust policy enrollment and dual signing. */
export function collectS3Retention(options, { environment = process.env, clock = Date.now } = {}) {
  try {
    requireCondition(exact(options, ["requestPath", "expectedRequestSha256", "archivePath", "awsCliPath", "outputDirectory", "allowReadOnlyAws"]) &&
      options.allowReadOnlyAws === true && typeof options.expectedRequestSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(options.expectedRequestSha256));
    const requestBytes = readPilotBytes(options.requestPath, 16 * 1024);
    requireCondition(hash(requestBytes) === options.expectedRequestSha256, "COLLECTION_REQUEST_DIGEST_MISMATCH");
    const request = parseS3CollectionRequest(requestBytes), requirements = request.requirements;
    const archive = readPilotBytes(options.archivePath, 4 * 1024 * 1024);
    requireCondition(hash(archive) === requirements.archiveSha256 && archive.length === requirements.archiveSizeBytes,
      "COLLECTION_ARCHIVE_MISMATCH");
    let previousTime = 0;
    const time = () => {
      const now = clock();
      requireCondition(Number.isSafeInteger(now) && now >= previousTime && now <= 8_640_000_000_000_000, "COLLECTION_CLOCK_INVALID");
      previousTime = now;
      return now;
    };
    const startedAt = time();
    requireCondition(Date.parse(requirements.minRetentionUntilUtc) > startedAt, "S3_RETENTION_POLICY_UNMET");
    requireCondition(typeof options.outputDirectory === "string" && options.outputDirectory.length > 0 && !options.outputDirectory.includes("\0"));
    const output = resolve(options.outputDirectory), parent = dirname(output);
    requireCondition(lstatSync(parent).isDirectory(), "COLLECTION_OUTPUT_INVALID");
    try { lstatSync(output); throw new CollectionError("COLLECTION_OUTPUT_EXISTS"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    requireCondition(typeof options.awsCliPath === "string" && isAbsolute(options.awsCliPath) && !options.awsCliPath.includes("\0"));
    const executable = realpathSync(options.awsCliPath);
    requireCondition(statSync(executable).isFile(), "COLLECTION_EXECUTABLE_INVALID");
    const env = collectorChildEnvironment(environment);
    const versionText = new TextDecoder("utf-8", { fatal: true }).decode(run(executable, ["--version"], env, true)).trim();
    requireCondition(/^aws-cli\/2\.\d+\.\d+\s[^\r\n]*$/.test(versionText) && versionText.length <= 1024, "AWS_CLI_V2_REQUIRED");
    const endpoint = `https://s3.${request.region}.amazonaws.com`;
    const observation = { schemaVersion: 1, scope: "HRBP_AWS_S3_OBJECT_LOCK_READBACK:1" };
    const files = new Map([["collection-request.json", requestBytes], ["G05.bin", archive]]);
    const provenance = [];
    for (const [name, command] of OPERATIONS) {
      const input = { Bucket: requirements.bucket, ExpectedBucketOwner: requirements.expectedBucketOwner };
      if (name !== "bucketVersioning" && name !== "objectLockConfiguration") {
        input.Key = requirements.key; input.VersionId = requirements.versionId;
      }
      if (name === "headObject") input.ChecksumMode = "ENABLED";
      const before = time();
      // Literal JSON prevents file:// parameters and leading-dash keys from becoming CLI flags/file reads.
      const args = ["s3api", command, "--cli-input-json", JSON.stringify(input), "--region", request.region,
        "--endpoint-url", endpoint, "--output", "json", "--no-cli-pager", "--no-cli-auto-prompt",
        "--no-paginate", "--cli-connect-timeout", "5", "--cli-read-timeout", "10"];
      const raw = run(executable, args, env);
      const ended = time();
      observation[name] = { observedAtUtc: new Date(ended).toISOString(), request: input,
        response: normalizeS3Readback(name, parseS3CollectionJson(raw)) };
      const filename = `${name}.raw.json`;
      files.set(filename, raw);
      provenance.push({ operation: name, startedAtUtc: new Date(before).toISOString(),
        finishedAtUtc: new Date(ended).toISOString(), rawSha256: hash(raw), rawFile: filename });
    }
    const finishedAt = time();
    validateS3RetentionObservation(observation, requirements, {
      now: finishedAt, reviewedAtUtc: new Date(finishedAt).toISOString(),
      approvedRetentionUntilUtc: requirements.minRetentionUntilUtc,
      archiveSha256: hash(archive), archiveSizeBytes: archive.length
    });
    const observationBytes = encoded(observation);
    files.set("G04.bin", observationBytes);
    const manifest = {
      schemaVersion: 1, scope: "HRBP_S3_COLLECTION_PROVENANCE:1", status: "COLLECTED_NOT_AUTHORIZED",
      requestSha256: hash(requestBytes), region: request.region, endpoint, awsCliVersion: versionText,
      startedAtUtc: new Date(startedAt).toISOString(), finishedAtUtc: new Date(finishedAt).toISOString(),
      operations: provenance, files: [...files].map(([name, bytes]) => ({ name, sha256: hash(bytes), bytes: bytes.length })),
      providerAttestationVerified: false, lockEnforcementTested: false
    };
    publish(output, files, manifest);
    return { ok: true, code: "S3_OBSERVATIONS_COLLECTED", observations: 5,
      observationSha256: hash(observationBytes), manifestSha256: hash(encoded(manifest)),
      providerAttestationVerified: false, lockEnforcementTested: false };
  } catch (error) {
    return { ok: false, code: error instanceof CollectionError || error instanceof S3RetentionError || error instanceof S3ReadbackError
      ? error.code : "COLLECTION_FAILED", observations: 0 };
  }
}
function flags(argv) {
  const names = new Map([["--request", "requestPath"], ["--expected-request-sha256", "expectedRequestSha256"],
    ["--archive", "archivePath"], ["--aws-cli", "awsCliPath"], ["--out-dir", "outputDirectory"]]);
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--allow-read-only-aws") {
      requireCondition(!Object.hasOwn(options, "allowReadOnlyAws")); options.allowReadOnlyAws = true;
    } else {
      const name = names.get(flag), value = argv[++index];
      requireCondition(name && !Object.hasOwn(options, name) && typeof value === "string" && value && !value.startsWith("--"));
      options[name] = value;
    }
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try { result = collectS3Retention(flags(process.argv.slice(2))); }
  catch { result = { ok: false, code: "COLLECTION_INPUT_INVALID", observations: 0 }; }
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
