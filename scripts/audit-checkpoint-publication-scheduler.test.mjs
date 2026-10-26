import assert from "node:assert/strict";
import test from "node:test";
import {
  auditCheckpointPublicationSchedulerArgs,
  runAuditCheckpointPublicationSchedulerOnce
} from "./audit-checkpoint-publication-scheduler.mjs";

const base = {
  HRBP_AUDIT_PUBLICATION_ENABLED: "true",
  HRBP_AUDIT_PUBLICATION_ACKNOWLEDGE_READ_ONLY_SCAN: "true",
  HRBP_AUDIT_PUBLICATION_ACKNOWLEDGE_EXTERNAL_RETENTION_TARGET: "true",
  HRBP_AUDIT_PUBLICATION_TENANT_ID: "tenant-a",
  HRBP_AUDIT_PUBLICATION_DEPLOYMENT_ID: "prod-a",
  HRBP_AUDIT_PUBLICATION_SIGNER_PRIVATE_KEY_FILE: "/secure/signer.pem",
  HRBP_AUDIT_PUBLICATION_TRUST_INVENTORY_DIR: "/secure/trust",
  HRBP_AUDIT_PUBLICATION_TRUST_AUTHORITY_PUBLIC_KEY_FILE: "/secure/authority.pem",
  HRBP_AUDIT_PUBLICATION_EXPECTED_TRUST_SHA256: "a".repeat(64),
  HRBP_AUDIT_PUBLICATION_TRUST_MAX_AGE_HOURS: "168",
  HRBP_AUDIT_PUBLICATION_ARCHIVE_ROOT: "/mnt/evidence",
  HRBP_AUDIT_PUBLICATION_RETENTION_DAYS: "2555",
  HRBP_AUDIT_PUBLICATION_ARCHIVE_MAX_AGE_HOURS: "24",
  HRBP_AUDIT_PUBLICATION_LOCK_FILE: "/var/lib/hrbp-audit-publication/publication.lock",
  HRBP_AUDIT_PUBLICATION_MAX_EVENTS: "50000",
  HRBP_AUDIT_PUBLICATION_BATCH_SIZE: "250",
  DATABASE_URL: "postgresql://secret-never-forwarded"
};

test("scheduler converts approved environment into one bounded publisher invocation", async () => {
  const calls = [];
  const result = await runAuditCheckpointPublicationSchedulerOnce(base, {
    runner: async args => {
      calls.push(args);
      return { ok: true, code: "CHECKPOINT_PUBLICATION_COMPLETE", sequence: "42" };
    }
  });
  assert.equal(result.code, "CHECKPOINT_PUBLICATION_COMPLETE");
  assert.equal(calls.length, 1);
  const args = calls[0];
  assert.deepEqual(args.slice(0, 3), ["run", "--tenant-id", "tenant-a"]);
  assert.ok(args.includes("--acknowledge-read-only-scan"));
  assert.ok(args.includes("--acknowledge-external-retention-target"));
  assert.ok(args.includes("50000"));
  assert.ok(args.includes("250"));
  assert.ok(!args.some(value => value.includes("secret-never-forwarded")));
});

test("disabled or unacknowledged scheduler configuration fails before the runner", async () => {
  for (const env of [
    { ...base, HRBP_AUDIT_PUBLICATION_ENABLED: "false" },
    { ...base, HRBP_AUDIT_PUBLICATION_ACKNOWLEDGE_READ_ONLY_SCAN: "false" },
    { ...base, HRBP_AUDIT_PUBLICATION_ACKNOWLEDGE_EXTERNAL_RETENTION_TARGET: "false" }
  ]) {
    let calls = 0;
    await assert.rejects(runAuditCheckpointPublicationSchedulerOnce(env, {
      runner: async () => { calls++; }
    }));
    assert.equal(calls, 0);
  }
});

test("malformed trust digest and numeric policy inputs fail closed", () => {
  for (const env of [
    { ...base, HRBP_AUDIT_PUBLICATION_EXPECTED_TRUST_SHA256: "not-a-hash" },
    { ...base, HRBP_AUDIT_PUBLICATION_RETENTION_DAYS: "0" },
    { ...base, HRBP_AUDIT_PUBLICATION_TRUST_MAX_AGE_HOURS: "-1" },
    { ...base, HRBP_AUDIT_PUBLICATION_BATCH_SIZE: "2.5" }
  ]) {
    assert.throws(() => auditCheckpointPublicationSchedulerArgs(env));
  }
});

test("optional scan budgets are omitted rather than invented", () => {
  const env = { ...base };
  delete env.HRBP_AUDIT_PUBLICATION_MAX_EVENTS;
  delete env.HRBP_AUDIT_PUBLICATION_BATCH_SIZE;
  const args = auditCheckpointPublicationSchedulerArgs(env);
  assert.equal(args.includes("--max-events"), false);
  assert.equal(args.includes("--batch-size"), false);
});

test("runner failure is propagated after exactly one attempt", async () => {
  let calls = 0;
  await assert.rejects(runAuditCheckpointPublicationSchedulerOnce(base, {
    runner: async () => {
      calls++;
      const error = new Error("bounded failure");
      error.code = "CHECKPOINT_PUBLICATION_LOCKED";
      throw error;
    }
  }), error => error?.code === "CHECKPOINT_PUBLICATION_LOCKED");
  assert.equal(calls, 1);
});
