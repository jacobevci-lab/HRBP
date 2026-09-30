# Document signer participant lifecycle

## Purpose

This increment separates document-signature administration from the human signer decision. Operators may create governed signature envelopes, while an employment-bound participant can act only on their own participant record when their signing order is active.

## Authorization boundary

A participant decision requires an authenticated request with `documents:read` and a signed `employmentId`. The exact participant must belong to that employment identity, the document must remain inside normal governed document visibility, and Employee Relations case evidence remains excluded by the existing generic document boundary.

Employee and Manager roles are not granted the administrative `documents:sign` capability for this flow. Signer authority comes from exact envelope participation plus signed employment identity.

## Signing order and immutable document

Only `PENDING` or `VIEWED` participants on `SENT` / `IN_PROGRESS` envelopes are actionable. Every lower signing order must already be `SIGNED`. Same-order participants may act independently.

The envelope must remain bound to an uploaded `CLEAN` immutable `DocumentVersion`. An expired envelope is rejected for signing; the signer action does not silently mutate it to `EXPIRED`.

## Human decisions and evidence

The signer explicitly chooses `SIGNED` or `DECLINED`.

- `SIGNED` records the participant timestamp and moves the envelope to `IN_PROGRESS` until all participants have signed. The final signature moves the envelope to `COMPLETED`.
- `DECLINED` records the human rejection and moves the envelope to `VOIDED`.

Each decision writes an immutable `SignatureEvent` and an audit event. The transition executes serializably and uses a state-aware participant update to reject concurrent or stale decisions.

## Lifecycle Action Center

The shared Action Center surfaces an employment participant only when the signer is currently actionable. The row includes only minimal routing context and reuses the existing `documents` source/privacy boundary. It does not project signer email addresses, content hashes, storage keys or scan narratives.

The action deep-links to `/module/documents/sign/<participantId>`. The signing workspace resolves the participant again against the signed employment identity and governed document scope. Invalid or manipulated IDs fail closed and never trigger a broader participant lookup.

## Dashboard and Analytics

No new sensitive projection is added. Signer attention remains part of the existing aggregate Documents lifecycle count, so Dashboard and Analytics continue to receive counts only.
