import { pathToFileURL } from "node:url";
import { runAuditCheckpointPublicationCli } from "./audit-checkpoint-publication.mjs";

const HASH = /^[a-f0-9]{64}$/;
class PublicationSchedulerError extends Error {
  constructor(code) {
    super("Independent checkpoint publication scheduler did not complete safely.");
    this.code = code;
  }
}
function fail(code = "CHECKPOINT_PUBLICATION_SCHEDULER_CONFIG_INVALID") {
  throw new PublicationSchedulerError(code);
}
function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) fail();
  return value.trim();
}
function positive(env, name, { optional = false } = {}) {
  const raw = env[name];
  if ((raw === undefined || raw === "") && optional) return null;
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) fail();
  return raw;
}
function truth(env, name) {
  if (env[name] !== "true") fail("CHECKPOINT_PUBLICATION_SCHEDULER_NOT_ACKNOWLEDGED");
}

export function auditCheckpointPublicationSchedulerArgs(env = process.env) {
  if (env.HRBP_AUDIT_PUBLICATION_ENABLED !== "true") {
    fail("CHECKPOINT_PUBLICATION_SCHEDULER_DISABLED");
  }
  truth(env, "HRBP_AUDIT_PUBLICATION_ACKNOWLEDGE_READ_ONLY_SCAN");
  truth(env, "HRBP_AUDIT_PUBLICATION_ACKNOWLEDGE_EXTERNAL_RETENTION_TARGET");

  const expectedTrust = required(env, "HRBP_AUDIT_PUBLICATION_EXPECTED_TRUST_SHA256");
  const expectedAuthority = required(env, "HRBP_AUDIT_PUBLICATION_EXPECTED_AUTHORITY_SHA256");
  const expectedAuthorityPolicy = required(env, "HRBP_AUDIT_PUBLICATION_EXPECTED_AUTHORITY_POLICY_SHA256");
  if (![expectedTrust, expectedAuthority, expectedAuthorityPolicy].every(value => HASH.test(value))) fail();

  const args = [
    "run",
    "--tenant-id", required(env, "HRBP_AUDIT_PUBLICATION_TENANT_ID"),
    "--deployment-id", required(env, "HRBP_AUDIT_PUBLICATION_DEPLOYMENT_ID"),
    "--signer-private-key-file", required(env, "HRBP_AUDIT_PUBLICATION_SIGNER_PRIVATE_KEY_FILE"),
    "--trust-inventory-dir", required(env, "HRBP_AUDIT_PUBLICATION_TRUST_INVENTORY_DIR"),
    "--expected-trust-sha256", expectedTrust,
    "--trust-max-age-hours", positive(env, "HRBP_AUDIT_PUBLICATION_TRUST_MAX_AGE_HOURS"),
    "--authority-inventory-dir", required(env, "HRBP_AUDIT_PUBLICATION_AUTHORITY_INVENTORY_DIR"),
    "--authority-policy", required(env, "HRBP_AUDIT_PUBLICATION_AUTHORITY_POLICY_FILE"),
    "--expected-authority-policy-sha256", expectedAuthorityPolicy,
    "--expected-authority-sha256", expectedAuthority,
    "--authority-max-age-hours", positive(env, "HRBP_AUDIT_PUBLICATION_AUTHORITY_MAX_AGE_HOURS"),
    "--archive-root", required(env, "HRBP_AUDIT_PUBLICATION_ARCHIVE_ROOT"),
    "--retention-days", positive(env, "HRBP_AUDIT_PUBLICATION_RETENTION_DAYS"),
    "--archive-max-age-hours", positive(env, "HRBP_AUDIT_PUBLICATION_ARCHIVE_MAX_AGE_HOURS"),
    "--lock-file", required(env, "HRBP_AUDIT_PUBLICATION_LOCK_FILE"),
    "--acknowledge-read-only-scan",
    "--acknowledge-external-retention-target"
  ];
  const maxEvents = positive(env, "HRBP_AUDIT_PUBLICATION_MAX_EVENTS", { optional: true });
  const batchSize = positive(env, "HRBP_AUDIT_PUBLICATION_BATCH_SIZE", { optional: true });
  if (maxEvents) args.push("--max-events", maxEvents);
  if (batchSize) args.push("--batch-size", batchSize);
  return args;
}

export async function runAuditCheckpointPublicationSchedulerOnce(env = process.env, {
  runner = runAuditCheckpointPublicationCli
} = {}) {
  const args = auditCheckpointPublicationSchedulerArgs(env);
  // Exactly one attempt. Unknown/failed outcomes are never replayed in-process.
  return runner(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runAuditCheckpointPublicationSchedulerOnce(process.env);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof PublicationSchedulerError || typeof error?.code === "string"
        ? error.code
        : "CHECKPOINT_PUBLICATION_SCHEDULER_FAILED"
    }));
    process.exitCode = 1;
  }
}
