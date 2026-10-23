# HR service read compatibility and visible counts

The legacy request-list `_count.comments` now counts only messages the requesting
principal may read in the same tenant. A requester with one public reply and two
private HR notes sees one, not three. Service staff with request access still see
all three. This is a filtered total, not a claim that all messages fit in the old
300-row comments endpoint.

Both legacy GET paths now apply `Cache-Control: private, no-store`, `Vary: Cookie`
and `X-Content-Type-Options: nosniff` to successes and denials, including bounded
503 errors. The legacy comment GET keeps its original `{data: [...]}` envelope,
row fields (including authorId for compatibility) and 300-row limit, but uses
`createdAt,id` for deterministic ordering and one repeatable-read transaction
for scoped ticket and message reads. New clients needing full history should use
`/conversation` keyset pages instead of silently treating 300 rows as complete.

Private notes are allowed only for scoped HRBP, HR_OPERATIONS and TENANT_ADMIN
principals. EMPLOYEE and MANAGER receive REQUESTOR comments only. Current LEGAL
and SECURITY_AUDITOR roles have no hr-service:read grant and remain denied; an
isolated hypothetical-grant unit test is defense in depth, not evidence those
roles could access real service data before this change. Supported visibility
values are allowlisted, with tenant filtering also applied to relation counts.

No POST bodies, write-revision contract, original notes, role grants, schema or
historical evidence are changed. The new conversation endpoint is unchanged.
Already disclosed values cannot be recalled, and snapshot reads do not provide
instant revocation or a historical author directory snapshot.

Verification: `node --test scripts/hr-service-read-privacy.test.mjs` executes the
real handlers with database doubles and the actual current capability table.
The new disposable localhost-only `hr-service-read-privacy-browser.mjs`
adds six real API/PostgreSQL cases for scoped counts, hidden-note additions,
cross-tenant inconsistent rows, legacy shape/no side effects, denial headers,
and deterministic 300-row windows. Full workflow results must be checked for
the exact resulting commit; local doubles alone do not prove SQL acceptance.
