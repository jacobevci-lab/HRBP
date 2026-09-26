# Employee Relations case governance

HRBP One treats Employee Relations matters as highly restricted investigations inside a case wall. Allegations, interviews, evidence, findings, corrective actions, appeals and the case lifecycle remain available only to the case owner or explicitly assigned investigators. Case state is governed independently from evidence collection so a user cannot close a matter while unresolved investigative work remains.

## Case state model

The supported lifecycle is `DRAFT → OPEN → INVESTIGATING → ACTION_REQUIRED → RESOLVED → CLOSED`. `ACTION_REQUIRED` may return to `INVESTIGATING`, and a resolved matter may be explicitly reopened to `INVESTIGATING` before final closure. `CLOSED` is terminal.

The server owns the transition graph. Clients cannot jump arbitrarily between lifecycle states. Moving to `ACTION_REQUIRED`, `RESOLVED` or `CLOSED`, or reopening a resolved case, requires a human-entered reason of 10–2000 characters.

Every real transition creates `EmployeeCaseStatusTransition` evidence containing the previous state, next state, reason, actor and timestamp. The transition also appends a `HIGHLY_RESTRICTED` audit event.

## Resolution and closure gates

A case cannot move to `RESOLVED` while any allegation remains `OPEN` or `INVESTIGATING`, or while any corrective action remains `OPEN` or `IN_PROGRESS`.

A resolved case cannot move to `CLOSED` while active allegations or corrective actions remain, and closure is also blocked while an appeal is `SUBMITTED` or `REVIEWING`. This makes final closure a derived readiness decision rather than a cosmetic status edit.

The closure gate does not infer guilt, misconduct, disciplinary outcome or credibility. Findings and final case decisions remain explicit human investigation records.

## Corrective actions

Corrective actions follow `OPEN → IN_PROGRESS → COMPLETED/CANCELLED`. Completion and cancellation require a 10–2000 character human reason and create `CaseActionStatusTransition` evidence plus restricted audit evidence. A corrective action cannot be mutated after it is completed or cancelled.

Action creation validates the owner as an active tenant user, validates any subject employment against the case subject, bounds action type and description inputs, and creates durable notification intent for an owner other than the creator.

## Case-wall boundary

All lifecycle reads and mutations continue through the existing case wall: the actor must own the case or have an explicit active case assignment. Case-wall list queries are bounded. Lifecycle panels do not expand access to people, allegations, evidence, appeals or findings outside this boundary.

Notifications intentionally contain minimal metadata such as case number and state changes. Investigation narrative, allegation detail, finding rationale and private evidence are not copied into notification payloads.

## Concurrency and evidence

Case and corrective-action mutations execute in serializable transactions and use state-aware optimistic updates. Concurrent state changes therefore return a conflict rather than silently overwriting another investigator's decision.

Lifecycle evidence queries are bounded and fail soft during staged schema rollout, leaving the existing case register available if the new evidence tables have not yet been synchronized.

## Human decision boundary

Automation may surface closure blockers, overdue corrective actions and investigation workflow debt. It must not substantiate allegations, determine misconduct, select disciplinary outcomes, resolve or close a case, decide an appeal, or infer employee fault. Those decisions remain human-owned and auditable.
