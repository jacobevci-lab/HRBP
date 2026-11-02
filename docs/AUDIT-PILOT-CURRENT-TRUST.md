# Current pilot trust-state checks

## Purpose and boundary

`audit-pilot-evidence.mjs` can now require an independently pinned, short-lived **offline trust-register snapshot** in addition to the existing policy pin, two Ed25519 signatures and evidence files. This layer answers whether the exact policy and both signer key fingerprints are explicitly active in that enrolled snapshot. A revoked policy or either revoked key denies current acceptance even when the original signatures remain mathematically valid.

This is NOT a live revocation lookup, certificate CRL/OCSP implementation, trusted timestamp, proof of the latest register revision or a release authorization. It does not decide whether an old signature was valid at signing time. The local clock, register publisher, current digest distribution and sequence-floor custody are external trust assumptions. A later revocation cannot be discovered until a fresh snapshot and its approved pin/floor are supplied. Do not describe this as closing all offline revocation limitations.

## Independent input, not a new self-approved policy version

Policy v1/v2/v3 schemas and signature payloads are unchanged. The current snapshot is deliberately **outside** the historical dual-signed packet. Requiring the old approvers to sign their own revocation would create the wrong trust dependency.

The operator must obtain BOTH the current snapshot SHA-256 and the minimum accepted sequence from an independent, access-controlled current trust register. Never take these values from the candidate packet, a bundled manifest, an untrusted caller or the snapshot's own assertions. Computing a digest of an arbitrary supplied file does not enroll it. The same customer-scoped sequence namespace must be retained across policy/key rotations; do not reset or lower the floor. This implementation neither publishes the register nor persists/advances that floor automatically.

## Snapshot format

Use UTF-8 `JSON.stringify(snapshot) + "\n"`, without BOM or duplicate keys. The file is limited to 65,536 bytes and uses the existing single-link, regular-file POSIX reader. Parent directories remain operator-controlled. Exact fields:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | Exactly `1` |
| `scope` | Exactly `HRBP_AUDIT_PILOT_CURRENT_TRUST:1` |
| `customerReference` | Exact customer reference from the authenticated policy |
| `sequence` | Positive safe integer, at least the independently supplied floor |
| `issuedAtUtc` | Canonical ISO UTC milliseconds; at or after the packet decision, not in the future |
| `expiresAtUtc` | Strictly after the verification time and issue time; issue-to-expiry window at most 24 hours |
| `policies` | 1–128 unique records, each exactly `{sha256, status, updatedAtUtc}` |
| `keys` | 1–256 unique records, each exactly `{keyId, status, updatedAtUtc}` |

Digests/fingerprints are lowercase SHA-256 hex. A `keyId` is the SHA-256 of the same Ed25519 SPKI DER public key used by the existing approval envelope. Each `status` is exactly `ACTIVE` or `REVOKED`; each canonical update timestamp is nonnegative and no later than snapshot issuance. All records are validated, including entries not selected for this packet. Unknown fields, duplicate identifiers, unknown states and future updates fail closed. Unlisted policies and keys are not implicitly trusted. The selected policy and both distinct signer keys must all be listed and `ACTIVE`; unrelated revoked records do not invalidate an otherwise valid selection.

The 24-hour window is an implementation ceiling, not a recommendation to leave compromised credentials trusted for 24 hours. Publish and independently distribute revocations promptly and use shorter windows where operational policy requires them. Exactly expired snapshots fail; there is no clock-skew grace or fallback to the historical policy.

## CLI and integration

Append all four options to the existing evidence-verifier command:

```sh
node scripts/audit-pilot-evidence.mjs \
  --packet /approved/packet.json \
  --trust-policy /approved/policy.json \
  --expected-policy-sha256 "$APPROVED_POLICY_SHA256" \
  --signatures /approved/signatures.json \
  --evidence-dir /approved/artifacts \
  --require-trust-state-profile HRBP_PILOT_CURRENT_TRUST_V1 \
  --trust-state /independent-register/current.json \
  --expected-trust-state-sha256 "$CURRENT_REGISTER_SHA256" \
  --minimum-trust-sequence "$CURRENT_SEQUENCE_FLOOR"
```

The pin/floor variables above are public integrity values from independent enrollment, not secrets. Do not derive them from the candidate inside this command. The existing required retention/collection flags may also be supplied. CLI sequences must use positive decimal integers without leading zeroes, exponents or fractional spelling.

Programmatic option names: `requiredTrustStateProfile`, `trustStatePath`, `expectedTrustStateSha256`, `minimumTrustSequence` (a number). Supplying **any** of them requires all four; missing/undefined/invalid values never silently downgrade. Unknown verifier option names, inherited-option objects and accessor properties now fail closed, so a misspelled mandatory control is not ignored. Callers that previously supplied unused extra fields must remove them.

Both approval signatures are verified before opening the snapshot; trust-state checks then finish before any artifact-directory access. The existing artifact, S3 semantic and v3 provenance checks still run. Active registry records cannot substitute for missing signatures or modified evidence.

Success adds `currentTrust: {profile, sequence, checkedPolicies:1, checkedKeys:2, liveRegistryVerified:false}`. The existing assurance label and 12/19 artifact count remain unchanged; the register is a separate trusted input, not another approver-signed artifact. No currentTrust result is emitted on failure. Legacy calls with none of the four controls retain their old output and **do not gain revocation protection**. Production wrappers that require current trust must enforce this profile themselves, independently of candidate content.

## Verification and scope

The new mandatory test suite covers v1/v2/v3 real dual signatures, independent state replacement, both signer revocations, policy revocation, absent records, rollback floors, timestamps and expiry boundaries, malformed inventories, partial/unknown controls, signature-before-state and state-before-artifact ordering, bounded linked/FIFO files and CLI non-disclosure. Fixtures use only temporary local keys and synthetic records; there are no customer trust-register or provider calls.

No AWS collection behavior, application runtime, dependency versions, lockfile, workflow permissions, branch protections or deployment settings are changed. Existing live-provider, collector-custody, local-clock, non-atomic filesystem and independent human authorization limitations remain.
