# Document lifecycle continuity

The Documents workspace is the governed HR document vault for non-case employee records. This batch connects lifecycle links to that existing vault rather than creating a second attachment or evidence subsystem.

## Lifecycle routing

The module accepts three governed lookup paths:

- `?q=<term>` for bounded vault search.
- `?document=<documentId>` for an exact document deep link.
- `?person=<personId>` for the visible document set of a lifecycle subject.

`app/module/[slug]/page.tsx` converges the exact document/person lifecycle parameters into the existing Documents search path. `getDocumentWorkspaceData` then intersects the lookup with `documentVisibilityWhere`; there is no unscoped fallback. A stale or inaccessible deep link therefore resolves to an empty governed result rather than confirming that a hidden record exists.

Notification resources with type `DocumentRecord` resolve to the exact `?document=` path.

## Security boundary

`DocumentRecord.objectKey` and `DocumentVersion.objectKey` are private object-store capabilities. They are intentionally server-only and are no longer serialized by the public Documents or Document Versions APIs. API responses use explicit projections from `lib/document-public-projection.ts`.

The object key remains available only to server-side storage operations such as immutable upload and download handling. Download still requires:

1. authenticated `documents:read` authority,
2. governed document visibility/download scope,
3. an existing stored version, and
4. malware scan status `CLEAN`.

Logical deletion returns only the document id and status and continues to enforce legal hold and retention gates.

## Employee Relations separation

The generic vault deliberately retains `caseId: null` in `documentVisibilityWhere`. Employee Relations evidence is therefore **not** made visible by document lifecycle continuity. Case evidence must continue to be resolved through the Case Wall and its own highly restricted authorization path.

This separation is intentional: lifecycle continuity may reuse the document storage primitives, but it must not collapse the security boundary between ordinary employee records and investigation evidence.

## Validation

`npm run document-lifecycle:validate` verifies that:

- tenant/relationship/classification scope remains in place,
- exact document and person deep links reuse the existing governed scope,
- case evidence remains excluded from the generic vault,
- browser/API projections do not expose private object keys,
- deletion still enforces legal hold and retention,
- uploads remain malware-gated, and
- document notifications route into the governed vault.

The validator is part of `prebuild` so CI/builds fail if these invariants regress.
