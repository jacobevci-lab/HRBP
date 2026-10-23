# HR Service conversation reader

This continuation adds a read-only conversation dialog to each visible lifecycle
row, including closed/cancelled requests. The original description and message
bodies are rendered as literal text, with current author display names, explicit
public/private badges and UTC timestamps. No message text is executed as markup.

The new GET /api/hr-service/requests/[id]/conversation uses the existing verified
session, hr-service:read capability and hrServiceRequestWhere scope. All response
paths use private/no-store headers. Only HRBP, HR_OPERATIONS and TENANT_ADMIN
service roles receive PRIVATE_NOTE rows, within that same request scope. Other
readers receive REQUESTOR rows only. Unknown visibility types are excluded.
Neither private-note counts nor author emails/internal author ids are returned.
This does not change the older comments API or claim a global privacy audit.

A page contains at most 50 messages, displayed oldest first. The initial page is
the latest 50. A before cursor is resolved inside the current tenant, request and
visibility scope before paging by (createdAt,id). An invisible/foreign cursor
returns the same unavailable response. Equal-time messages have deterministic
ordering. Each response is read under one RepeatableRead transaction; separate
page requests are not a durable snapshot/export of a changing conversation.

Older pages replace the current page, keeping browser message memory bounded.
Refresh latest messages returns to the current latest page. There is no polling,
read-induced write, marking-read mutation or automatic retry. Closing discards
history and aborts pending reads; reopening always reads again. A key/principal
change hides the old content. Late completions cannot replace the current page.
Failed refresh/reauthorization removes previously visible text, rather than
retaining a stale private page. Already disclosed data cannot be recalled, and
session changes are observed through the existing session provider.

Response contracts bind request/tenant/viewer/role and requested page, validate
ordering, dates and bounds, and reject private rows for a non-staff viewer before
rendering. These are defense-in-depth guards, not substitutes for server ACLs.
The dialog reuses the existing shared native-dialog scroll/focus helper.

Validation commands:
- node --test scripts/hr-service-conversation.test.mjs
- node scripts/hr-service-conversation-browser.mjs

The first command uses executable dependency doubles. The second requires the
existing isolated Next.js/PostgreSQL UI workflow, and refuses non-loopback or
non-hrbp_audit databases. Results must be reported separately. All browser data
is synthetic; no provider deployment, production migration or customer write.

Still separate: expected-client-revision checks for writes, durable command
idempotency across tabs/devices, attachments, full routing controls, message
editing/deletion, delivery guarantees, tenant-timezone display and customer UAT.
