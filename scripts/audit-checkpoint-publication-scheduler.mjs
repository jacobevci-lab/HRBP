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
  if (!HASH.test(expectedTrust)) fail();

  const args = [
    "run",
    "--tenant-id", required(env, "HRBP_AUDIT_PUBLICATION_TENANT_ID"),
    "--deployment-id", required(env, "HRBP_AUDIT_PUBLICATION_DEPLOYMENT_ID"),
    "--signer-private-key-file", required(env, "HRBP_AUDIT_PUBLICATION_SIGNER_PRIVATE_KEY_FILE"),
    "--trust-inventory-dir", required(env, "HRBP_AUDIT_PUBLICATION_TRUST_INVENTORY_DIR"),
    "--expected-trust-sha256", expectedTrust,
    "--trust-max-age-hours", positive(env, "HRBP_AUDIT_PUBLICATION_TRUST_MAX_AGE_HOURS"),
    "--archive-root", required(env, "HRBP_AUDIT_PUBLICATION_ARCHIVE_ROOT"),
    "--retention-days", positive(env, "HRBP_AUDIT_PUBLICATION_RETENTION_DAYS"),
    "--archive-max-age-hours", positive(env, "HRBP_AUDIT_PUBLICATION_ARCHIVE_MAX_AGE_HOURS"),
    "--lock-file", required(env, "HRBP_AUDIT_PUBLICATION_LOCK_FILE"),
    "--acknowledge-read-only-scan",
    "--acknowledge-external-retention-target"
  ];
  const directAuthority = typeof env.HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_PUBLIC_KEY_FILE === "string"
    && env.HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_PUBLIC_KEY_FILE.trim() !== "";
  const chainNames = [
    "HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_CHAIN_DIR",
    "HRBP_AUDIT_PUBLICATION_TRUST_BOOTSTRAP_AUTHORITY_PUBLIC_KEY_FILE",
    "HRBP_AUDIT_PUBLICATION_EXPECTED_TRUST_AUTHORITY_CHAIN_SHA256",
    "HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_CHAIN_MAX_AGE_HOURS"
  ];
  const chainSome = chainNames.some(name => typeof env[name] === "string" && env[name].trim() !== "");
  const chainReady = chainNames.every(name => typeof env[name] === "string" && env[name].trim() !== "");
  if (chainSome && !chainReady || directAuthority === chainReady) {
    fail("CHECKPOINT_PUBLICATION_SCHEDULER_AUTHORITY_CONFIG_INVALID");
  }
  if (directAuthority) {
    args.push(
      "--trust-authority-public-key-file",
      required(env, "HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_PUBLIC_KEY_FILE")
    );
  } else {
    const expectedAuthorityChain = required(env, "HRBP_AUDIT_PUBLICATION_EXPECTED_TRUST_AUTHORITY_CHAIN_SHA256");
    if (!HASH.test(expectedAuthorityChain)) fail();
    args.push(
      "--trust-authority-chain-dir", required(env, "HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_CHAIN_DIR"),
      "--trust-bootstrap-authority-public-key-file", required(env, "HRBP_AUDIT_PUBLICATION_TRUST_BOOTSTRAP_AUTHORITY_PUBLIC_KEY_FILE"),
      "--expected-trust-authority-chain-sha256", expectedAuthorityChain,
      "--trust-authority-chain-max-age-hours", positive(env, "HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_CHAIN_MAX_AGE_HOURS")
    );
  }

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
