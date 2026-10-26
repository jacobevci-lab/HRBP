import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicationPath = "scripts/audit-checkpoint-publication.mjs";
const publicationTestPath = "scripts/audit-checkpoint-publication.test.mjs";
const trustPath = "scripts/audit-signer-trust-inventory.mjs";
const archivePath = "scripts/audit-checkpoint-archive.mjs";
const packagePath = "package.json";
const dockerPath = "Dockerfile.onprem";
const schedulerPath = "scripts/audit-checkpoint-publication-scheduler.mjs";
const schedulerTestPath = "scripts/audit-checkpoint-publication-scheduler.test.mjs";
const servicePath = "ops/audit-checkpoint-publication.service.example";
const timerPath = "ops/audit-checkpoint-publication.timer.example";
const envPath = "ops/audit-checkpoint-publication.env.example";

const [publication, tests, trust, archive, pkg, dockerfile, scheduler, schedulerTests, service, timer, env] = await Promise.all([
  readFile(publicationPath, "utf8"),
  readFile(publicationTestPath, "utf8"),
  readFile(trustPath, "utf8"),
  readFile(archivePath, "utf8"),
  readFile(packagePath, "utf8"),
  readFile(dockerPath, "utf8"),
  readFile(schedulerPath, "utf8"),
  readFile(schedulerTestPath, "utf8"),
  readFile(servicePath, "utf8"),
  readFile(timerPath, "utf8"),
  readFile(envPath, "utf8")
]);

function expect(source, pattern, message) { assert.match(source, pattern, message); }
function reject(source, pattern, message) { assert.doesNotMatch(source, pattern, message); }

