# Lifecycle Action Center

The Lifecycle Action Center turns the Workflows workspace into a connected operational queue instead of a workflow-only inbox.

## Connected sources

The queue currently aggregates three governed sources:

- **Workflow tasks** assigned directly to the actor, assigned to the actor's role, or exposed as a shared workflow queue when the actor has workflow-run authority.
- **HR Service** attention signals. Employee and manager self-service only surfaces their own requests when an employee response is required. Service operations can see assigned work, delegated unassigned queue work, escalated requests, and high/critical priority requests, always intersected with the existing HR Service visibility scope.
- **Employee Relations** corrective actions owned by the actor and active appeals assigned to the actor as reviewer. Both are first constrained to the actor's Case Wall ownership/assignment scope.

The action center does not create a new authorization surface. It composes the authorization and visibility boundaries already enforced by the source domains.

## Privacy and need-to-know rules

- Every query is tenant scoped.
- HR Service reuses `hrServiceRequestWhere` and delegated queue visibility.
- Employee Relations reuses the Case Wall ownership/assignment rule before querying actions or appeals.
- HR Service comments and private notes are not loaded into the aggregate queue.
- Appeal grounds and decision narratives are not loaded into the aggregate queue.
- The API response uses `Cache-Control: no-store` because the queue is actor-specific.

## Action semantics

Workflow tasks remain directly completable from the Action Center because the existing workflow completion endpoint already owns workflow transition and audit semantics.

HR Service and Employee Relations items deep-link back to their governed source workspace rather than mutating source records from the aggregate queue. This deliberately keeps status-transition rules, reasons, audit evidence, SLA pause/resume semantics, Case Wall controls, and four-eyes rules in their source modules.

## Prioritization

Items are ordered by:

1. Critical urgency
2. Warning urgency
3. Due date
4. Oldest creation/start time

An overdue due date is always critical. A due date inside 24 hours is at least warning. HR Service escalation and critical priority are also critical; high priority is warning.

The aggregate response is bounded to 250 items. Source queries are bounded independently before aggregation.

## Validation

`npm run lifecycle-action-center:validate` statically verifies the important security and lifecycle invariants and is included in `prebuild`.
