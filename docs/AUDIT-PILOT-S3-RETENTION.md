# Authenticated S3 retention observations (pilot policy v2)

## What this increment proves — and does not prove

The v1 verifier authenticates two approver signatures and twelve file digests. The v2 policy adds an offline semantic check of five **operator-retained observations** in `G04.bin`, bound to the exact archive bytes in `G05.bin`.

This is NOT a live AWS integration, an AWS-signed attestation, a lock-enforcement test, a production release authorization, or proof that an observer told the truth. No network, AWS SDK, database, shell, deletion attempt, private key or credential is used by the verifier. A dishonest approved collector and approvers can still sign fabricated observations. Independent collector custody, approved AWS endpoint/TLS verification and request/response provenance remain external controls. Never promote the result to `GO` or close G04's operational acceptance solely from this report.

The success report explicitly carries `retention.liveProviderVerified: false`. It covers ONE pinned object version, not storage of every gate/approval file, bucket-wide immutability, legal compliance, or the internal cryptographic validity/completeness of the G05 archive. Existing checkpoint/archive validators still apply. Existing offline pin-revocation, local clock, operator-controlled parent-directory and no-atomic-directory-snapshot limitations remain unchanged.

## Compatibility and anti-downgrade

Policy v1 and its result remain unchanged; v1 still treats provider evidence as opaque. To opt into v2, retain every v1 policy field, change `schemaVersion` to `2` and `scope` to `HRBP_AUDIT_PILOT_TRUST:2`, and add exactly one `retentionRequirements` object. V2 automatically enforces the profile; there is no skip flag.

Recompute the policy/packet hashes, have both independently enrolled approvers sign, and enroll the new policy hash through the independent approval register. Old policy pins and signatures cannot authenticate the new bytes.

For workflows that REQUIRE S3 semantics, always supply the independent local requirement:

```sh
node scripts/audit-pilot-evidence.mjs \
  --packet /approved/packet.json \
  --trust-policy /approved/policy.json \
  --expected-policy-sha256 "$CURRENT_INDEPENDENT_POLICY_SHA256" \
  --signatures /approved/signatures.json \
  --evidence-dir /approved/evidence \
  --require-retention-profile AWS_S3_OBJECT_LOCK_COMPLIANCE_V1
```

The final flag rejects v1 policies even when they have otherwise valid signatures and hashes. Never obtain the expected policy pin from the untrusted evidence package. Omission of the flag preserves intentional legacy v1 behavior; it does not automatically upgrade v1 assurance. The underlying signature domain/envelope remains v1 because it already binds the exact policy and packet hashes and each approver's role, identity reference and key fingerprint.

## Exact retention requirements

All properties are required and unknown properties fail closed:

```json
{
  "profile": "AWS_S3_OBJECT_LOCK_COMPLIANCE_V1",
  "bucket": "approved-general-purpose-bucket",
  "key": "audit/archive.bin",
  "versionId": "the-explicit-non-null-version-id",
  "expectedBucketOwner": "123456789012",
  "archiveSha256": "<64 lowercase hex characters for G05.bin>",
  "archiveSizeBytes": 4096,
  "minRetentionUntilUtc": "2027-10-27T21:00:00.000Z",
  "maxObservationAgeSeconds": 3600,
  "legalHoldRequired": true
}
```

`G05.bin` MUST be the exact bytes of the intended externally retained archive object, not a screenshot or a description of it. The digest and length are computed from the authenticated local G05 bytes and compared with the policy and HEAD observation. The archive is bounded to 4 MiB in this initial profile. This profile is intended for general-purpose buckets. Endpoint URLs, ARNs and directory-bucket names ending in `--x-s3` are rejected; the offline checker cannot establish actual bucket type or alias provenance. Object keys are metadata, never local file paths.

The maximum observation age is an explicitly approved integer between 1 and 86,400 seconds. This is the tool's conservative collection policy, NOT an AWS or legal requirement. The policy's retain-until floor may not be earlier than the packet's approved retention deadline. Legal-hold enforcement is independently optional, but a hold never substitutes for timed COMPLIANCE retention in this profile.

## Exact G04 normalized observation document

Use compact UTF-8 `JSON.stringify(document) + "\n"`, no BOM, duplicate keys, extra whitespace, unknown fields or normalization after signing. The document is at most 32 KiB and has exactly these top-level fields:

- `schemaVersion`: `1`.
- `scope`: `HRBP_AWS_S3_OBJECT_LOCK_READBACK:1`.
- `bucketVersioning`, `objectLockConfiguration`, `headObject`, `objectRetention`, `legalHold`: five observations.

