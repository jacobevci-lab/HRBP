# Unambiguous, bounded S3 evidence JSON

## Correctness fix

The collector and v3 provenance verifier share `parseS3CollectionJson` in `scripts/audit-pilot-s3-readback.mjs`. Previously, raw CLI responses were passed directly to `JSON.parse`; duplicate member names were silently reduced to the last value. For example, a raw object containing both `"Status":"Suspended"` and a later `"Status":"Enabled"` was accepted as enabled. Escaped spellings of the same decoded name had the same problem. Authenticating the raw file digest does not remove this interpretive ambiguity.

The shared reader now inspects the original token stream before native JSON parsing. Duplicate decoded names are rejected within each object, including nested objects, array members and metadata that normalization would otherwise discard. Repeating a name in separate objects is valid. Escape sequences are decoded for comparison; names are not case-folded or Unicode-normalized. Property-looking text inside string values remains data.

This guard supplements, rather than replaces, the native JSON grammar. It neither repairs nor rewrites inputs and is not an RFC 8785 canonicalizer. Raw pretty-printed JSON, standard whitespace, valid Unicode and ordinary finite numbers remain accepted. The existing compact `JSON.stringify(value) + "\n"` encoding requirement for requests and manifests remains unchanged.

## Resource and error contract

Each call requires a non-empty Buffer/Uint8Array of at most **65,536 bytes**, checked before UTF-8 decoding. The scanner is iterative, with at most **32 simultaneously open object/array containers** and **8,192 non-whitespace lexical tokens** (punctuation, strings, numbers and literals each count). These are deliberately bounded evidence-profile limits, not claims that larger JSON is invalid under the general standard. Existing smaller request/manifest file caps still apply.

Malformed UTF-8, BOM, invalid JSON grammar, duplicate names, unpaired surrogate escapes, numbers that overflow the JavaScript finite range, and limits exceeded fail closed. Native parse-error snippets are replaced with the fixed `COLLECTION_JSON_INVALID` error code and generic message. Explicit provider Error/Errors envelopes retain `AWS_RESPONSE_INVALID`. No input member names, values, filesystem paths, credentials or stack traces are returned by the collector/verifier CLI for these failures.

Existing bytes and signatures are not re-encoded. A historical v3 bundle with ambiguous raw JSON is now rejected even if both signatures and every digest are valid. Recollect from an independently approved source; do not edit a signed bundle or discard one of the duplicate fields to make verification pass. Normal v1/v2 schemas, signature payloads and result shapes are unchanged.

## Regression coverage

The fifth mandatory suite, `scripts/audit-pilot-s3-readback.test.mjs`, covers decoded-name collisions, escaped punctuation, per-object scope, prototype-named data, precise byte/depth/token boundaries, malformed inputs, stable pretty JSON and 200 deterministic valid-document comparisons with the native parser.

Integration cases execute the actual collector using local synthetic CLI child processes for all five read operations. Each duplicate-field response must stop collection without publishing a result. Additional cases start with a valid collected v3 bundle, insert ambiguous raw data, refresh all raw/manifest digests and the policy pin, and generate two valid Ed25519 signatures independently of the production helper. Verification must still reject the JSON, not merely fail a stale digest/signature check. CLI failure/non-disclosure and benign raw-byte preservation are also covered.

The suite is appended to `audit-pilot:validate`, retaining the existing prebuild and all-PR-base workflow. Dependencies, lockfile, workflow permissions and application runtime are unchanged. Local synthetic tests do not constitute live AWS acceptance, Object Lock enforcement testing, or full application/CodeQL/platform validation.

## Unchanged assurance boundary

This fix makes evidence interpretation less ambiguous. It does not authenticate AWS as the origin of CLI stdout, prove truthful collection or grant release authorization. All existing independent policy-pin, collector-host custody, retention-profile, current trust-register and human-approval requirements remain. `retention.liveProviderVerified`, `providerAttestationVerified` and `lockEnforcementTested` remain false.

Primary background: RFC 8259 sections 4, 8.2, 8.3 and 9 discuss duplicate-name interoperability, Unicode interpretation and parser limits: https://www.rfc-editor.org/rfc/rfc8259.html
