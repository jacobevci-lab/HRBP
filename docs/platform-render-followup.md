# Audit download and mobile layout follow-up

Application baseline: PR #95 head `999ba950404282766eb1e008e3d223e34f463ddc`.
Continuation date: 3 October 2026. This follows `platform-audit-remediation.md`.

## Evidence before the fix

Isolated Render Diagnostics run `37116099691` reproduced the Audit navigation
stall without changing application source. The page returned HTTP 200 and
rendered its ledger. An unsolicited `/api/audit/export` fetch carried
`next-router-prefetch: 1` and `rsc: 1` and remained pending. A separately labelled
diagnostic context that suppressed only that export request reached network
idle. That interception is not used by the natural regression tests. The
baseline artifact is `11271741028` (seven-day Actions retention).

The native CSV attachment endpoint is not a React page. Its control now uses
an ordinary anchor with `download`, not Next Link. This removes automatic
export prefetch and avoids client-side page navigation for downloads. Audit
query limits, integrity verification, tenant/capability guards and CSV filters
are unchanged. An actual filter-and-download test checks the resulting file.

The mobile diagnostic reproduced a document width of 404px in English and
393px in Turkish at a 390px viewport. The earlier patch referred to a
nonexistent `workflow-decision-history-filters` class. The real history controls
use `workflow-history-controls`; its selects have intrinsic minimum widths.
The fix uses zero-minimum grid columns, bounded selects and wrapping buttons.
Wide tables retain independent horizontal scrolling. No body clipping is used
to hide overflow. A column-oriented search field also no longer inherits a
200px flex height.

## Regression coverage

`platform-render-regression.mjs` signs in using the actual local-account form.
It confirms that opening and hovering the Audit export control sends no export
request, toggles EN/TR while waiting for server-rendered locale evidence,
applies actor/action/resource/classification/date-window filters, clicks the
control, saves and parses a real CSV and checks its contents. It also verifies
that the page and principal remain intact and anonymous export is denied.

Workflow controls are tested after their data loads in EN/TR, light/dark and
320/390/768px viewports (12 combinations). Checks cover document width,
reachability of the native select/export controls and local table scrolling.
This is not an accessibility certification or testing of every responsive
interaction.

Four AST/wiring tests complement these real-browser tests. They are labelled
as wiring tests, not user workflows. The existing auth remediation suite and
both broad browser sweeps remain enabled. The final gate now checks primary
sweep navigation/errors and mobile overflow as well as the principal-verified
sweep; a later clean view cannot hide an earlier failed one.

A server-locale marker is emitted by Audit and the governed workspaces. Their
locale tests wait for that marker instead of treating the immediately changed
client toggle state as proof that server content was translated. This does not
assert complete translation of every unrelated module.

## Boundaries and delivery

The source-bound temporary apply workflow changes only the reviewed PR branch;
it is removed before final validation and merge. The earlier workflow-token
attempt to modify workflow files was rejected by GitHub permissions; no ref
was moved by that rejected push. Source changes and authorized connector
workflow edits were performed separately. No permission was broadened.

No schema migration, production secret or production database operation is
part of this follow-up. Existing account-validation changes require one new
sign-in for old untyped sessions after deployment. A green GitHub run is not
proof of a Cloudflare rollout or live provider health. Refer to PR #95 and its
final workflow artifacts for actual pass/fail results at the tested source
head; collecting an artifact alone is not a release sign-off.
