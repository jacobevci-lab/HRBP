# Action Center: reported source health

Baseline: 3aed613552be3759daf59a29ef3bdce710182314 (PR #104).

## Scope

The aggregate already reports nine `*Degraded` flags. This increment makes those flags visible in the existing Action Center without creating another module or fetching another queue. It does not change server source loading, authorization, record scope, transitions, notifications, balances or schemas.

A reported failure produces a localized partial-list notice naming the affected sources. Missing flags are unknown, never implicitly false. Present flags must be booleans; malformed flags reject the snapshot through the existing unavailable path. When all nine flags are explicitly false, no failure notice is shown. This is **not** a claim that every domain loaded completely: unreported failures, bounded item lists and server truncation policies remain outside this contract.

While a current snapshot is partial or unknown, summary counters display an em dash. The returned/filtered row count is explicitly labelled as loaded records. An empty filtered subset cannot claim there is no pending work; it explains that missing sources may contain other work. Verified returned rows remain usable, under the same domain-owned permissions and existing decision guards. These read-status flags are not authorization grants or a mutation receipt.

The latest successful queue read owns both rows and source metadata. The existing superseded-read guard applies to both. Loading/transport failure marks metadata unverified, not current. Explicit session/access failure clears rows and source metadata. Manual Refresh preserves existing local filters and leave-attempt registry, and does not replay a business mutation.

## Tests

`node --test scripts/action-center-source-health.test.mjs`

This executes actual TypeScript helper/decoder/view code with controlled React and transport dependencies. The registry-to-server test checks the propagated flag names, not real database outages. All existing suites remain in Platform Regression; the new suite and `node scripts/action-center-source-health-browser.mjs` are mandatory additions there. Existing prebuild validation is unchanged.

The browser stage requires flagged disposable loopback PostgreSQL `hrbp_audit`. It logs in as the existing synthetic manager, reads the real queue, and then alters only browser-facing source flags. It covers EN desktop/TR mobile, partial and missing states, invalid booleans, empty subsets, all-source notice sizing, explicit recovery, identity and absence of domain writes. Report: `.audit/action-center-source-health-browser.json`.

The browser fixture is not a database outage, real SSO test, production probe or full business-process QA. The separate Cloudflare provider failure is not addressed here.
