# Independent operator audit checkpoints (v1, partial #215)

## Purpose and trust boundary

`scripts/audit-checkpoint.mjs` is an opt-in operator tool, not an API, scheduled Worker feature or signing service. It provides three distinct operations: `create` performs a complete bounded read-only ledger scan and signs its confirmed head; `verify` checks the saved signature offline; `compare` authenticates a saved checkpoint and checks the current full ledger against the signed historical sequence in the same read-only snapshot.

Deploy the reviewed tooling on an independently administered POSIX host with Node.js 22 and the repository's pinned `pg` dependency. Keep its Ed25519 private key and checkpoint archive outside the HRBP web runtime, application database, repository, CI credentials and database administrators' control. The operator must provision a stable deployment identifier and externally approved public-key fingerprint. The CLI does not establish organizational independence simply by accepting an acknowledgement flag. Do not claim independent protection when the same compromised account controls the database, signer, verifier and retained files.

Creation does **not** accept an unsigned report from the application. The trusted operator process performs the scan itself with an approved SELECT-only database identity over an authenticated, certificate-verified connection. Grant only the reads needed on `Tenant`, `AuditLedgerState` and `AuditEvent`; do not reuse application superuser credentials. Obtain `DATABASE_URL` through the operator's approved secret mechanism. Never paste it or a private key into a ticket, command argument, chat or CI log. The connection and all SQL reads run inside `REPEATABLE READ READ ONLY`, and the head is taken from that verified snapshot, not queried again after it closes.

## Key and artifact handling

Provision an approved Ed25519 PKCS#8 PEM private key as a local, regular, single-link file owned by the operator with no group/other permissions (for example 0400). This initial implementation accepts an unencrypted key file protected by host access controls; it does not implement passphrase prompts, HSM/KMS integration or automated key generation/rotation. POSIX file ownership and permission checks fail closed. Final-component symlinks are rejected; parent directories and the approved tool installation must remain operator-controlled. Mount/copy approved files explicitly rather than relying on symlinked secret projections.

Verification accepts only an independently provided SPKI PEM public key. No key embedded in an evidence file is trusted. The fingerprint is SHA-256 over its SPKI DER representation. No alternative signature algorithm is negotiated; deployments that require an incompatible cryptographic policy, including a provider configuration that disables Ed25519, must not enable this tool until an approved implementation is available. There is no silent cryptographic fallback.

The small, versioned file contains the full-scan scope, sequence, tail hash, count, signer fingerprint, local completion timestamp and a hashed deployment/tenant reference. It contains no employee fields, raw tenant ID, connection details, private key or copy of the audit records. The reference is pseudonymous and guessable with known identifiers, **not anonymous data**. Handle these files as controlled audit evidence. The implementation signs a domain-separated fixed primitive-field payload using Node's built-in Ed25519 implementation, not a custom cryptographic primitive.

Publication stages a 0600 file in the destination directory, syncs it and uses a non-overwriting atomic hard-link publication followed by a directory sync. Existing files and symlinks are not overwritten. A crash can leave a temporary file or a published file despite an unsuccessful command; inspect and verify it rather than automatically replacing it. Unsupported/read-only filesystems fail. This is local publication, not immutable remote storage or proof that an archive copy succeeded.

## Approved operator commands

Run from the reviewed repository/tooling installation. The following identifiers and paths are examples; use the institution's independently recorded values. The private key is never supplied to the web app or this chat.

Create on the independent signer host after configuring its protected read-only connection:

```sh
node scripts/audit-checkpoint.mjs create \
  --tenant-id institution-01 --deployment-id onprem-prod-01 \
  --private-key-file /secure/hrbp-audit-ed25519.pem \
  --out /evidence/hrbp-checkpoint-20261014.json \
  --max-events 50000 --batch-size 250 \
  --acknowledge-independent-key --acknowledge-read-only-scan
```

Archive the file and its returned SHA-256 digest in a separately controlled evidence store. Record its expected sequence and approved public-key fingerprint there. Do not mark the checkpoint as independently retained until that copy and a separate verification have actually completed.

Verify offline on a trusted verifier host (no database connection or `pg` import is required for this command):

