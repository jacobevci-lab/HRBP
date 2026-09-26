# HR Service governance

HRBP One treats an HR service request as a governed employee-service transaction rather than an editable ticket row. Intake, routing, replies, SLA handling, status transitions and terminal outcomes remain inside tenant, relationship and queue authorization boundaries and leave reconstructable evidence.

## State model

The governed request path is `OPEN → TRIAGE → IN_PROGRESS → RESOLVED → CLOSED`, with `WAITING_EMPLOYEE` and `WAITING_THIRD_PARTY` as controlled pause states. `CANCELLED` is a terminal alternative. Closed and cancelled requests are read-only; resolved requests can be reopened to `IN_PROGRESS` before final close.

The server owns the transition graph. Clients cannot jump directly between arbitrary states. Waiting, resolution, closure, cancellation and reopen actions require a human-entered reason of 10–2000 characters. Each real status change creates an `HRServiceStatusTransition` record containing the previous and next state, reason, actor, queue, assignee and timestamp, in addition to the append-only audit chain.

## SLA pause and resume

An SLA clock does not continue to burn while the request is legitimately waiting on the employee or a third party. Entering either waiting state stores an `HRServiceSlaPause` evidence record with the reason, actor, timestamp and remaining SLA minutes, then clears `slaDueAt`. The scheduled operational escalation job already queries only requests with a non-null SLA due date, so paused work is naturally excluded from escalation.

Leaving a waiting state resumes the prior remaining SLA window and records the resume actor and timestamp. Legacy waiting requests without pause evidence receive a fresh window based on the delegated queue SLA or priority policy. Reopening a resolved request also starts a fresh SLA window and retires stale escalation state.

## First-response semantics

Routing, triage and ownership changes are not counted as a first response. `firstResponseAt` is established by the first requestor-visible staff reply, or by a governed outward transition that materially communicates with the employee. Private HR notes never satisfy the first-response metric.

Comments are bounded to 4000 characters. Employee and manager self-service replies are always requestor-visible; service staff can deliberately create requestor-visible replies or restricted private notes. Closed and cancelled requests reject new comments.

## Intake and routing

Request input is bounded server-side: category and subcategory are limited to 80 characters, title to 200 and description to 4000. Self-service binds the subject to trusted employment context instead of accepting a user-supplied employee identity. Staff-created requests retain relationship-scope checks.

Queue selection is validated against active delegated queues. When a queued request is created, its queue owner receives transactional notification intent; otherwise the request falls back to the HR Operations role. Assignment changes validate that the target is an active service-staff user and, when a queue is selected, a member of that queue.

## Notifications and lifecycle routing

Transactional outbox events cover request creation, assignment, requestor replies, staff replies, status changes and automated SLA escalation. Requester-facing notifications never include private HR notes.

Notification and Lifecycle Action Center links resolve into the governed HR Service lifecycle history instead of only opening the generic module. A link may carry the request UUID or request number. Resolution always intersects the existing `hrServiceRequestWhere` scope; it never performs an unscoped fallback lookup. If a link is stale or the request is outside the actor's current scope, the workspace reports that the target is not visible without widening access.

A visible linked request is pinned to the top of lifecycle history even when it has fallen outside the normal recent-request window. The same row retains its transition evidence, SLA state and governed action controls. After the actor successfully performs a lifecycle transition or adds a reply/note, matching in-app notifications for that request are acknowledged on a best-effort basis and the notification badge is refreshed. Notification cleanup can never roll back an already successful business mutation.

## Human decision boundary

Automation may calculate SLA warning/breach levels, route an overdue unassigned request to a configured queue owner and surface operational debt. It does not resolve, close, cancel or reopen employee requests. Those lifecycle outcomes remain explicit human actions with reasons and audit evidence.

## Failure and concurrency controls

Status transitions use serializable transactions plus optimistic `updatedAt` protection. Concurrent request changes therefore fail with a conflict instead of silently overwriting each other. Lifecycle evidence queries are bounded, and the HR Service workspace keeps the existing operating queue available even if a deployment has not yet synchronized the new evidence tables.
