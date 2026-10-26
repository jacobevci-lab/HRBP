# Independent audit signer trust governance and publication cadence

This document extends `docs/AUDIT-CHECKPOINTS.md` and `docs/AUDIT-CHECKPOINT-ARCHIVE.md`.

The trust-governance and publication tooling runs on a separately administered **audit operator host**. It is not part of the HRBP web application, Worker runtime, maintenance scheduler, on-prem application container or CI signing path.

## Trust model

There are two distinct Ed25519 key roles:

1. **Checkpoint signer key**
   - signs independently scanned audit checkpoints;
   - may be rotated or revoked;
   - private material is used only on the independent signer host.

2. **Trust-authority key**
   - signs the signer-enrollment/rotation inventory;
   - must be administered separately from the checkpoint signer;
   - authorizes which checkpoint signer key is active, retired or revoked.

A checkpoint signer cannot enroll its own replacement. A new signer becomes trusted only when a new authority-signed inventory generation is published and the exact latest generation digest is externally pinned.

This implementation does not prove organizational separation merely because two files contain different keys. Customers must enforce separate custody, roles and approvals.

## Append-only signer inventory

`scripts/audit-signer-trust-inventory.mjs` stores canonical generations:

- `inventory-000001.json`
- `inventory-000002.json`
- ...

Every generation:

- is signed under the domain `HRBP-AUDIT-SIGNER-TRUST-INVENTORY:1`;
- binds the authority key ID and deployment/tenant pseudonymous subject;
- binds the SHA-256 digest of the immediately previous generation;
- is published with no-overwrite semantics;
- records signer public key, key ID, validity interval and status;
- permits at most one `ACTIVE` signer;
- retains `RETIRED` keys for historical checkpoint verification;
- treats `REVOKED` keys as fail-closed even for previously issued checkpoints.

The latest inventory SHA-256 must be recorded in a separately controlled trust register/change ticket. Do not discover the latest trusted generation from the directory alone.

## Bootstrap enrollment

Provision an operator-controlled trust directory and separate authority key. The checkpoint signer public key is the enrollment input; the signer private key is never accepted.

```bash
node scripts/audit-signer-trust-inventory.mjs init \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --inventory-dir /etc/hrbp-audit/trust-inventory \
  --authority-private-key-file /secure-trust-authority/authority-ed25519-private.pem \
  --signer-public-key-file /secure-signer/checkpoint-ed25519-public.pem \
  --acknowledge-separate-trust-authority
```

Record the returned `latestSha256` outside the signer host before automated publication is enabled.

## Signer rotation

At the approved change window, enroll the new signer public key and pin the current inventory digest explicitly:

```bash
node scripts/audit-signer-trust-inventory.mjs rotate \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --inventory-dir /etc/hrbp-audit/trust-inventory \
  --authority-private-key-file /secure-trust-authority/authority-ed25519-private.pem \
  --signer-public-key-file /secure-signer/new-checkpoint-ed25519-public.pem \
  --expected-current-sha256 APPROVED_CURRENT_INVENTORY_SHA256 \
  --acknowledge-separate-trust-authority
```

Rotation retires the previous active signer at the new generation issue time, makes the new signer active, preserves the previous signer only for checkpoints inside its historical validity window, rejects stale current digests and rejects a previously enrolled replacement key.

After rotation, update the externally controlled latest-inventory digest and replace the signer private key used by the publication service. Until both actions are complete, publication fails closed.

## Emergency revocation

```bash
node scripts/audit-signer-trust-inventory.mjs revoke \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --inventory-dir /etc/hrbp-audit/trust-inventory \
  --authority-private-key-file /secure-trust-authority/authority-ed25519-private.pem \
  --key-id SIGNER_KEY_ID_TO_REVOKE \
  --expected-current-sha256 APPROVED_CURRENT_INVENTORY_SHA256 \
  --acknowledge-separate-trust-authority
```

A revoked signer is not accepted for historical verification. Revoking the only active signer leaves no implicit fallback signer; automated publication stops until a reviewed replacement is enrolled.

## Offline inventory verification

```bash
node scripts/audit-signer-trust-inventory.mjs verify \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --inventory-dir /etc/hrbp-audit/trust-inventory \
  --authority-public-key-file /secure-verifier/trust-authority-public.pem \
  --expected-latest-sha256 APPROVED_LATEST_INVENTORY_SHA256 \
  --max-age-hours 168
```

