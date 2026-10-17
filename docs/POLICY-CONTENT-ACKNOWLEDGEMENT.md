# Policy reading and acknowledgement content binding

## User flow

An assigned employee opens **Read policy / Politikayı oku**. The native dialog retrieves the currently effective assigned policy through GET `/api/policies/{id}/acknowledgements`, displays its title, version and literal Markdown/text, and independently hashes the received UTF-8 content before enabling acknowledgement. Policy markup cannot create scripts, images, external network requests or active links. The reader is keyboard accessible, supports Escape and restores its trigger focus. EN/TR copy and narrow layouts are scoped to this reader.

Checking **I have read this version** enables the explicit acknowledgement confirmation. This is a user assertion, not proof of comprehension, scrolling or an actual human reading the whole document. No automated time/scroll threshold manufactures that claim.

## Wire contract and concurrency

POST now requires a bounded JSON object containing the displayed `policyVersion` and lowercase 64-character `contentHash`. Missing old-client payloads return 400; there is intentionally no fallback to the newest content. Existing authority, tenant, employment, assignment, effective-date and waiver checks remain. Under the existing employment/policy/assignment locks, the endpoint rereads the published policy and checks both the requested version and hash, including SHA-256 of its actual stored bytes. A same-version edit, version change or inconsistent stored hash returns 409 without writing a receipt. Parent locks prevent a concurrent policy edit from committing halfway through acknowledgement.

The employee preview is a private, no-store read, not a public document endpoint. It returns only the selected assigned document, not other employees' data or assignments. It may become stale after it is read; POST is the authoritative locked decision. Broken/missing/corrupt previews cannot enable a write. Reads retry only on an explicit user action. Closing and reopening an already-loaded reader retains the snapshot and the mounted action's unknown/saved-result guard, rather than silently refreshing content or allowing blind write replay.

## Persistent content binding without rewriting evidence

For new acknowledgements the original `policy.acknowledged` event and a distinct server-selected `policy.acknowledgement-content-bound` event have a canonical JSON `purpose`:

`{"schema":"policy-ack-content/v1","version":"...","contentHash":"..."}`

Both events include this payload in the existing audit hash-chain calculation and are committed atomically with the receipt and assignment change. The established acknowledgement action is retained for consumers; the additional distinct action proves that the new server content contract ran. A legacy acknowledgement purpose alone cannot establish this: earlier versions accepted caller-supplied `x-purpose` values. The new route overrides caller purpose for both events, and an old purpose mimicking this JSON cannot substitute for the distinct binding event. It stores no policy text, credentials or additional employee data. The receipt retains its existing schema and original actor/time/IP. The API's `policyContentHash` response field is a verified projection of this audit binding, not a mutable new column.

A replay returns the original receipt only when exactly one original, tenant-scoped acknowledgement event AND exactly one server-selected content-binding event bind that receipt to the same version/hash and original actor. Missing, duplicate, legacy or inconsistent bindings fail with 409; they are not reconstructed from today's document and no historical timestamp, IP, receipt or audit event is overwritten. A historical acknowledgement can still appear as historical in the existing read model; this release does not claim to retroactively content-bind it. Pruning/removing either audit event also prevents this endpoint from returning a content-verified replay. Retention planning must preserve the receipt and both associated events.

This does not independently verify the entire audit chain on each request, create a trusted off-platform archive, preserve deleted document bytes, implement digital signing or prevent a fully privileged database attacker from rewriting the trust domain. Approved policy versions should remain immutable and new revisions should be new policy records; privileged fixture edits exercise the rejection boundaries, not a new production edit feature.

## Rollout and acceptance

No schema migration or automatic repair is introduced. Quiesce incompatible old clients during rollout; reload old browser tabs before using acknowledgement. Do not bypass a 409 by fabricating hashes or editing old evidence. Resolve legacy inconsistencies through the governed record-review procedure.

Regression gates retain earlier authorization, duplicate submission, waiver, retirement, termination, eight-request replay and unknown-response cases, and add strict snapshot validation, same-version/version-change SQL lock races, original audit-hash binding, legacy evidence rejection, read failure, literal markup, narrow keyboard-accessible reading and stale-preview browser acknowledgement. A green Chromium/disposable PostgreSQL gate is not customer UAT or production deployment evidence.
