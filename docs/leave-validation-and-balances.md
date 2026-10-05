# Leave field validation and exact balance comparisons

## Scope

Continue the reviewed 5 October 2026 local patch from main e1e6760. The original
write attempt did not create a remote commit. On resumption the baseline API
blob hashes were verified, the patch was applied, and 115/115 targeted local
tests passed again. Complete head-specific CI and real HTTP/PostgreSQL results
must be recorded in the pull request before merge.

## Defects and changes

The shared JSON reader validates the outer object, not its fields. The previous
leave request/type handlers asserted TypeScript types without runtime checks.
Objects in reason/code/name could throw at trim(); arrays, booleans and empty
values could be coerced to quantities. Invalid enums/flags reached Prisma, and
balance-year parsing accepted invalid or repeated parameters.

Leave-only parsers now validate identifiers, bounded text, enum values and real
booleans before database operations. Dates accept real YYYY-MM-DD dates as UTC
or ISO timestamps with an explicit zone and at most millisecond precision.
Impossible calendar dates and ambiguous/unzoned timestamps are rejected. Units
retain the positive <=366 bound and allowance the 0..3660 bound, both with at
most two decimals matching Decimal(8,2). Strings remain supported; arrays,
booleans, hex/exponent strings and sub-cent precision are not silently coerced.

Omitted/null allowance stays untracked, while explicit zero remains a tracked
zero allowance. Supplied false flags remain false. Overlength text is rejected
instead of silently truncated. Duplicate type codes use Prisma P2002 and return
409; malformed fields and repeated/invalid year values return 400. Missing year
still uses the current UTC year. No global date/JSON helper changes.

Both automatic and manual approvals now compare exact integer hundredths for
the bounded Decimal(8,2) columns. This prevents binary subtraction, such as
0.30 - 0.20, from incorrectly rejecting a 0.10 request. Unexpected stored
precision fails rather than rounding. Existing transactions, relationship and
tenant scopes, self-approval prohibition, audit events, notification outbox and
cancellation implementation are retained. No existing stored balance is changed.

## Verification

The 115-case unit suite executes actual TypeScript parser/API modules with
instrumented identity/database dependencies. It covers field validation, dates,
precision boundaries and existing authorization/origin/audit wiring. These
fixtures are not real concurrency or rollback evidence.

The additional mandatory scripts/leave-api-regression.mjs stage uses real local
HTTP sign-in, Prisma and PostgreSQL after existing disposable identities are
prepared. It tests malformed fields, pending/automatic/manual approval, exact
balance debits, rejection, pending/approved cancellation, repeated operations,
audit/notification counts, manager self-approval denial and competing requests
for the same remaining balance. It accepts only loopback PostgreSQL hrbp_audit
with the explicit disposable flag; the application origin is fixed to localhost.
No credentials or cookies are included in the JSON evidence. Fixtures remain
only in the temporary CI database. All previous browser and remediation stages
remain in the pipeline; a prior head's successful run cannot certify this one.

## Limits

This does not calculate units from a holiday calendar, change UTC balance-year
policy, redesign carry-over, certify legal entitlements or test every browser
form/specialist role/external payroll provider. No production data, migration,
dependency version, secret, provider setting or permission changes. Green tests
alone do not establish a live Cloudflare rollout.
