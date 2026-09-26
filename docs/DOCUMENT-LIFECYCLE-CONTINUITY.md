# Document lifecycle continuity

The Documents workspace is the governed HR document vault for non-case employee records. This work connects lifecycle links and operational expiry attention to that existing vault rather than creating a second attachment or evidence subsystem.

## Lifecycle routing

The module accepts three governed lookup paths:

- `?q=<term>` for bounded vault search.
- `?document=<documentId>` for an exact document deep link.
- `?person=<personId>` for the visible document set of a lifecycle subject.

`app/module/[slug]/page.tsx` converges the exact document/person lifecycle parameters into the existing Documents search path. `getDocumentWorkspaceData` then intersects the lookup with `documentVisibilityWhere`; there is no unscoped fallback. A stale or inaccessible deep link therefore resolves to an empty governed result rather than confirming that a hidden record exists.

Notification resources with type `DocumentRecord` resolve to the exact `?document=` path.

## Lifecycle Action Center

Documents that have an explicit `expiresAt` date and are already expired or will expire within the next 30 days can enter the Lifecycle Action Center. This is an operational attention signal, not a second document store and not an automatic mutation.

The source query:

1. requires `documents:read`,
2. reuses `documentVisibilityWhere(db, ctx)`,
3. keeps the existing tenant, relationship, explicit-grant and classification restrictions,
4. keeps Employee Relations evidence excluded through `caseId: null`,
5. reads only the minimal metadata required for an authorized action row, and
6. deep-links back to `/module/documents?document=<id>` so any follow-up occurs inside the governed vault.

Expired visible documents are treated as critical through the common due-date urgency model. Records expiring within 24 hours are attention/warning items; the remainder of the 30-day window stays normal until it approaches expiry.

The Action Center does not load `objectKey`, version object keys, hashes, malware scan narratives or document contents. It also does not modify, archive, renew or delete a document directly. Document lifecycle mutations remain inside the Documents domain and its existing authorization/audit controls.

## Dashboard and Analytics continuity

Because Dashboard and Analytics consume Action Center summaries, document expiry contributes to aggregate `total`, `critical`, `overdue` and `dueSoon` counters automatically.

Analytics additionally receives an aggregate `documents` counter. It never receives filenames, purposes, document IDs or other row-level document metadata. The analytics helper reuses the Action Center result and performs no direct document query or broader fallback.

The Analytics Documents shortcut routes to `/module/workflows?view=documents`, which remains an actor-scoped Action Center filter. Opening an individual item then uses the governed exact-document route above.

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

`npm run document-lifecycle:validate`, `npm run lifecycle-action-center:validate` and `npm run lifecycle-analytics:validate` collectively verify that:

- tenant/relationship/classification scope remains in place,
- exact document and person deep links reuse the existing governed scope,
- case evidence remains excluded from the generic vault,
- browser/API projections do not expose private object keys,
- deletion still enforces legal hold and retention,
- uploads remain malware-gated,
- document notifications route into the governed vault,
- Action Center document attention requires `documents:read` and the existing document visibility helper,
- the expiry query is bounded to actionable expiry-bearing records,
- Action Center never reads private storage capabilities or scan narratives, and
- Analytics receives only aggregate document attention.

These validators are part of `prebuild` so CI/builds fail if the lifecycle or privacy invariants regress.
