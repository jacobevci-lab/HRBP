# Time decision real-browser regression

Platform Regression now executes the same disposable PostgreSQL time-decision scenario through both governed user surfaces: Time & Attendance and Action Center.

For English desktop and Turkish mobile, the suite uses the real local manager sign-in, creates a direct-report employment with an effective schedule and a SUBMITTED TimeEntry, and verifies:
- dismissed confirmation sends no mutation,
- opposite same-turn approve/reject clicks emit one POST,
- the committed state, approver identity and audit evidence are correct,
- notification acknowledgement happens only after a verified receipt,
- notification failure does not roll back a committed rejection,
- HTML/lost browser responses after a real commit become an unknown result and are never retried,
- Action Center filtering and a deliberately stale queue refresh cannot reopen a sealed decision,
- explicit reload checks current state without replaying the transition.

All fixtures are restricted to the flagged loopback hrbp_audit database. The test does not touch production or external providers.
