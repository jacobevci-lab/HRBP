# RFC 3161 trusted timestamp verification for audit checkpoints

This operator-host workflow adds real RFC 3161 timestamp verification to the independent audit checkpoint process. It does not run in the HRBP application, Worker, database scheduler or on-prem runtime image.

## Trust boundary

The HRBP tooling does not contact a TSA over HTTP. The operator obtains a timestamp response from an approved external TSA using the organization's normal PKI process, then verifies the returned RFC 3161 response offline.

The verification path requires:

- the exact canonical checkpoint file;
- the DER RFC 3161 response;
- an independently approved CA trust store;
- optionally an explicit untrusted TSA/intermediate chain file.

The command uses OpenSSL `ts -verify` against the original checkpoint bytes. A response that belongs to another checkpoint or chains to another root is rejected.

## 1. Create a timestamp query

First create the signed checkpoint using the existing independent full-history scan.

Then generate a DER RFC 3161 query:

```sh
node scripts/audit-checkpoint-timestamp.mjs query \
  --checkpoint /secure-operator/evidence/checkpoint.json \
  --out /secure-operator/evidence/checkpoint.tsq
```

The checkpoint must already be in the canonical signed checkpoint format. Query output is created with no-overwrite semantics.

## 2. Submit to the approved TSA

Submit `checkpoint.tsq` to the organization's approved timestamp authority using the externally governed process.

This repository deliberately does not implement TSA network submission, credentials, HTTP endpoints or trust-on-first-use.

Retain the DER response, for example:

`checkpoint.tsr`

## 3. Verify the response offline

Verify the response against the exact checkpoint bytes and approved CA trust store:

```sh
node scripts/audit-checkpoint-timestamp.mjs verify \
  --checkpoint /secure-operator/evidence/checkpoint.json \
  --response /secure-operator/evidence/checkpoint.tsr \
  --ca-file /secure-verifier/trust/tsa-root-ca.pem \
  --untrusted-chain-file /secure-verifier/trust/tsa-chain.pem \
  --out /secure-operator/evidence/checkpoint-timestamp-evidence.json
```

If the TSA certificate chain is already embedded in the RFC 3161 response, `--untrusted-chain-file` may be omitted.

Verification fails closed if:

- the timestamp response does not match the checkpoint bytes;
- the TSA response cannot be verified by the supplied CA trust store;
- the DER response is malformed;
- the timestamp is beyond the allowed future-clock tolerance;
- any required file is unsafe or oversized;
- evidence output already exists.

## Evidence summary

The generated evidence file contains bounded metadata only:

- checkpoint SHA-256;
- timestamp response SHA-256;
- CA trust-store SHA-256;
- RFC 3161 policy OID;
- trusted timestamp value;
- local verification time.

It does not contain raw audit records, employee fields, tenant identifiers, TSA private keys or database credentials.

The RFC 3161 response remains the cryptographic evidence. The JSON summary is an index/verification receipt, not a substitute for the signed timestamp token.

## Relationship to checkpoint and archive evidence

The trusted timestamp does not replace:

- the signed checkpoint;
- signer trust inventory;
- dual-control authority governance;
- archive retention manifest;
- external WORM/Object Lock enforcement.

It proves that the TSA signed a timestamp token whose message imprint matches the exact checkpoint bytes under the supplied trust chain.

## Clock and trust-store governance

The TSA timestamp is cryptographically carried by the RFC 3161 response. `verifiedAt` is only the local operator-host verification time.

The CA trust store must be independently approved and retained. The evidence summary records its SHA-256 so a later verifier can identify which trust material was used.

Changing the trusted root is a PKI governance action and must not be inferred from the timestamp response itself.

## CI coverage

CI uses an ephemeral test CA and an RFC 3161 TSA certificate with critical `timeStamping` EKU.

Mandatory tests prove:

- real OpenSSL RFC 3161 response verification;
- checkpoint substitution rejection;
- untrusted TSA root rejection;
- canonical checkpoint query generation;
- no-overwrite evidence publication.

The test TSA is synthetic and never represents a production trust authority.

## Remaining #215 deployment requirements

This software supplies real RFC 3161 verification but does not establish:

- production TSA vendor approval;
- TSA service availability/SLA;
- production HSM/KMS custody;
- customer Object Lock/WORM enforcement;
- customer legal retention policy;
- actual customer forensic acceptance.

Those remain deployment/customer controls.
