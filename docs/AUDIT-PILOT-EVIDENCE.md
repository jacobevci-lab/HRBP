# Offline authenticated pilot evidence (v1, partial #215)

## Boundary and compatibility

`scripts/audit-pilot-evidence.mjs` adds cryptographic verification alongside the metadata-only `audit-pilot-gate-evaluator.mjs`. The original preflight command and JSON schema remain compatible. Its metadata-only success MUST NOT be represented as authenticated evidence. Use the new verifier explicitly when authenticating an acceptance packet.

The new verifier checks an independently pinned trust-policy digest, two distinct Ed25519 approval keys, the exact signed packet, and the actual bytes of twelve retained evidence files. Success is still only `READY_FOR_INDEPENDENT_AUTHORIZATION`, with `assuranceLevel: PINNED_DUAL_SIGNATURES_AND_FILE_DIGESTS`. It is not a release authorization, a trusted timestamp or proof of effective WORM enforcement.

The trust-policy SHA-256 must come from the customer's independent, current approval register. Never take the expected pin from an untrusted bundle or compute-and-trust the pin immediately before verification. An attacker who can replace both the policy and its approved pin can enroll their own keys. Key custody, human identity and approval authority are external controls. Two different public keys do not prove two different humans or teams.

## Input layout

Use an independently administered POSIX operator host and an access-controlled frozen snapshot:

```text
packet.json
trust-policy.json
signatures.json
evidence/
  G01.bin ... G10.bin
  CUSTOMER_SECURITY.bin
  LEGAL_RECORDS.bin
```

The ten gate files must match the packet's corresponding `evidence[].sha256`. The other two must match `customerSecurityApproval.evidenceSha256` and `recordsLegalApproval.evidenceSha256`. Files may contain binary evidence; contents are neither parsed nor printed. Store a controlled collection manifest when a gate needs multiple underlying documents; authenticating that manifest does not authenticate every external document it references. The twelve files must not include the detached signatures of the packet that hashes them (avoid circular hashes).

`controlledLocator` remains a metadata reference. It is never used as a path or URL. Only the fixed names above are opened under the operator-supplied directory. Extra directory files are not evaluated. Parent directories and tool installation must remain under trusted operator control. Final-component symlinks/hard links and non-regular inputs are refused. Directory paths are normalized before inspection, including trailing-slash variants. This is not a sandbox, immutable store, whole-directory transaction or file lock; a concurrent privileged actor can still change files after verification. Use a frozen snapshot and retain the verified bytes.

Limits: packet 64 KiB; trust policy 16 KiB; signature envelope 4 KiB; each of exactly twelve artifact files 4 MiB (48 MiB total artifact payload cap; at most one extra sentinel byte per file may be read). Each read checks its descriptor before/after and refuses size/metadata changes. The common reader keeps the original packet API's 64 KiB limit.

## Exact JSON encoding

All three JSON files use UTF-8 `JSON.stringify(value) + "\n"`, without a BOM. Pretty printing, duplicate properties and alternative numeric spellings are rejected. This is not RFC 8785 canonicalization: property order is preserved and the exact stored bytes are hashed. Finalize encoding BEFORE pinning or signing. Reformatting a signed packet invalidates its digest.

The packet uses the existing schema in `AUDIT-PILOT-GATE.md`. The original chronological, freshness, evidence-type and two-reviewer constraints are rechecked, even for a correctly signed packet.

## Independently approved trust policy

Exact fields (shown pretty-printed for readability; serialize compactly for use):

```json
{
  "schemaVersion": 1,
  "scope": "HRBP_AUDIT_PILOT_TRUST:1",
  "packetSha256": "<SHA-256 of exact packet.json bytes>",
  "customerReference": "<expected packet customer reference>",
  "sourceCommitSha": "<expected 40-character source SHA>",
  "deployedWorkerVersionId": "<expected deployment version>",
  "validFromUtc": "<canonical ISO UTC timestamp>",
  "validUntilUtc": "<canonical ISO UTC timestamp>",
  "approvers": [
    {"role":"CUSTOMER_SECURITY","reviewerReference":"<enrolled reviewer reference>","publicKeyPem":"<Ed25519 SPKI public PEM>"},
    {"role":"LEGAL_RECORDS","reviewerReference":"<different enrolled reviewer reference>","publicKeyPem":"<different Ed25519 SPKI public PEM>"}
  ]
}
```

