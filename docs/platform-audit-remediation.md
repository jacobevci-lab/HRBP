# Platform audit remediation (3 October 2026)

Baseline: c1f20ba92e13021977886d63733078e95818ecef; findings in PR #94.

## Changes
- Both logout controls use native POST forms. GET/HEAD/prefetch never clears the cookie. POST requires a same-origin Origin header and rejects cross-site Fetch Metadata.
- API contexts and server-rendered page contexts validate the current tenant-scoped account, active state, subject, role, email, employment linkage and local credential revision. Verification is not cached across requests. Database verification failure denies access instead of accepting a stale cookie.
- New sessions identify their authentication method. Old sessions without that marker must sign in once after rollout. Local password reset and disabling local sign-in invalidate matching old local sessions at the next request; OIDC sessions remain independent of local-password availability.
- Cookie parsing ignores malformed unrelated values and rejects duplicate authentication cookies without throwing. Signed payloads require a valid finite expiry, exact signature format and bounded claims.
- A shared safe return-path validator is used in login, the sign-in page, the client redirect and the OIDC callback. Protocol-relative, backslash, encoded-separator and control-character paths are rejected.
- Seeded passwords now use the canonical six-field format. Existing hashes affected by the precise historical delimiter bug can still authenticate only with the correct password and are upgraded on that successful login. Conditional login updates cannot overwrite a concurrent password reset, account deactivation or lock.
- All 72 formerly direct JSON-reading API files now validate a bounded object before field access. The shared reader rejects malformed JSON, arrays/scalars/null, invalid UTF-8 and bodies above 64 KiB. Existing domain capability, scope, lifecycle and audit checks remain in place. Invalid requests are rejected rather than using an implicit bulk retry default; send an explicit object for that action.
- Governance workspace labels, empty states and explanatory text use the selected locale. Workflow filters/headings wrap within narrow screens rather than hiding body overflow. Payroll self-payslip capability is included in the navigation projection.

## Verification
The new helper suite executes real auth/redirect/body-reader implementations with mocked account storage; it also checks every request-context consumer is awaited. Existing quality gates remain enabled.

The Platform Regression workflow builds the application with disposable PostgreSQL and synthetic accounts. It runs the audit collector plus principal-verified Chromium navigation WITHOUT intercepting logout requests. The remediation gate fails on unsolicited logout, bad seed login, JSON/cookie 5xx, unsafe redirects, disabled/role-changed/password-reset sessions, broken rendered links, viewport overflow and the reported untranslated workspace labels. A successful collector by itself is not a passing gate.

## Scope and rollout limits
No schema migration, production configuration, secrets, Cloudflare plan or customer data are changed. The legacy-hash upgrade is account-specific and only occurs after a valid login; it does not reset passwords or run staging seeds in production.

Immediate account validation adds database reads to authenticated requests. React cache only deduplicates server-component session resolution within one render request. Measure database and Worker resource budgets under production load.

This is not a new durable server-side session store: logout removes the browser cookie, but copied bearer cookies are not individually denylisted. Account deactivation/role changes are checked on subsequent requests, not a cancellation of already-running transactions. Re-enabling an unchanged account can make an otherwise unexpired cookie valid again. Distributed session revocation, idle timeout and live identity-provider revocation remain separate improvements.

The test suite is Chromium-only and does not establish all CRUD/approval/export journeys, external OIDC, payroll, AI, storage or notification-provider success. A green GitHub build is not proof of Cloudflare rollout or production health. The earlier Cloudflare deployment failure needs provider build logs before assigning a root cause.
