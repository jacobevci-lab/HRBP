/**
 * Semantics of authenticated operator-retained S3 observations, NOT an AWS client.
 * Call only after the containing policy, packet and G04/G05 bytes authenticate.
 * This checks the assertions; it cannot prove their provenance or current truth.
 */
export const S3_RETENTION_PROFILE = "AWS_S3_OBJECT_LOCK_COMPLIANCE_V1";
const SCOPE = "HRBP_AWS_S3_OBJECT_LOCK_READBACK:1";
const MAX_ARCHIVE = 4 * 1024 * 1024;
const OPERATIONS = ["bucketVersioning", "objectLockConfiguration", "headObject", "objectRetention", "legalHold"];
const exact = (value, fields) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value ? Date.parse(value) : null;
function text(value, max) {
  return typeof value === "string" && value.length > 0 && value.isWellFormed() &&
    Buffer.byteLength(value) <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
export class S3RetentionError extends Error {
  constructor(code) { super("Retained S3 observation validation failed."); this.code = code; }
}
function requireCondition(condition, code) { if (!condition) throw new S3RetentionError(code); }

export function validateS3RetentionRequirements(requirements) {
  requireCondition(exact(requirements, ["profile", "bucket", "key", "versionId", "expectedBucketOwner",
    "archiveSha256", "archiveSizeBytes", "minRetentionUntilUtc", "maxObservationAgeSeconds", "legalHoldRequired"]) &&
    requirements.profile === S3_RETENTION_PROFILE && typeof requirements.bucket === "string" &&
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(requirements.bucket) &&
    !requirements.bucket.includes("..") && !/^\d+\.\d+\.\d+\.\d+$/.test(requirements.bucket) &&
    !requirements.bucket.endsWith("--x-s3") && text(requirements.key, 1024) &&
    text(requirements.versionId, 1024) && requirements.versionId !== "null" &&
    typeof requirements.expectedBucketOwner === "string" && /^\d{12}$/.test(requirements.expectedBucketOwner) &&
    sha(requirements.archiveSha256) && Number.isSafeInteger(requirements.archiveSizeBytes) &&
    requirements.archiveSizeBytes > 0 && requirements.archiveSizeBytes <= MAX_ARCHIVE &&
    date(requirements.minRetentionUntilUtc) !== null &&
    Number.isSafeInteger(requirements.maxObservationAgeSeconds) &&
    requirements.maxObservationAgeSeconds >= 1 && requirements.maxObservationAgeSeconds <= 86_400 &&
    typeof requirements.legalHoldRequired === "boolean", "S3_RETENTION_POLICY_INVALID");
}

/** Pure validator. All timestamps and response fields remain operator assertions. */
export function validateS3RetentionObservation(observation, requirements, context) {
  validateS3RetentionRequirements(requirements);
  requireCondition(exact(context, ["now", "reviewedAtUtc", "approvedRetentionUntilUtc", "archiveSha256", "archiveSizeBytes"]) &&
    Number.isSafeInteger(context.now) && context.now >= 0 && date(context.reviewedAtUtc) !== null &&
    date(context.reviewedAtUtc) <= context.now && date(context.approvedRetentionUntilUtc) !== null &&
    context.archiveSha256 === requirements.archiveSha256 && context.archiveSizeBytes === requirements.archiveSizeBytes,
    "S3_ARCHIVE_CONTEXT_MISMATCH");
  const minimum = date(requirements.minRetentionUntilUtc);
  requireCondition(minimum >= date(context.approvedRetentionUntilUtc) && minimum > context.now,
    "S3_RETENTION_POLICY_UNMET");
  requireCondition(exact(observation, ["schemaVersion", "scope", ...OPERATIONS]) &&
    observation.schemaVersion === 1 && observation.scope === SCOPE, "S3_OBSERVATION_SCHEMA_INVALID");

  for (const operation of OPERATIONS) {
    const item = observation[operation];
    requireCondition(exact(item, ["observedAtUtc", "request", "response"]), "S3_OBSERVATION_SCHEMA_INVALID");
    const observedAt = date(item.observedAtUtc);
    requireCondition(observedAt !== null && observedAt <= context.now && observedAt <= date(context.reviewedAtUtc) &&
      context.now - observedAt <= requirements.maxObservationAgeSeconds * 1000, "S3_OBSERVATION_TIME_INVALID");
    const fields = ["Bucket", "ExpectedBucketOwner"];
    if (!["bucketVersioning", "objectLockConfiguration"].includes(operation)) fields.push("Key", "VersionId");
    if (operation === "headObject") fields.push("ChecksumMode");
    requireCondition(exact(item.request, fields) && item.request.Bucket === requirements.bucket &&
      item.request.ExpectedBucketOwner === requirements.expectedBucketOwner &&
      (!fields.includes("Key") || (item.request.Key === requirements.key && item.request.VersionId === requirements.versionId)) &&
      (!fields.includes("ChecksumMode") || item.request.ChecksumMode === "ENABLED"), "S3_OBSERVATION_TARGET_MISMATCH");
  }

  const versioning = observation.bucketVersioning.response;
  const configuration = observation.objectLockConfiguration.response;
  requireCondition(exact(versioning, ["Status"]) && versioning.Status === "Enabled" &&
    exact(configuration, ["ObjectLockEnabled"]) && configuration.ObjectLockEnabled === "Enabled",
    "S3_BUCKET_LOCK_NOT_ENABLED");
  const head = observation.headObject.response;
  const retention = observation.objectRetention.response;
  const hold = observation.legalHold.response;
  requireCondition(exact(head, ["VersionId", "ContentLength", "ChecksumSHA256", "ChecksumType", "DeleteMarker",
    "ObjectLockMode", "ObjectLockRetainUntilDate", "ObjectLockLegalHoldStatus"]) &&
    exact(retention, ["Mode", "RetainUntilDate"]) && exact(hold, ["Status"]), "S3_OBSERVATION_SCHEMA_INVALID");
  requireCondition(head.VersionId === requirements.versionId && head.DeleteMarker === false &&
    head.ContentLength === requirements.archiveSizeBytes, "S3_OBJECT_VERSION_MISMATCH");
  // ETags and multipart COMPOSITE checksums are NOT full-file SHA-256 proofs.
  requireCondition(head.ChecksumType === "FULL_OBJECT" && typeof head.ChecksumSHA256 === "string" &&
    /^[A-Za-z0-9+/]{43}=$/.test(head.ChecksumSHA256) &&
    Buffer.from(head.ChecksumSHA256, "base64").toString("base64") === head.ChecksumSHA256 &&
    Buffer.from(head.ChecksumSHA256, "base64").toString("hex") === requirements.archiveSha256,
    "S3_OBJECT_CHECKSUM_MISMATCH");
  requireCondition(head.ObjectLockMode === "COMPLIANCE" && retention.Mode === "COMPLIANCE",
    "S3_COMPLIANCE_MODE_REQUIRED");
  const until = date(head.ObjectLockRetainUntilDate);
  requireCondition(until !== null && date(retention.RetainUntilDate) === until && until >= minimum && until > context.now,
    "S3_RETENTION_DEADLINE_UNMET");
  requireCondition(["ON", "OFF"].includes(hold.Status) && head.ObjectLockLegalHoldStatus === hold.Status &&
    (!requirements.legalHoldRequired || hold.Status === "ON"), "S3_LEGAL_HOLD_UNMET");
  return { profile: S3_RETENTION_PROFILE, verifiedObservations: OPERATIONS.length, liveProviderVerified: false };
}
