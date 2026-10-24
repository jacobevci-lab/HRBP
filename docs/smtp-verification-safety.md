# SMTP verification: acceptance, audit and concurrency

The settings test is limited to the current active administrator's own address.
An account-row lock serializes the 60-second audit-backed reservation at READ
COMMITTED, so a waiter sees the previous committed reservation. Eligibility,
role and recipient are reread under the lock. SMTP I/O happens after commit,
never under the account/audit transaction. A failed reservation cannot send.

`x-hrbp-test-id` is an optional UUIDv4 correlation value, not a durable idempotency
key or authorization credential. Legacy requests without it still get a generated
value. The response binds it to actor and tenant. No supplied recipient is used.

A 200 result means SMTP accepted the message AND the outcome audit was recorded.
A 202 result means SMTP accepted it but the outcome audit failed; do not resend to
repair that audit. Neither result proves arrival in a recipient mailbox. Provider
failure after DATA can be ambiguous; 502 is an unknown acceptance outcome, not
proof that no message exists. Existing audit action names are preserved, with
accurate purposes. No historical events are rewritten. Configuration/reservation
failure is 409/503; a prior reservation is 429 with Retry-After 60. All explicit
responses are private/no-store. A crash after reservation still needs operator
reconciliation; the limit does not provide permanent command deduplication.

Transport cleanup cannot undo an accepted send or mask a bounded provider error.
Only the intended single recipient may be reported accepted. TLS verification,
mandatory TLS, file/URL access restrictions and pinned dependencies remain intact.

The EN/TR settings action requires confirmation, synchronously gates duplicate
clicks and verifies the exact correlated response. Unknown/partial/denied results
are never auto-retried. Transient session changes retain bounded outcome phases;
full reload/unmount discards local memory and must be explicit. No provider error
text, recipient address or credential is kept in the client outcome map.

Validation: smtp-verification.test.mjs uses actual source with dependency doubles.
smtp-verification-browser.mjs starts a separate production application on loopback,
uses disposable PostgreSQL and a real authenticated TLS SMTP capture server with a
temporary trusted test certificate. The capture server has no relay mechanism and
accepts only example.test recipients. It verifies server-side acceptance, not a
real corporate provider, Internet transport, mailbox arrival, spam placement or
bounce processing. Existing UI/API suites rerun unchanged alongside this suite.

Protocol basis: RFC 5321 section 6.1 distinguishes SMTP responsibility for delivery
or relaying from final delivery: https://www.rfc-editor.org/rfc/rfc5321.html#section-6.1
Prisma v6 transaction isolation: https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions
