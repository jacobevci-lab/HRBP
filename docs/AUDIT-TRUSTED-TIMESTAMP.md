# Independent RFC 3161 timestamp evidence for audit checkpoint archives

This operator-host workflow extends the independently signed checkpoint/archive chain with a standards-based trusted timestamp. It is deliberately outside the HRBP web application, Worker runtime, application database and on-prem application container.

The timestamp is applied to the canonical bytes of `archive-manifest.json`. That signed archive manifest already binds the exact checkpoint SHA-256, checkpoint signer identity, subject, sequence, issue/export times and retention deadline. Timestamping the archive manifest therefore creates an external time anchor for that retained evidence package without sending audit records, employee data, tenant IDs or signing private keys to a timestamp authority.

## Important trust boundary

`scripts/audit-checkpoint-timestamp.mjs` does **not** contact a TSA over HTTP/S. It has no network client.

The operator workflow is intentionally split:

1. HRBP tooling creates an RFC 3161 timestamp request (`.tsq`) over the canonical signed archive manifest.
2. An independently approved operator/TSA client submits that binary request to the approved timestamp authority.
3. The returned RFC 3161 timestamp response (`.tsr`) is supplied back to the offline verification tool.
4. The tool verifies the response against:
   - the original request and nonce;
   - the current canonical `archive-manifest.json` bytes;
   - an externally pinned TSA root certificate SHA-256;
   - an externally pinned TSA policy OID.
5. Verified request/response/receipt files are published to a new no-overwrite evidence directory.

No audit event content is included in the RFC 3161 request. The request contains the SHA-256 message imprint required by RFC 3161.

## Prerequisites

Use a separately administered operator host with:

- Node.js 22;
- OpenSSL **3.x or newer**;
- the reviewed HRBP operator scripts;
- the previously created signed checkpoint archive;
- an approved TSA root certificate file;
- any required intermediate/TSA certificate chain file;
- the independently recorded SHA-256 of the approved TSA root;
- the approved RFC 3161 policy OID.

Do not derive the expected CA digest or policy OID from the received timestamp response. They are trust inputs and must come from the institution's independently controlled trust register.

The optional `--untrusted-file` supplies intermediate/TSA certificates for chain construction. It is **not** a replacement trust anchor. The root supplied by `--ca-file` is separately SHA-256 pinned.

## 1. Create the timestamp request

The request is generated from the exact canonical `archive-manifest.json` bytes:

```sh
node scripts/audit-checkpoint-timestamp.mjs request \
  --archive-dir /mnt/external-audit-evidence/customer-a/2026-10-27 \
  --out /secure-operator/staging/customer-a-20261027.tsq
```

The command:

- verifies the archive manifest is canonical;
- requires OpenSSL 3+;
- creates an RFC 3161 SHA-256 request;
- requests inclusion of TSA certificate material;
- retains the RFC 3161 nonce;
- publishes the request with no-overwrite semantics;
- returns only the archive-manifest and request SHA-256 values.

Do not recreate or overwrite the request after it has been sent to a TSA. The response must be verified against the exact retained request.

## 2. Obtain the RFC 3161 response

Submit the `.tsq` to the institution's approved RFC 3161 service using the approved external process.

This repository intentionally does not prescribe a public TSA URL, bearer credential, proxy configuration or provider SDK. Those are deployment/customer trust decisions.

Retain the returned DER response unchanged, for example:

```
/secure-operator/staging/customer-a-20261027.tsr
```

Do not treat a successful HTTP response as timestamp acceptance. Cryptographic verification below is mandatory.

## 3. Verify and publish timestamp evidence

```sh
node scripts/audit-checkpoint-timestamp.mjs publish \
  --archive-dir /mnt/external-audit-evidence/customer-a/2026-10-27 \
  --request /secure-operator/staging/customer-a-20261027.tsq \
  --response /secure-operator/staging/customer-a-20261027.tsr \
  --ca-file /secure-verifier/trust/approved-tsa-root.pem \
  --untrusted-file /secure-verifier/trust/approved-tsa-chain.pem \
  --expected-ca-sha256 APPROVED_ROOT_SHA256 \
  --expected-policy-oid APPROVED_RFC3161_POLICY_OID \
  --max-delay-hours 24 \
  --max-clock-skew-seconds 300 \
  --out-dir /mnt/external-audit-evidence/customer-a/2026-10-27-timestamp
```