Only the exact two roles are allowed. Public keys must be single canonical SPKI PEM blocks; private keys, alternative algorithms and duplicate key material are rejected. The two reviewer references must also differ. Each reference must match its corresponding packet approval. Approval declarations may not predate `validFromUtc`. At verification, the policy must be active and its total validity period may not exceed the existing 90-day pilot horizon. The verifier's host clock is a trusted operational input, NOT a TSA assertion.

The policy binds one exact packet as well as its customer, source and deployment context. Any changed packet requires a newly approved policy digest and new signatures. The operator must obtain the current approved pin for every acceptance attempt. Offline verification cannot discover revocation or detect a deliberately replayed old pin that is still within its validity window.

## Detached approval envelope

Exact fields:

```json
{
  "schemaVersion": 1,
  "scope": "HRBP_AUDIT_PILOT_SIGNATURES:1",
  "packetSha256": "<exact packet digest>",
  "trustPolicySha256": "<externally approved policy digest>",
  "signatures": [
    {"role":"CUSTOMER_SECURITY","reviewerReference":"<enrolled reference>","keyId":"<SHA-256 of SPKI DER>","signature":"<64-byte Ed25519 signature, canonical base64>"},
    {"role":"LEGAL_RECORDS","reviewerReference":"<enrolled reference>","keyId":"<SHA-256 of SPKI DER>","signature":"<64-byte Ed25519 signature, canonical base64>"}
  ]
}
```

Each independently controlled approver signs these exact UTF-8 bytes with Ed25519 (no algorithm negotiation):

```js
Buffer.from("HRBP-AUDIT-PILOT-APPROVAL:1\n" + JSON.stringify([
  trustPolicySha256, packetSha256, role, reviewerReference, keyId
]))
```

`pilotApprovalSigningBytes(...)` exports this byte-format helper only. It is not a signing endpoint or an approval decision. The verifier has no signing command, does not generate/read private keys, and never receives application or database credentials. Use the institution's separately approved signing process. The test suite signs synthetic fixtures with ephemeral in-memory keys; those are not production enrollment evidence.

## Verification

```bash
node scripts/audit-pilot-evidence.mjs \
  --packet /approved/packet.json \
  --trust-policy /approved/trust-policy.json \
  --expected-policy-sha256 "$INDEPENDENTLY_APPROVED_POLICY_SHA256" \
  --signatures /approved/signatures.json \
  --evidence-dir /approved/evidence
```

The expected digest is public integrity metadata, not a secret. No `--now` override exists in the CLI. Both signatures are verified before any artifact directory is inspected. Output is bounded aggregate JSON only: decision, assurance level, reason codes, verified signature count and artifact count. Any failure returns `NO_GO`, zero verified counts and exit status 1, without raw paths, key text, customer identifiers, evidence contents or stack traces. Success returns exit status 0, two signatures and twelve artifacts, but still requires independent release authorization.

Underlying provider/API semantics, TSA token validity, legal retention rules and actual deployed revision are NOT independently evaluated by this tool. Correctly signed false documents can still pass. Authenticating their bytes is not equivalent to proving their claims. Existing RFC3161/provider-specific checks and customer review remain required; #209 and #220 remain separate.

## Regression coverage and implementation references

The existing `audit-pilot:validate` command now executes the new signature/artifact cases inside its evaluator suite, without changing the workflow, dependency tree, lockfile or CI permissions. Tests cover real signatures, all twelve file digests, context substitution, missing/wrong keys, same-key dual-role rejection, stale policies, replay, malformed encoding, bounded binary reads, symlinks/hard links, FIFO refusal and real CLI exit/output behavior.

The implementation uses Node's native `crypto.verify(null, ...)` for Ed25519 and hashes public-key fingerprints over SPKI DER. Reference: https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback . No custom signature primitive is introduced.
