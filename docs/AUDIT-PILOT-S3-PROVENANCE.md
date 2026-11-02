# Authenticated S3 collection provenance (pilot trust policy v3)

## What changes

The collector already retains its request, five raw AWS CLI stdout files, G04/G05 and a collection manifest. Pilot policies v1/v2 authenticate only the twelve gate/approval files; those policies do **not** automatically authenticate the extra collector files. Policy v3 explicitly binds the collection manifest and approved request to the independently enrolled policy digest and both role-bound signatures.

A v3 result authenticates **19 unique evidence files**: the original twelve, the collection manifest, the request, and five raw response files. It also reconstructs G04 from those exact authenticated raw buffers and compares the result with the already authenticated G04. It never rereads G04 or G05 by pathname for these checks.

This proves consistency of retained bytes and the enrolled approvers' signatures. It does NOT authenticate AWS, the collector executable or host, truthful collection, live lock enforcement, trusted timestamps, current revocation status, or independent human custody. A compromised collector and dishonest enrolled approvers can still produce a self-consistent fabricated bundle. No live AWS access was used to validate this change.

## Policy schema and compatibility

Use the complete existing v2 policy, but change `schemaVersion` to `3` and `scope` to `HRBP_AUDIT_PILOT_TRUST:3`, and add exactly:

```json
"collectionRequirements": {
  "profile": "AWS_S3_COLLECTION_PROVENANCE_V1",
  "manifestSha256": "<SHA-256 of exact collection-manifest.json bytes>",
  "requestSha256": "<independently approved collection-request.json SHA-256>"
}
```

Placeholder values are not valid hashes. The complete policy retains all v2 fields, including `retentionRequirements`. Each new digest must be 64 lowercase hexadecimal characters. Policy v3 cannot omit either profile. Extra fields, unsupported scopes/profiles or version downgrades fail closed. The policy, packet and signature files retain their existing exact compact UTF-8 `JSON.stringify(value) + "\n"` encoding, size limits and two role-bound Ed25519 signatures.

The two signatures already bind the complete policy digest and packet digest. No signature algorithm or signing payload changes. Replacing a manifest or policy requires independent review, a new policy pin and new signatures; recomputing a hash of an untrusted file is NOT enrollment.

Existing v1/v2 result shapes and semantics remain compatible. Callers that require provenance must explicitly select the new profile. A v3 policy always performs provenance verification, even when the caller omits that flag.

```sh
node scripts/audit-pilot-evidence.mjs \
  --packet /approved/packet.json \
  --trust-policy /approved/policy.json \
  --expected-policy-sha256 "$INDEPENDENTLY_APPROVED_POLICY_SHA256" \
  --signatures /approved/signatures.json \
  --evidence-dir /protected/pilot-evidence \
  --require-retention-profile AWS_S3_OBJECT_LOCK_COMPLIANCE_V1 \
  --require-collection-profile AWS_S3_COLLECTION_PROVENANCE_V1
```

`--require-collection-profile` rejects v1/v2, unsupported values, duplicate flags and missing values. It is a verification requirement, not permission to access a provider.

## Required files and verification order

Keep all twelve original gate/approval files and these seven additional files in the same protected evidence directory:

- `collection-manifest.json`
- `collection-request.json`
- `bucketVersioning.raw.json`
- `objectLockConfiguration.raw.json`
- `headObject.raw.json`
- `objectRetention.raw.json`
- `legalHold.raw.json`

The file names are fixed by code. No manifest-supplied path, packet locator or URL is followed. Unlisted extra directory files are outside the verification claim; they are not automatically trusted, copied, removed or recursively inspected.

Verification first checks the external policy pin, policy/packet schemas, ten-gate preflight and BOTH signatures. Only then does it access the artifact directory. After all twelve pilot artifacts authenticate and v2 retention semantics pass, v3:

1. Reads the bounded manifest and verifies its policy-pinned SHA-256. It requires the collector's exact schema and `COLLECTED_NOT_AUTHORIZED`, with both provider-attestation and enforcement-test flags false.
2. Requires exactly eight unique manifest file entries: request, G04, G05 and five fixed raw responses. It checks five ordered operation records and refuses missing, duplicate, unknown or path-bearing names before reading their targets.
3. Reads the request (maximum 16 KiB) and five raw files (maximum 64 KiB each), then verifies every declared byte count and digest. G04/G05 use buffers retained from the original authenticated reads.
4. Verifies the independently pinned request digest, all retention requirements, declared region and corresponding standard HTTPS endpoint. Checks local collection chronology against operation order, G04 review, verification time and the existing freshness policy.
5. Re-parses each exact raw stdout buffer with the same PURE decoder used by the collector, reconstructs its normalized response and request, binds observation times to operation completion times, and compares the entire reconstructed observation with G04.
6. Rechecks directory metadata after all artifact/provenance processing. This detects some changes; it is not an atomic whole-directory snapshot or immutable store.

The new `audit-pilot-s3-readback.mjs` holds only pure decoding/normalization and collection-request validation. The offline verifier does not import the executable collector, credentials, child-process code or network clients. The collector re-exports `normalizeS3Readback` for existing callers and retains its previous command, consent, environment, timeout and publication controls.

## Collection-before-approval sequence

Approve the collection request independently; run the opted-in read-only collector; retain the exact outputs and review their provenance; add the other gate/approval artifacts; form the packet; enroll the complete v3 policy digest including the reviewed manifest/request digests; then obtain both role-bound signatures through the approved signing process. Never let the packet choose its own trusted pin. The verifier adds no signer service, private-key access, publication or cloud permissions.

Collection-local timestamps and CLI version/endpoint strings remain signed assertions, not trusted time or proof of execution. Raw CLI output is not an AWS-signed attestation or TLS wire capture. Files may contain sensitive HEAD metadata and target identifiers even though terminal summaries omit them. Keep them under the existing access, retention and disclosure controls.

## Result and limits

Success remains only `READY_FOR_INDEPENDENT_AUTHORIZATION`, now with assurance level `PINNED_SIGNATURES_DIGESTS_S3_SEMANTICS_AND_COLLECTION_PROVENANCE`, two verified signatures and 19 verified artifacts. The collection summary reports seven verified extra files, five verified raw responses and a successful normalization comparison. It explicitly keeps `providerAttestationVerified: false`, `lockEnforcementTested: false` and the retention result's `liveProviderVerified: false`.

No release authorization, production deployment, customer acceptance, legal compliance, storage of all evidence in WORM, recursive archive verification or trusted collector identity is implied. Existing operator-controlled parent-directory, offline policy-revocation and local-clock limitations still apply. #209 and #220 remain separate operational investigations.