Verification performs two independent OpenSSL checks:

1. `ts -verify -queryfile ...` validates the TSA response against the exact original RFC 3161 request, including its nonce/message imprint and the trusted certificate chain.
2. `ts -verify -data archive-manifest.json ...` independently proves the response message imprint still matches the current canonical signed archive manifest bytes.

The tool then requires:

- the configured TSA root bytes to match `--expected-ca-sha256`;
- response policy OID to match `--expected-policy-oid`;
- trusted timestamp not to be implausibly ahead of the verifier clock beyond the configured skew;
- trusted timestamp not to predate the archive export time beyond the configured skew;
- archive-export-to-TSA delay to stay within the configured maximum.

The local archive `exportedAt` remains an operator-host clock value. Comparing it to the trusted TSA time detects gross clock/publication anomalies; it does not retroactively make the operator clock trusted.

The new evidence directory contains:

- `timestamp-request.tsq`
- `timestamp-response.tsr`
- `timestamp-receipt.json`

The receipt records only bounded verification metadata and SHA-256 bindings. The RFC 3161 response remains the cryptographic time evidence.

## 4. Re-verify retained timestamp evidence offline

```sh
node scripts/audit-checkpoint-timestamp.mjs verify \
  --archive-dir /mnt/external-audit-evidence/customer-a/2026-10-27 \
  --evidence-dir /mnt/external-audit-evidence/customer-a/2026-10-27-timestamp \
  --ca-file /secure-verifier/trust/approved-tsa-root.pem \
  --untrusted-file /secure-verifier/trust/approved-tsa-chain.pem \
  --expected-ca-sha256 APPROVED_ROOT_SHA256 \
  --expected-policy-oid APPROVED_RFC3161_POLICY_OID \
  --max-delay-hours 24 \
  --max-clock-skew-seconds 300
```

Re-verification reruns the cryptographic request and data checks. It does not trust the saved JSON receipt by itself.

A changed archive manifest, substituted request, modified response, wrong CA root, wrong policy or inconsistent receipt fails closed.

## Evidence interpretation

The RFC 3161 timestamp demonstrates that the timestamp authority signed a response containing the archive-manifest message imprint at the time represented in the verified token, subject to the assurance of the externally approved TSA PKI and policy.

It does **not** prove:

- the original business event was truthful;
- the external archive storage is immutable;
- the TSA operator satisfies a particular law/regulation unless separately assessed;
- the root certificate was independently approved merely because a file exists locally;
- the HRBP operator host clock was correct;
- HSM/KMS custody of the checkpoint or governance private keys.

The returned `verifiedAt` field is only the local verifier execution time. It is not a trusted timestamp.

## Failure handling

Treat the following as integrity/evidence incidents until explained:

- `TRUSTED_TIMESTAMP_QUERY_VERIFY_FAILED`
- `TRUSTED_TIMESTAMP_DATA_VERIFY_FAILED`
- `TRUSTED_TIMESTAMP_TRUST_ANCHOR_MISMATCH`
- `TRUSTED_TIMESTAMP_POLICY_MISMATCH`
- `TRUSTED_TIMESTAMP_FUTURE`
- `TRUSTED_TIMESTAMP_BEFORE_ARCHIVE`
- `TRUSTED_TIMESTAMP_DELAY_EXCEEDED`
- `TRUSTED_TIMESTAMP_RECEIPT_MISMATCH`
- missing or modified RFC 3161 request/response evidence
- TSA certificate/policy changes not reflected in the independent trust register

Preserve the original evidence. Do not overwrite a failed request/response, change the pinned root/policy simply to make verification pass, or silently create a replacement baseline.

## Remaining #215 deployment/customer assurance

This slice closes the software integration gap for provider-neutral RFC 3161 timestamp evidence. #215 remains open until real deployment evidence proves, as applicable:

- approved production TSA enrollment, root/policy governance and rotation handling;
- HSM/KMS-backed custody for relevant private keys;
- actual customer Object Lock/WORM/vault enforcement and retention receipts;
- organizational/human dual-control procedure;
- legal/regulatory retention approval;
- representative restore/forensic/load/customer acceptance.