Verification checks every generation signature, numbering without gaps, previous-generation digest chaining, subject, authority fingerprint, externally pinned latest digest, future/stale policy, signer key IDs, validity windows and active/retired/revoked state. It does not contact HRBP or the database.

## Governed archive verification

`audit-checkpoint-archive.mjs verify` supports direct pinned signer-key verification and governed inventory verification. The two modes are mutually exclusive.

```bash
node scripts/audit-checkpoint-archive.mjs verify \
  --tenant-id CUSTOMER_TENANT_ID \
  --deployment-id APPROVED_DEPLOYMENT_ID \
  --archive-dir /mnt/hrbp-audit-evidence/BUNDLE_ID \
  --trust-inventory-dir /etc/hrbp-audit/trust-inventory \
  --trust-authority-public-key-file /secure-verifier/trust-authority-public.pem \
  --expected-trust-sha256 APPROVED_LATEST_INVENTORY_SHA256 \
  --trust-max-age-hours 168 \
  --max-export-delay-hours 24 \
  --min-retention-until 2033-10-23T00:00:00.000Z
```

The checkpoint `keyId` and `issuedAt` are resolved against the verified inventory. Retired keys remain valid only inside their historical validity window. Revoked keys fail closed.

## One-shot independent publication

`scripts/audit-checkpoint-publication.mjs` performs one publication attempt:

1. validate the authority-signed trust chain and externally pinned latest digest;
2. require the configured private signer to match the currently active enrolled public key;
3. acquire an exclusive operator-host lock;
4. connect using the separately provisioned database identity;
5. request PostgreSQL `default_transaction_read_only=on`;
6. run the existing complete `REPEATABLE READ READ ONLY` checkpoint scan;
7. sign the checkpoint;
8. create the signed archive retention manifest;
9. publish a new no-overwrite external bundle;
10. read the bundle back and verify it before returning success.

Trust/signer preflight happens before the database connection. The result contains bounded identifiers/digests and does not print `DATABASE_URL`, key material or full filesystem paths.

## Automated cadence with no hidden replay

`scripts/audit-checkpoint-publication-scheduler.mjs` is a one-shot environment adapter, not a looping scheduler. It invokes the publisher exactly once.

Example operator-host deployment files:

- `ops/audit-checkpoint-publication.service.example`
- `ops/audit-checkpoint-publication.timer.example`
- `ops/audit-checkpoint-publication.env.example`

The timer example uses `OnCalendar=daily`, `Persistent=true`, `RandomizedDelaySec=5m` and a `Type=oneshot` service. There is intentionally no `Restart=` or `OnFailure=` replay. An unknown/failed publication outcome is not immediately repeated.

## Publication lock and ambiguous outcomes

The lock file is created with no-overwrite semantics. Normal completion releases it. A crash or kill may leave it behind, and that stale lock is **not automatically removed**. The next timer run fails with `CHECKPOINT_PUBLICATION_LOCKED`.

Operator recovery:

1. inspect the previous service logs and external evidence target;
2. verify whether a complete bundle was published;
3. verify the bundle offline if present;
4. record the incident/outcome in the external evidence inventory;
5. remove the stale lock only after that review;
6. allow the next normal scheduled activation.

Do not configure an immediate retry loop to clear a stale lock.

## Environment and permissions

Protect `/etc/hrbp-audit-publication.env` as mode 0600. It may contain the read-only database connection string and paths to key/trust files, but never private key contents.

The example systemd unit runs as a dedicated `hrbp-audit` account, uses `UMask=0077`, enables `NoNewPrivileges=true`, uses `ProtectSystem=strict`, and grants write access only to the publication state directory and external evidence mount. Review host-specific paths before installation.

## Remaining assurance work

The stacked governance milestone now also provides software-enforced two-person approval, append-only trust-authority rotation/recovery and historical authority resolution. Current signer mutations are bound to approved operation/current generation/current digest/target key evidence, while planned authority rotation and emergency recovery have distinct historical semantics.

Provider-neutral RFC 3161 timestamp request/verification is documented in `docs/AUDIT-TRUSTED-TIMESTAMP.md`.

The software still does not prove:

- HSM/KMS-backed private-key custody;
- approved production TSA enrollment, root/policy administration and service assurance;
- Object Lock/WORM enforcement on a real customer storage service;
- human identity proof or the customer's organizational execution of two-person approval;
- customer-specific legal retention approval;
- representative customer load and restore/forensic exercises.

Those remain deployment/governance prerequisites under #215.
