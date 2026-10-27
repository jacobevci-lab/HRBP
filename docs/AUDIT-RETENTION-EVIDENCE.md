# External retention evidence binding

This operator-host workflow binds an independently signed audit archive, verified RFC 3161 timestamp evidence and an externally obtained storage-provider retention receipt into one signed evidence declaration.

It is deliberately **not** an HRBP application API, Worker job, database task or storage-provider integration.

## What this provides

The retention evidence file cryptographically binds:

- the exact signed archive manifest SHA-256;
- the exact checkpoint SHA-256 carried by that archive;
- the exact RFC 3161 verification-evidence SHA-256;
- the exact RFC 3161 response SHA-256 and trusted timestamp;
- the exact external provider/storage receipt SHA-256;
- a pseudonymous storage-target reference;
- the requested retention deadline from the archive;
- the provider retention deadline attested by the retention controller;
- a retention mode label;
- the retention-controller signing key.

The evidence is signed under the dedicated domain:

`HRBP-AUDIT-RETENTION-EVIDENCE:1`

## Important boundary

The provider receipt is treated as **opaque evidence**.

HRBP does not parse a provider JSON/PDF/XML response and does not claim that an Object Lock, WORM, Vault Lock or equivalent control is actually enforced merely because the file exists.

The fixed assurance level is:

`OPERATOR_ATTESTED_PROVIDER_RECEIPT`

This means an independently controlled operator has verified the external retention setting through the approved storage/control-plane procedure and is binding the resulting receipt to the audit evidence set.

Actual enforcement remains the responsibility of the customer's approved storage platform and governance process.

## Separation of duties

Use a dedicated Ed25519 retention-controller key.

The software rejects use of the audit checkpoint signer key as the retention-controller key. This prevents the same cryptographic identity from both creating the audit checkpoint and attesting the provider-retention receipt.

This does not prove that two different humans or teams control those keys. Human identity, RBAC, approvals and custody remain deployment governance.

## Prerequisites

Before creating retention evidence:

1. create and verify the independent signed checkpoint;
2. create and verify the signed archive bundle;
3. obtain and verify an RFC 3161 timestamp response;
4. retain the timestamp evidence JSON;
5. configure the external immutable-retention control;
6. obtain the provider/control-plane retention receipt;
7. independently confirm that the provider retention deadline meets or exceeds the archive's requested retention deadline.

The archive-manifest and timestamp-evidence SHA-256 values must be taken from the external evidence inventory, not recomputed and silently trusted from a suspect directory.

## Create the signed retention evidence

Example:

```sh
node scripts/audit-retention-evidence.mjs create \
  --archive-dir /mnt/external-audit-evidence/customer-a/2026-10-27 \
  --expected-archive-manifest-sha256 ARCHIVE_MANIFEST_SHA256 \
  --timestamp-evidence /secure-verifier/evidence/checkpoint-timestamp-evidence.json \
  --expected-timestamp-evidence-sha256 TIMESTAMP_EVIDENCE_SHA256 \
  --provider-receipt /secure-verifier/evidence/storage-retention-receipt.json \
  --storage-target-id customer-a/prod/audit-vault \
  --controller-private-key-file /secure-retention-controller/retention-ed25519-private.pem \
  --retention-mode OBJECT_LOCK_COMPLIANCE \
  --provider-retention-until 2033-10-27T00:00:00.000Z \
  --out /secure-verifier/evidence/retention-evidence.json \
  --acknowledge-provider-retention-verified
```

Supported provider-neutral labels:

- `OBJECT_LOCK_COMPLIANCE`
- `OBJECT_LOCK_GOVERNANCE`
- `VAULT_LOCK`
- `APPEND_ONLY_ARCHIVE`
- `REGULATED_ARCHIVE`

These are evidence labels only. The label itself does not configure the provider.

The create command fails closed if:

- the archive manifest digest is not the externally pinned digest;
- the timestamp evidence digest is not the externally pinned digest;
- the RFC 3161 evidence refers to another checkpoint;
- the provider-retention deadline is earlier than the archive-requested deadline;
- the provider-retention deadline is already expired;
- the retention-controller key equals the checkpoint signer key;
- the output evidence file already exists.

## Verify later

Retain the evidence SHA-256 returned by the create command in the independent evidence register.

Verification example:

```sh
node scripts/audit-retention-evidence.mjs verify \
  --archive-dir /mnt/external-audit-evidence/customer-a/2026-10-27 \
  --expected-archive-manifest-sha256 ARCHIVE_MANIFEST_SHA256 \
  --timestamp-evidence /secure-verifier/evidence/checkpoint-timestamp-evidence.json \
  --expected-timestamp-evidence-sha256 TIMESTAMP_EVIDENCE_SHA256 \
  --provider-receipt /secure-verifier/evidence/storage-retention-receipt.json \
  --storage-target-id customer-a/prod/audit-vault \
  --evidence /secure-verifier/evidence/retention-evidence.json \
  --controller-public-key-file /secure-verifier/trust/retention-controller-public.pem \
  --expected-evidence-sha256 RETENTION_EVIDENCE_SHA256 \
  --min-retention-until 2033-10-27T00:00:00.000Z
```

Verification checks:

- exact evidence digest;
- retention-controller signature and public-key identity;
- archive manifest digest;
- checkpoint binding;
- RFC 3161 evidence and response binding;
- exact external provider-receipt digest;
- pseudonymous storage-target binding;
- requested vs provider retention deadline;
- optional independent minimum-retention floor;
- whether the attested provider-retention period has expired.

## Evidence minimization

The signed declaration contains no:

- raw tenant ID;
- raw deployment ID;
- raw storage account/bucket/vault name;
- provider object/version ID;
- provider receipt contents;
- employee or audit-event fields.

The storage target is represented only by a domain-separated SHA-256 reference.

The provider receipt itself must still be retained separately because its SHA-256 is only a binding reference.

## Incident handling

On any mismatch:

- preserve the original archive, timestamp evidence, timestamp response, provider receipt and retention evidence;
- do not replace the provider receipt with a newly downloaded copy and silently continue;
- do not shorten the externally pinned retention floor;
- do not swap controller public keys based on evidence content;
- invoke the customer's audit-integrity/evidence incident procedure.

Relevant failures include:

- `RETENTION_EVIDENCE_ARCHIVE_DIGEST_MISMATCH`
- `RETENTION_EVIDENCE_TIMESTAMP_DIGEST_MISMATCH`
- `RETENTION_EVIDENCE_CHECKPOINT_MISMATCH`
- `RETENTION_EVIDENCE_SOURCE_MISMATCH`
- `RETENTION_EVIDENCE_SIGNATURE_INVALID`
- `RETENTION_EVIDENCE_CONTROLLER_UNTRUSTED`
- `RETENTION_EVIDENCE_RETENTION_POLICY_UNMET`
- `RETENTION_EVIDENCE_RETENTION_EXPIRED`
- `RETENTION_EVIDENCE_SEPARATION_VIOLATION`

## What this still does not prove

This software contract does not prove:

- the storage provider actually enforced the requested WORM/Object Lock control;
- delete permissions were organizationally separated;
- legal/regulatory retention requirements were correctly selected;
- the provider receipt itself was generated by an approved account or human;
- production HSM/KMS custody;
- real customer acceptance.

Those remain deployment/customer controls under #215.

The provider receipt should therefore be preserved together with the signed binding, not replaced by it.