```sh
node scripts/audit-checkpoint.mjs verify \
  --checkpoint /evidence/hrbp-checkpoint-20261014.json \
  --public-key-file /trust/hrbp-audit-ed25519.pub.pem \
  --tenant-id institution-01 --deployment-id onprem-prod-01 \
  --max-age-hours 24 --min-sequence 1250
```

`1250` is only an example: use the sequence floor from the external evidence inventory. Optional `--expected-sha256` pins the exact checkpoint digest from that inventory. Without those externally maintained expectations, a still-fresh earlier valid artifact can be replayed. A valid signature alone does not prove it is the latest checkpoint. Public-key changes and retirement require an independently reviewed trust-inventory update; this tool never auto-enrolls a replacement key.

Compare today's database against the retained checkpoint using the same read-only operator connection and trust inventory:

```sh
node scripts/audit-checkpoint.mjs compare \
  --checkpoint /evidence/hrbp-checkpoint-20261014.json \
  --public-key-file /trust/hrbp-audit-ed25519.pub.pem \
  --tenant-id institution-01 --deployment-id onprem-prod-01 \
  --max-age-hours 24 --min-sequence 1250 \
  --max-events 50000 --batch-size 250 --acknowledge-read-only-scan
```

`verify` reports only `SIGNED_SNAPSHOT_ONLY`. `compare` additionally scans the current complete bounded history and compares the hash at the **old signed sequence**, allowing legitimate appended records. Changing earlier records and consistently recomputing the entire chain/head fails this anchored comparison. Truncating below the saved sequence fails even when the shortened database is internally consistent. Corruption after the saved anchor is still checked by the full scan. An initially empty checkpoint confirms only that empty snapshot; it cannot protect records created afterward without another checkpoint.

## Limits, result interpretation and incidents

The existing full-history operator budgets remain: default 50,000 events, maximum 1,000,000, maximum page 1,000, default elapsed budget 45 seconds and bounded SQL statement timeout. Invalid, incomplete, timed-out or failed-rollback scans never produce signed artifacts. These commands do not change the fast scheduled tenant cursor or the 10,000-event maintenance budget. No new migration or production record write is added.

`--max-age-hours` is mandatory for verify/compare, from 1 to 8760 hours. Future timestamps beyond a 30-second tolerance fail. `issuedAt` is the signer's local completion time, **not an independently trusted timestamp**; keep operator clocks synchronized. Historical/forensic verification needs an approved age policy and retained trust inventory, not arbitrary relaxation to make evidence green. CLI errors are bounded codes; raw file, cryptographic and database exceptions, paths and employee details are not printed.

On `CHECKPOINT_HASH_MISMATCH`, `CHECKPOINT_SEQUENCE_MISSING`, an unexpected signer/subject, signature failure, freshness failure or replay-floor violation, preserve the original file, trusted inventory and relevant read-only evidence, and invoke incident handling. Do not rewrite the audit ledger, replace the trusted public key from the suspect file, lower the external floor or silently accept a new baseline. A signed checkpoint detects changes relative to its retained prefix; it cannot reconstruct deleted events, prove the original business events were truthful, or detect a rewrite that happened before the first independent checkpoint. A compromised signer or verifier remains outside this protection.

## Test and pilot acceptance boundary

The prebuild audit gate runs offline cryptographic, canonical-format, subject binding, freshness/replay, filesystem safety, CLI and snapshot/anchor tests. The existing explicitly enabled localhost-only PostgreSQL integration entry point additionally creates a synthetic ledger, signs it, appends legitimately, then rewrites every synthetic hash/head and truncates history to require anchored detection. Those destructive fixture actions are CI-only and scoped to their generated tenant; operator commands never perform them.

Customer acceptance additionally requires approved key custody and public-key enrollment, successful independent artifact retention/verification, a tested comparison on representative data, measured runtime/load, backup/restore handling and a documented incident procedure. None is asserted merely because code or CI tests pass. Immutable archive transport/retention enforcement, automated checkpoint cadence and trust rotation, HSM/KMS support, trusted timestamping, and interrupted full-history scan resumption remain future work under #215. The provider deployment issue #220 and runtime HTTP 503 investigation #209 remain separate.

Implementation references: [Node.js 22 crypto signing/key APIs](https://nodejs.org/download/release/v22.18.0/docs/api/crypto.html) and [Node.js filesystem APIs](https://nodejs.org/docs/latest-v22.x/api/fs.html). No new crypto or filesystem package is introduced.