expect(publication, /verifySignerTrustInventoryChainGoverned\(trustChain/, "publication must verify signer trust through the rotated authority chain before scanning");
expect(publication, /expectedAuthorityPolicySha256/, "publication must pin the authority governance policy");
expect(publication, /expectedAuthoritySha256/, "publication must pin the authority inventory");
expect(publication, /authorityInventorySha256/, "publication result must retain the verified authority inventory digest");
expect(publication, /trust\.activeKeyId !== signerKeyId/, "publication must require the configured signer to be the active enrolled signer");
expect(publication, /resolveCheckpointSigner\(trust\.latest/, "publication must resolve the signed checkpoint back through governed signer validity");
expect(publication, /createAuditCheckpoint\(/, "publication must create its own complete read-only checkpoint");
expect(publication, /createAuditCheckpointArchive\(/, "publication must bind the fresh checkpoint into the signed archive layer");
expect(publication, /readAuditCheckpointArchiveBundle\(output\)/, "publication must read back the retained bundle before success");
expect(publication, /verifyAuditCheckpointArchive\(retained\.archive/, "publication must verify the read-back archive before success");
expect(publication, /openSync\(path, "wx", 0o600\)/, "publication overlap lock must be no-overwrite");
expect(publication, /CHECKPOINT_PUBLICATION_LOCKED/, "overlap or stale lock must fail closed");
expect(publication, /default_transaction_read_only=on/, "operator DB connection must request read-only transactions at session level");
expect(publication, /acknowledge-read-only-scan/, "publication requires explicit read-only scan acknowledgement");
expect(publication, /acknowledge-external-retention-target/, "publication requires explicit external retention acknowledgement");
expect(publication, /trust\/key validation intentionally happens before any database connection/i, "trust/key preflight must precede database connection");
expect(publication, /if \(preflight\.activeKeyId !== checkpointKeyId\(createPublicKey\(signerPrivateKey\)\)\)/,
  "CLI must reject stale signer material before database connection");
expect(publication, /bundleId/, "publication result must expose a bounded bundle identifier, not a filesystem path");

reject(publication, /rejectUnauthorized\s*:\s*false/, "publication tooling must never disable transport verification");
reject(publication, /rmSync\(|force:\s*true/, "publication tooling must not clean up ambiguous evidence automatically");
reject(publication, /setInterval\(|setTimeout\([^,]+,\s*0\)/, "one-shot publication must not hide an internal retry loop");
reject(publication, /console\.log\([^\n]*(DATABASE_URL|private|archiveRoot|lockFile)/, "publication must not log secrets or operator filesystem paths");

expect(tests, /refuses a stale signer after governed rotation before scanning the database/, "stale signer preflight needs executable coverage");
expect(tests, /revoking the only active signer suspends publication without fallback/, "active signer revocation needs executable coverage");
expect(tests, /publication lock is exclusive/, "overlap lock needs executable coverage");
expect(tests, /existing lock blocks CLI before the database and is not auto-removed/, "ambiguous prior outcome must block automated replay");
expect(tests, /creates and reads back one governed external bundle/, "successful publication and read-back needs executable coverage");
expect(tests, /planned authority rotation preserves publication while emergency recovery invalidates old authority history/,
  "publication must cover authority rotation and recovery semantics");

expect(scheduler, /Exactly one attempt/, "scheduler wrapper must explicitly remain one-shot");
reject(scheduler, /setInterval\(|while\s*\(true\)|for\s*\(;;\)/, "scheduler wrapper must not contain a hidden retry loop");
expect(scheduler, /CHECKPOINT_PUBLICATION_SCHEDULER_DISABLED/, "publication scheduler must require explicit enablement");
expect(scheduler, /CHECKPOINT_PUBLICATION_SCHEDULER_NOT_ACKNOWLEDGED/, "publication scheduler must require explicit operator acknowledgements");
expect(schedulerTests, /runner failure is propagated after exactly one attempt/, "one-attempt behavior needs executable coverage");
expect(schedulerTests, /secret-never-forwarded/, "scheduler tests must prove DATABASE_URL is not copied into CLI arguments");

expect(service, /Type=oneshot/, "independent publication service must remain one-shot");
expect(service, /EnvironmentFile=\/etc\/hrbp-audit-publication\.env/, "service must consume protected operator-host configuration");
expect(service, /NoNewPrivileges=true/, "service example must enable no-new-privileges");
expect(service, /ProtectSystem=strict/, "service example must default to a read-only system view");
reject(service, /^Restart=/m, "service must not automatically replay ambiguous publication outcomes");
reject(service, /^OnFailure=/m, "service must not configure automatic failure replay");

expect(timer, /OnCalendar=daily/, "example timer must define an explicit cadence");
expect(timer, /Persistent=true/, "missed cadence must produce at most one systemd catch-up activation");
expect(timer, /RandomizedDelaySec=5m/, "timer must include jitter");
reject(timer, /^OnFailure=/m, "timer must not trigger an immediate failure replay");

expect(env, /DATABASE_URL=postgresql:\/\/READ_ONLY_OPERATOR:/, "operator environment example must use a distinct read-only database identity");
expect(env, /EXPECTED_TRUST_SHA256=CHANGE_ME_64_HEX/, "operator environment must pin the latest trust inventory digest");
expect(env, /EXPECTED_AUTHORITY_POLICY_SHA256=CHANGE_ME_64_HEX/, "operator environment must pin the authority approval policy");
expect(env, /EXPECTED_AUTHORITY_SHA256=CHANGE_ME_64_HEX/, "operator environment must pin the authority inventory");
reject(env, /TRUST_AUTHORITY_PUBLIC_KEY_FILE/, "publication automation must not remain tied to one fixed authority public key");
reject(env, /BEGIN PRIVATE KEY|PRIVATE KEY-----/, "environment example must never embed private key material");

expect(trust, /CHECKPOINT_SIGNER_TRUST_INVENTORY/, "publication must remain layered on signer governance");
expect(archive, /CHECKPOINT_ARCHIVE_MANIFEST/, "publication must remain layered on signed archive retention");
expect(pkg, /audit-checkpoint-publication\.test\.mjs/, "publication tests must be mandatory");
expect(pkg, /audit-checkpoint-publication-scheduler\.test\.mjs/, "publication scheduler tests must be mandatory");
expect(pkg, /validate-audit-checkpoint-publication\.mjs/, "publication static contract must be mandatory");
reject(dockerfile, /audit-checkpoint-publication\.mjs|audit-trust-authority-inventory\.mjs|audit-governance-approval\.mjs/,
  "independent publication/authority governance tooling must not be bundled into the HRBP application image");

console.log("Independent checkpoint publication: governed signer preflight, read-only scan, no-retry lock and archive read-back verified.");
