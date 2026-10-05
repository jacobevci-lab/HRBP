# Action Center queue resilience

Baseline: cfa8d78ee376cafa191e95f6db3d8d5482d2b7f0 (PR #102).

## Product behavior

Keep one domain-owned lifecycle queue, existing navigation, local filters and visual classes. This increment hardens the shared read path, not the business decision engines.

- Only a complete, decodable JSON queue is displayed as a current snapshot. HTTP 200, missing data or an empty response alone are not success.
- A superseded read is aborted and its completion is ignored even if the transport ignores cancellation. Effect cleanup invalidates pending reads. No automatic retry loop.
- Reads target only GET /api/action-center, with same-origin credentials, no-store and redirect rejection. The response is bounded to 4 MiB / 5,000 rows and 15 seconds, including streaming. Current server limits remain unchanged.
- Validate consumed item fields, dates usable by the view, unique row keys, known quick-action shapes, complete nonnegative integer counters and canonical module navigation. Exact query/focus parameters are preserved. Invalid snapshots are rejected as a whole, not silently filtered.
- While loading or unavailable, counters show an em dash, not fabricated zeros. Previously verified rows are retained with a stale notice and disabled quick mutations. Explicit 401/403 clears those protected rows.
- A successful explicit refresh preserves local search/source/actionable-only settings (the existing initialTaskId/initialInstanceId focus behavior still selects All) and never replays a domain write. A read time is displayed using the existing locale-aware date formatter.
- The PR #102 leave attempt registry is not cleared by queue refresh. The existing leave decision control and server authorization remain authoritative.
- Non-leave generic buttons also check readiness and an in-flight lock before sending. Their domain-specific receipt validation/unknown-result recovery is NOT redesigned by this increment.

## Verification

`node --test scripts/action-center-queue.test.mjs scripts/action-center-leave.test.mjs`

The new queue suite executes actual TypeScript decoder/loader/view code with explicitly controlled React and transport dependencies. The existing 50 leave tests stay intact, with only the new reader import added to the structural harness. Lifecycle prebuild validation also executes both suites. Platform Regression adds a mandatory real Chromium stage:

`node scripts/action-center-queue-browser.mjs`

It requires a flagged disposable loopback PostgreSQL database named hrbp_audit and uses the existing synthetic manager account after platform-audit. It verifies real form login and real queue decoding, then injects controlled malformed/missing/HTML/stale/session responses; English desktop and Turkish mobile. It verifies filtering, disabled time-decision buttons, no domain writes, recovery and principal preservation. Output: .audit/action-center-queue-browser.json. Other regression stages remain mandatory and in their prior order.

## Limits

A structurally valid snapshot does not prove every upstream domain/source was available. Existing server-side partial-source/fallback policies are unchanged. Generated-at is the server's snapshot timestamp, not a promise of completeness or a durable version. No polling, cross-tab coordination or persistent idempotency is added. This is not a complete redesign of payroll/time/compensation mutation recovery, nor a claim of full platform QA or live deployment. No schema, production data, dependencies, secrets, provider settings or tenant permissions are changed. The previously observed independent Cloudflare provider build failure is outside this patch.