Each observation has exactly `observedAtUtc`, `request`, `response`. All times use canonical UTC ISO milliseconds (for example `2026-10-27T20:59:55.000Z`). The observation must not be in the future, must predate/equal the G04 review, and must be fresh at verification time. The existing review <= both approvals <= decision <= verifier-clock rules still apply. These remain asserted local times, not trusted timestamps.

| Observation | Exact normalized request | Exact normalized response |
| --- | --- | --- |
| `bucketVersioning` | `Bucket`, `ExpectedBucketOwner` | `Status` |
| `objectLockConfiguration` | `Bucket`, `ExpectedBucketOwner` | `ObjectLockEnabled` |
| `headObject` | `Bucket`, `ExpectedBucketOwner`, `Key`, `VersionId`, `ChecksumMode` | `VersionId`, `ContentLength`, `ChecksumSHA256`, `ChecksumType`, `DeleteMarker`, `ObjectLockMode`, `ObjectLockRetainUntilDate`, `ObjectLockLegalHoldStatus` |
| `objectRetention` | `Bucket`, `ExpectedBucketOwner`, `Key`, `VersionId` | `Mode`, `RetainUntilDate` |
| `legalHold` | `Bucket`, `ExpectedBucketOwner`, `Key`, `VersionId` | `Status` |

Requests must match the pinned bucket/owner and, for the three object operations, exact key/version. HEAD must request `ChecksumMode: "ENABLED"`. Versioning and bucket Object Lock must both report `Enabled`. HEAD's returned version must match, `DeleteMarker` must be `false`, and the content length must equal actual G05 bytes.

HEAD requires canonical base64 SHA-256 with `ChecksumType: "FULL_OBJECT"`; multipart COMPOSITE values and ETags are never accepted as an entire-file SHA-256. Both retention observations must report `COMPLIANCE` and the same valid, unexpired retain-until date meeting the policy floor. Legal-hold observations must agree on `ON`/`OFF`, with `ON` mandatory when the policy requests it. No governance bypass analysis or variable/event-hold retention is implemented.

## Collection boundary

An authorized independent collector must acquire successful, read-only AWS responses for GetBucketVersioning, GetObjectLockConfiguration, HeadObject, GetObjectRetention and GetObjectLegalHold. Use explicit expected bucket owner and version on every applicable request. Retain original outputs and provenance in the controlled evidence register; this code does not collect or independently verify them.

The table describes an application-owned **normalized projection**, not a promise that arbitrary raw AWS CLI/SDK JSON will parse. Extract nested ObjectLockConfiguration/Retention/LegalHold fields, preserve HEAD fields, and convert SDK date values to canonical UTC before review and signing. Only normalize an absent DeleteMarker to false after a successfully observed HEAD of the pinned live object version. Do not invent absent checksum, version, mode, hold, date or permission-dependent fields. Reject failed/ambiguous calls rather than emitting success-shaped records. Do not discard EventHold/EventHoldDuration or normalize variable retention into fixed retention; that provider mode is unsupported. Retain meaningful original response metadata separately and have the collector/approvers authenticate the projection against those originals.

A 403 from a deletion attempt is not consumed as proof: it could be caused by unrelated permissions. This tool performs no deletion/overwrite test. Customer safe-test-object acceptance, IAM bypass review, provider provenance, actual deployment, TSA policy and legal approval remain separate work.

## Output and test command

Successful v2 output retains `READY_FOR_INDEPENDENT_AUTHORIZATION`, 2 verified signatures and 12 verified artifacts. Its assurance is `PINNED_SIGNATURES_DIGESTS_AND_S3_OBSERVATION_SEMANTICS`, with the profile, five verified observations and `liveProviderVerified: false`. Failures produce sanitized `NO_GO`, fixed reason codes and zero success counts; raw bucket/key/account/version identifiers are never logged.

`npm run audit-pilot:validate` runs the original suites and the S3 regression suite; existing read-only CI and prebuild wiring are preserved. Tests use ephemeral in-memory keys, locally generated files, fully re-signed invalid observations and real CLI subprocesses. No live AWS, production data or customer key is involved.

## Primary references checked 27 October 2026

- AWS Object Lock, individual-version scope, compliance/governance and legal holds: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- AWS GetObjectRetention, explicit version and expected bucket owner: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectRetention.html
- AWS HeadObject fields and checksum metadata: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
- AWS full-object versus composite checksums: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html
- AWS bucket default retention is a separate configuration: https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object-lock-configuration.html
