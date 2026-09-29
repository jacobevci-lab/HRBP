# Document signature lifecycle continuity

## Scope

This increment turns the existing hardened signature API into an operator-visible document lifecycle surface without inventing a second document model or an unimplemented employee signing engine.

The Employee Document Vault remains the owning workspace. Signature envelopes remain bound to one immutable uploaded `DocumentVersion`; new envelopes continue to require a malware-scanned `CLEAN` version before they can be sent.

## Vault signature console

A user who can read a governed document may inspect the document-scoped signature evidence returned by the existing signature endpoint. A user with `documents:sign` may also create a signature envelope from the same document row.

The console supports:

- bounded envelope title and optional expiry;
- ordered employment or external-email signers;
- up to the backend-enforced 50 participants;
- signer status and timestamp visibility;
- immutable version number / scan-state context;
- a bounded evidence-event timeline.

Storage keys, object-store internals, content hashes and malware-scan narratives are not rendered in the signature console.

## Exact focus

Signature follow-up links use `/module/documents?document=<documentId>&envelope=<envelopeId>`.

The existing document query first resolves the document through `documentVisibilityWhere`. Only the resulting governed document row mounts the signature console. The console then calls the document-scoped signature endpoint and focuses an envelope only when it is returned inside that exact document scope. A manipulated or stale envelope id produces a fail-closed warning; no broader envelope lookup is attempted.

## Lifecycle Action Center

Signature follow-up is kept inside the existing **Documents** attention kind instead of creating another cross-domain data surface.

An envelope enters shared attention only when:

- the signed actor has both `documents:read` and `documents:sign`;
- the actor originally created the envelope;
- status is `SENT` or `IN_PROGRESS`;
- it has an expiry date within the next 30 days or is already overdue;
- its parent document is still visible through the existing governed document visibility predicate.

The Action Center receives only the minimum routing context: envelope id, document id/name, envelope title, status, expiry and creation timestamp. It does not load signer identities, signature events, document versions, content hashes, storage keys or scan evidence.

The Action Center performs no signing or envelope status mutation. It deep-links the operator back to the owning Documents workspace.

## Dashboard and Analytics

Signature follow-up contributes to the existing aggregate `documents` attention counter. Dashboard and Analytics do not receive envelope rows, signer details, document metadata or signature evidence.

## Failure isolation

Signature attention is fail-soft. If the signature aggregation path is unavailable, the existing Workflow, HR Service, Employee Relations, Documents, Work & Pay, Growth, Onboarding and Offboarding attention remains available. The degraded signature source is reported separately in the continuity result.

## Validation

`npm run document-signature-lifecycle:validate` checks exact-focus scope, capability gating, owner binding, active states, bounded queries, privacy minimization, fail-soft behavior and aggregate-only Dashboard/Analytics continuity. It is part of `prebuild`; repository CI remains authoritative for Prisma validation, typecheck, Next.js build, Cloudflare build and smoke tests.
