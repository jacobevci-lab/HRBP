/** Offline binding of collector files to a dual-signed, independently pinned v3 policy.
 * This proves retained-byte consistency, NOT an AWS signature or truthful collection.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { readPilotBytes } from "./audit-pilot-gate-evaluator.mjs";
import { normalizeS3Readback, parseS3CollectionJson, parseS3CollectionRequest } from "./audit-pilot-s3-readback.mjs";

export const S3_COLLECTION_PROFILE = "AWS_S3_COLLECTION_PROVENANCE_V1";
const OPERATIONS = Object.freeze(["bucketVersioning", "objectLockConfiguration", "headObject", "objectRetention", "legalHold"]);
const RAW_FILES = OPERATIONS.map(name => `${name}.raw.json`);
const FILES = Object.freeze(["collection-request.json", "G05.bin", ...RAW_FILES, "G04.bin"]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value, fields) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value ? Date.parse(value) : null;
export class S3ProvenanceError extends Error {
  constructor(code) { super("S3 collection provenance verification failed."); this.code = code; }
}
function requireCondition(condition, code) { if (!condition) throw new S3ProvenanceError(code); }

export function validateS3CollectionRequirements(requirements) {
  requireCondition(exact(requirements, ["profile", "manifestSha256", "requestSha256"]) &&
    requirements.profile === S3_COLLECTION_PROFILE && sha(requirements.manifestSha256) &&
    sha(requirements.requestSha256), "S3_COLLECTION_POLICY_INVALID");
}

/** Invoke only AFTER BOTH signatures and the twelve pilot artifacts authenticate.
 * directory is already checked by the caller; parent directories remain operator-controlled.
 * G04 and G05 are supplied from their original verified reads, never reopened here.
 */
export function verifyS3CollectionProvenance(directory, requirements, retentionRequirements, context) {
  validateS3CollectionRequirements(requirements);
  const { observationBytes, archiveBytes, reviewedAtUtc, now } = context;
  requireCondition(Buffer.isBuffer(observationBytes) && Buffer.isBuffer(archiveBytes) &&
    Number.isSafeInteger(now) && now >= 0 && date(reviewedAtUtc) !== null && date(reviewedAtUtc) <= now,
    "S3_COLLECTION_CONTEXT_INVALID");
  const manifestBytes = readPilotBytes(join(directory, "collection-manifest.json"), 16 * 1024);
  requireCondition(hash(manifestBytes) === requirements.manifestSha256, "S3_COLLECTION_MANIFEST_DIGEST_MISMATCH");
  const manifest = parseS3CollectionJson(manifestBytes, true);
  requireCondition(exact(manifest, ["schemaVersion", "scope", "status", "requestSha256", "region", "endpoint",
    "awsCliVersion", "startedAtUtc", "finishedAtUtc", "operations", "files", "providerAttestationVerified", "lockEnforcementTested"]) &&
    manifest.schemaVersion === 1 && manifest.scope === "HRBP_S3_COLLECTION_PROVENANCE:1" &&
    manifest.status === "COLLECTED_NOT_AUTHORIZED" && manifest.providerAttestationVerified === false &&
    manifest.lockEnforcementTested === false && manifest.requestSha256 === requirements.requestSha256 &&
    typeof manifest.awsCliVersion === "string" && manifest.awsCliVersion.length <= 1024 &&
    /^aws-cli\/2\.\d+\.\d+ [^\u0000-\u001f\u007f]+$/.test(manifest.awsCliVersion), "S3_COLLECTION_MANIFEST_INVALID");
  // Validate the COMPLETE fixed inventory before reading files. Never resolve manifest paths.
  requireCondition(Array.isArray(manifest.files) && manifest.files.length === FILES.length &&
    new Set(manifest.files.map(file => file?.name)).size === FILES.length &&
    manifest.files.every(file => exact(file, ["name", "sha256", "bytes"]) && FILES.includes(file.name) &&
      sha(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 4 * 1024 * 1024),
    "S3_COLLECTION_INVENTORY_INVALID");
  requireCondition(Array.isArray(manifest.operations) && manifest.operations.length === OPERATIONS.length &&
    manifest.operations.every((operation, index) => exact(operation,
      ["operation", "startedAtUtc", "finishedAtUtc", "rawSha256", "rawFile"]) &&
      operation.operation === OPERATIONS[index] && operation.rawFile === RAW_FILES[index] && sha(operation.rawSha256)),
    "S3_COLLECTION_OPERATIONS_INVALID");

  const files = new Map([["G04.bin", observationBytes], ["G05.bin", archiveBytes]]);
  files.set("collection-request.json", readPilotBytes(join(directory, "collection-request.json"), 16 * 1024));
  for (const name of RAW_FILES) files.set(name, readPilotBytes(join(directory, name), 64 * 1024));
  for (const file of manifest.files) {
    const bytes = files.get(file.name);
    requireCondition(bytes.length === file.bytes && hash(bytes) === file.sha256, "S3_COLLECTION_FILE_DIGEST_MISMATCH");
  }
  const requestBytes = files.get("collection-request.json");
  requireCondition(hash(requestBytes) === requirements.requestSha256, "S3_COLLECTION_REQUEST_DIGEST_MISMATCH");
  const request = parseS3CollectionRequest(requestBytes);
  requireCondition(isDeepStrictEqual(request.requirements, retentionRequirements) && manifest.region === request.region &&
    manifest.endpoint === `https://s3.${request.region}.amazonaws.com`, "S3_COLLECTION_REQUEST_MISMATCH");
  const start = date(manifest.startedAtUtc), finish = date(manifest.finishedAtUtc);
  requireCondition(start !== null && finish !== null && start >= 0 && start <= finish &&
    finish <= date(reviewedAtUtc) && finish <= now && now - start <= retentionRequirements.maxObservationAgeSeconds * 1000,
    "S3_COLLECTION_CHRONOLOGY_INVALID");

  const observed = parseS3CollectionJson(observationBytes, true);
  const reconstructed = { schemaVersion: 1, scope: "HRBP_AWS_S3_OBJECT_LOCK_READBACK:1" };
  let previous = start;
  for (const operation of manifest.operations) {
    const started = date(operation.startedAtUtc), ended = date(operation.finishedAtUtc);
    requireCondition(started !== null && ended !== null && started >= previous && ended >= started && ended <= finish,
      "S3_COLLECTION_CHRONOLOGY_INVALID");
    previous = ended;
    const raw = files.get(operation.rawFile);
    requireCondition(hash(raw) === operation.rawSha256, "S3_COLLECTION_RAW_DIGEST_MISMATCH");
    const input = { Bucket: retentionRequirements.bucket, ExpectedBucketOwner: retentionRequirements.expectedBucketOwner };
    if (!["bucketVersioning", "objectLockConfiguration"].includes(operation.operation)) {
      input.Key = retentionRequirements.key; input.VersionId = retentionRequirements.versionId;
    }
    if (operation.operation === "headObject") input.ChecksumMode = "ENABLED";
    // Project only from the exact authenticated stdout buffer using the collector's PURE decoder.
    reconstructed[operation.operation] = {
      observedAtUtc: operation.finishedAtUtc, request: input,
      response: normalizeS3Readback(operation.operation, parseS3CollectionJson(raw))
    };
  }
  requireCondition(isDeepStrictEqual(observed, reconstructed), "S3_COLLECTION_NORMALIZATION_MISMATCH");
  return {
    profile: S3_COLLECTION_PROFILE, verifiedFiles: 7, verifiedRawResponses: 5,
    normalizedObservationMatched: true, providerAttestationVerified: false, lockEnforcementTested: false
  };
}
