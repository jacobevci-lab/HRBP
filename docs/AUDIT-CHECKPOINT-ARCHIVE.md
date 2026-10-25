# Independent audit checkpoint archive and retention bundle

This document extends the independent checkpoint model in `docs/AUDIT-CHECKPOINTS.md`. The archive tool is an **operator-host workflow**, not an HRBP web API, Worker maintenance job, application container feature or database service.

The goal is to bind an already independently signed checkpoint to an independently signed archive manifest that records:

- the exact checkpoint SHA-256 digest;
- checkpoint signer key ID and pseudonymous subject;
- checkpoint sequence and issue time;
- export time;
- requested retention deadline;
- the explicit `OPERATOR_EXTERNAL_RETENTION_TARGET` storage profile.

The manifest is signed with the same independent Ed25519 trust root as the checkpoint under a separate signing domain. This makes later changes to the recorded retention metadata or checkpoint substitution detectable.

## What this does not claim

The signed manifest records the retention policy requested at publication time. **It does not make ordinary disk immutable.**

Both checkpoint `issuedAt` and archive `exportedAt` are operator-host clock values, not trusted timestamps. Keep signer/verifier clocks synchronized and use a trusted timestamp authority later if the customer's assurance model requires one.

A deployment may claim independently retained / immutable evidence only after the operator has published the bundle to separately administered storage with an enforcement mechanism appropriate to the customer's governance model, for example:

- S3-compatible Object Lock / WORM retention;
- immutable backup vault retention;
- append-only evidence repository with independently administered delete controls;
- equivalent regulated archive control.

The HRBP application, its database administrators and its runtime credentials must not be able to replace or delete that retained copy.

The current CLI intentionally does not speak S3/HTTP or use `DATABASE_URL`. This keeps archive publication and verification offline/provider-neutral. A mounted external retention target is an operator integration boundary, not proof that the target itself is immutable.

## Trust boundary

Keep all of the following outside the HRBP application runtime, repository, CI secrets and database-administrator control:

- Ed25519 private signing key;
- approved public-key fingerprint / enrollment record;
- deployment identifier;
- checkpoint replay floor;
- archive bundle inventory;
- retention policy floor;
- external storage delete/retention administration.

The archive tool is deliberately **not copied into `Dockerfile.onprem`**. Run it from the separately administered operator host where `scripts/audit-checkpoint.mjs` is already reviewed and deployed.

## 1. Create the independent checkpoint

First create the signed checkpoint using the existing complete read-only scan:

```bash
node scripts/audit-checkpoint.mjs create \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --private-key-file /secure-operator/keys/audit-ed25519-private.pem \
  --out /secure-operator/staging/checkpoint.json \
  --acknowledge-independent-key \
  --acknowledge-read-only-scan
```

Do not archive a checkpoint created from an application-provided unsigned report. `create` must perform its own complete read-only scan.

## 2. Export a signed archive bundle

Provision a **new absolute bundle path** under the separately controlled retention target. The final bundle directory must not already exist.

```bash
node scripts/audit-checkpoint-archive.mjs export \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --checkpoint /secure-operator/staging/checkpoint.json \
  --private-key-file /secure-operator/keys/audit-ed25519-private.pem \
  --max-age-hours 24 \
  --retention-days 2555 \
  --out-dir /mnt/external-audit-evidence/customer-a/2026-10-25 \
  --acknowledge-external-retention-target
```

The command:

1. validates private-key ownership/mode through the existing checkpoint file controls;
2. verifies the checkpoint signature, subject, signer and freshness before publication;
3. creates a signed archive manifest under a distinct cryptographic domain;
4. rejects a world-writable external evidence parent before creating the bundle;
5. creates a new private bundle directory;
6. writes `checkpoint.json` and `archive-manifest.json` with no-overwrite semantics;
7. fsyncs the evidence files/directories before reporting success;
8. returns checkpoint and manifest SHA-256 digests plus the retention deadline.

A partial directory left by an interrupted publication is **not** a successful archive. Never delete or overwrite it automatically; investigate and publish a new uniquely named bundle.

## 3. Apply external immutable retention

After the bundle exists, apply and independently verify the storage platform's retention control.

Examples of evidence to retain outside HRBP:

- Object Lock / WORM mode;
- retention-until value;
- storage account / vault identifier;
- separate administrator or control-plane approval;
- object/version IDs;
- replication status where required;
- operator ticket / evidence inventory entry.

Do not treat the manifest's `retentionUntil` as proof that the storage platform enforced it.

## 4. Verify the retained bundle offline

Use the externally enrolled public key, deployment identity and policy floor:

```bash
node scripts/audit-checkpoint-archive.mjs verify \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --archive-dir /mnt/external-audit-evidence/customer-a/2026-10-25 \
  --public-key-file /secure-verifier/trust/audit-ed25519-public.pem \
  --max-export-delay-hours 24 \
  --min-retention-until 2033-10-23T00:00:00.000Z
```

Verification is offline. It checks:

- the original checkpoint signature and subject against the external public key;
- the archive-manifest signature;
- exact checkpoint digest / sequence / issue-time binding;
- signer key ID;
- maximum delay between checkpoint issue and archive publication;
- that the signed export timestamp is not more than 30 seconds in the future relative to the verifier clock;
- externally supplied minimum retention deadline;
- whether the recorded retention deadline has already expired.

It does **not** connect to the application database. To prove that today's database still matches the retained historical anchor, separately run `audit-checkpoint.mjs compare` against the retained `checkpoint.json`.

## Failure handling

On any of the following, preserve the bundle and invoke the evidence/integrity runbook:

- `CHECKPOINT_ARCHIVE_SIGNATURE_INVALID`
- `CHECKPOINT_ARCHIVE_CHECKPOINT_MISMATCH`
- `CHECKPOINT_ARCHIVE_EXPORT_DELAY_EXCEEDED`
- `CHECKPOINT_ARCHIVE_RETENTION_POLICY_UNMET`
- `CHECKPOINT_ARCHIVE_RETENTION_EXPIRED`
- unexpected signer / subject / public key
- external storage retention mismatch
- missing object/version or immutable-retention evidence
- incomplete bundle publication

Do not replace the enrolled public key from a suspect bundle, weaken the retention floor, overwrite the archive directory or silently create a new baseline.

## Remaining governance work under #215

This archive slice supplies cryptographically bound export metadata and provider-neutral no-overwrite publication. It still does not complete:

- actual customer storage Object Lock/WORM configuration;
- automated independently controlled publication cadence;
- public-key enrollment and rotation governance;
- HSM/KMS private-key custody;
- trusted timestamp authority integration;
- representative customer evidence-retention testing;
- customer-specific legal/regulatory retention policy approval.

Those controls must be demonstrated before claiming full independent assurance.
