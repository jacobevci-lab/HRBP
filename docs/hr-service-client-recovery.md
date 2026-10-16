# HR service intake, transitions and conversations: client recovery

This slice changes the two HR-service workspace components, not owning API
business rules, permissions, database schemas or historical evidence.

## Confirmed behavior

- Every intake, transition, requester-visible reply and private HR note asks for
  explicit confirmation. Private notes explain that the requester cannot see
  them; a requester replying to RESOLVED is warned that the request reopens.
- Synchronous duplicate handlers share a ref gate before awaiting the network.
  Response status, nonredirected object envelope and receipt are validated.
- Intake binds tenant/requester/subject and all submitted fields, initial OPEN
  state, generated number and creation timestamp. Replies bind request, tenant,
  author, exact text, visibility and creation time. Status responses bind request,
  tenant, requested target and update time; they do not attest the reason text.
- Unknown or malformed responses retain drafts and block automatic replay.
  Collapsing/expanding controls and a locale change do not reset the guard.
  A late reply cannot refresh a different visible request/principal. At most 32
  context/result labels are retained per mounted component, without request bodies.
- Saved output stays saved even if notification cleanup or router refresh fails.
  Badge cleanup is bounded and nonblocking. An explicit new-draft action clears
  only a confirmed saved result, never an uncertain one. Inputs are disabled
  while a write is outstanding so the old reply cannot clear a newer draft.
- The next-status selector derives a valid target from refreshed server status;
  closed/cancelled requests show no writing controls even when mounted directly.
- Labels and outcome messages use EN/TR. Raw server diagnostics are never shown.

## Boundaries and acceptance

This is a mounted-component UX guard, not a server authorization boundary,
cross-tab/device deduplication, durable command idempotency or an expected-revision
API protocol. A full navigation/remount resets local memory. Check current server
records before attempting recovery. The server's scope, four-eyes/role rules,
serializable transactions, notification outbox and audit coupling remain intact.

A request or comment POST deliberately has no automatic retry. The API can still
accept separate same-content requests from other clients; no new uniqueness rule
is claimed. Status receipts do not prove which previous UI snapshot a user saw.
Existing SLA pause/resume/reopen semantics are tested, not redesigned here.

`hr-service-ui.test.mjs` exercises the actual components using dependency/hook
doubles. `hr-service-browser.mjs` requires disposable loopback `hrbp_audit`, signed
synthetic sessions, actual production Next.js, Chromium and PostgreSQL. It creates
only synthetic fixtures, never calls provider services, and retains reports on
failure. Its named scenarios cover intake, status/cancellation, pause/resume,
private versus public comments, requester reopen, wrong/dropped post-commit
responses, authorization and narrow layouts. Existing seven acceptance suites
remain in UI Deep Inspection. Passing this suite is not whole-product CRUD UAT,
Cloudflare deployment or proof of zero vulnerabilities.
