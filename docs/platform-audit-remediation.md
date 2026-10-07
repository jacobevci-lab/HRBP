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

The later session-revocation hardening adds tenant/account session versions and tenant maximum-session enforcement on every verified request. Copied cookies can therefore be invalidated centrally without waiting for their signed expiry. Revocation still applies at the next request boundary; it does not cancel an already-running transaction. Live identity-provider event/revocation integration and true idle-timeout tracking remain separate improvements.

The test suite is Chromium-only and does not establish all CRUD/approval/export journeys, external OIDC, payroll, AI, storage or notification-provider success. A green GitHub build is not proof of Cloudflare rollout or production health. The earlier Cloudflare deployment failure needs provider build logs before assigning a root cause.

## Build-tool dependency exception avoided

During verification on 3 October 2026, the full dependency audit began reporting
GHSA-vfj7-8cjw-p6xm through the Next lint plugin's fast-glob/micromatch/braces chain.
The advisory currently lists no patched braces version. This change does not
suppress the advisory, disable full auditing or downgrade the Next.js runtime.
Only the official `@next/eslint-plugin-next` is pinned to 14.2.35 (glob-based),
with its glob dependency at 10.5.0; eslint-config-next remains on 15.x.
`lint-compat:validate` checks all 21 existing rule names and configured severities,
React/TypeScript configuration and three executable ESLint 9 fixtures. These
checks are not proof that every older rule implementation is identical. Review
and remove this temporary tooling pin when an audited compatible release drops
vulnerable braces. Full npm audit remains a required gate.
