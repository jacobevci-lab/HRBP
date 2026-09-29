# Document access and signature governance

This control plane hardens two privileged document operations: delegated access and signature envelope creation.

## Delegated access

Document grants remain subordinate to the existing governed document visibility boundary. A grant operator must already be authorized to see the document and hold `documents:grant`.

Grant inputs are bounded and allow-listed:

- principal type: `USER` or `EMPLOYMENT`
- permission: `READ`, `DOWNLOAD` or `SIGN`
- principal identifiers use the shared bounded identifier parser
- purpose is optional but limited to 500 characters
- expiry, when supplied, must be a valid future date

Employment principals are additionally checked with `employmentPrincipalsWithinScope`. This prevents a scoped operator from using document delegation to bridge into unrelated employment relationships. User principals must resolve to an active user in the same tenant.

Grant reads are bounded and grant revocation validates both document and grant identifiers before entering the transaction. Create/update/revoke operations remain audited.

## Immutable signature target

A signature envelope must describe the exact bytes that were sent for signature. Linking an envelope only to a mutable `DocumentRecord` is insufficient because a later document version could otherwise make the evidence ambiguous.

New envelopes therefore persist `documentVersionId` and are created only when the selected latest version:

1. belongs to the same tenant and document,
2. has been uploaded, and
3. has malware scan status `CLEAN`.

The `envelope.sent` evidence event records the immutable version id, version number and SHA-256 content hash. Existing historical envelopes remain compatible because `documentVersionId` is nullable during rollout; every newly created envelope is pinned.

## Signer validation

Signature creation accepts at most 50 participants per envelope. Inputs enforce:

- title length <= 200 characters,
- valid future envelope expiry when supplied,
- bounded employment identifiers,
- normalized/validated external email addresses,
- integer signing order from 1 through 1000,
- no duplicate employment signer,
- no duplicate email signer,
- all employment signers inside the actor's authorized relationship scope.

External email signers remain supported intentionally. They do not bypass document authorization: only an authorized `documents:sign` actor can create an envelope, and the envelope is pinned to a CLEAN immutable version.

## Read bounds and evidence

Envelope history is bounded to 100 envelopes per request, participants to 100 per envelope and signature events to 200 per envelope. Version metadata returned with signature evidence excludes the private object-store key.

`npm run document-access-signature:validate` is included in `prebuild` and protects these invariants in CI.
