# Offboarding governance

HRBP One treats separation as a governed employment-lifecycle transaction rather than a checklist. The offboarding domain owns the controlled path from approved separation through clearance, final settlement and employment termination while retaining the evidence needed to explain every human decision.

## State model

Active separation states are `DRAFT`, `NOTICE_PERIOD`, `CLEARANCE`, `FINAL_PAY_REVIEW` and `READY_TO_CLOSE`. Terminal outcomes are `CLOSED` and `CANCELLED`.

Readiness is derived from the underlying controls instead of being set manually. Blocking tasks, manager continuity, knowledge transfer, company assets and logical-access revocations must clear before operational clearance. Final settlement is independently prepared, approved and settled. A process becomes ready to close only when both operational clearance and final settlement are complete.

Closing a separation is intentionally stronger than completing a task. The last working date must have been reached, the process must still be `READY_TO_CLOSE`, the initiator cannot perform the final termination, and all clearance domains are rechecked inside the serializable closure transaction. Only then is the employment set to `TERMINATED` and lifecycle evidence written.

## Governed schedule amendments

Notice and last-working dates can change after a separation begins, but the change is treated as a governed lifecycle amendment rather than a direct field edit. Amendments require `offboarding:write`, same-origin protection, tenant and employment-scope authorization, valid date ordering and a human-entered reason of 10–2000 characters. The transition is serializable and optimistic-state protected.

Every change creates a `SeparationScheduleAmendment` evidence record containing the previous and new notice dates, previous and new last-working dates, reason, actor and timestamp. Terminal offboarding history reconstructs these amendments in the evidence timeline even after the process is closed or cancelled.

Open separation tasks and knowledge-transfer items whose deadlines were aligned to the previous last-working date move to the amended date. Custom deadlines remain untouched. Scheduled access-revocation controls preserve their relative offset from the last-working date; a shifted access schedule that would violate the governed exit boundary causes the amendment to fail instead of silently creating an invalid control state.

Unread due-soon, overdue, blocked-task and exit-readiness notifications whose payloads contain the old schedule are retired so scheduled maintenance can regenerate current reminders. Exit readiness is recalculated after the dependent controls have been synchronized.

A schedule cannot be amended while final settlement is `SETTLED`. The completed payment must first go through the governed settlement-reversal path. This prevents an exit date from changing while the system still represents a financial settlement calculated for the previous date as final.

## Replacement and recruiting handoff

Replacement planning is an explicit human decision attached to the separation; it is not inferred from exit type, performance data, AI output or the fact that a position becomes vacant. HR records whether the role needs to be backfilled and supplies a 10–2000 character rationale. The decision actor and timestamp are retained on the separation record.

A positive replacement decision requires both `offboarding:write` and `recruiting:write`, a position-backed employment and normal tenant/employment-scope authorization. It creates exactly one position-linked requisition in `DRAFT` with one opening and a target hire date. The handoff deliberately stops at draft: it does not approve or open hiring, select a candidate or bypass the existing recruiting approval controls. Recruiting receives a transactional outbox notification and owns the requisition from that point.

A no-replacement decision also remains explicit evidence. Before a recruiting handoff, HR can revise the decision. Once a replacement requisition is linked, the separation no longer rewrites the recruiting decision silently; the recruiting record must be governed in its own domain.

Cancellation coordinates with the linked recruiting demand. A linked `DRAFT` or `APPROVAL` requisition is transactionally cancelled with the source separation and its stale notifications are retired. A requisition that has already advanced to `OPEN`, `ON_HOLD` or `CLOSED` is considered committed recruiting work and blocks source-separation cancellation until Recruiting resolves it. A requisition already marked `CANCELLED` does not block the separation.

Terminal offboarding history reconstructs the replacement decision and, for viewers with `audit:read`, includes audit-chain evidence for the linked requisition as well as the separation and employment.

## Manager continuity handover

A manager separation cannot become operationally clear while active direct reports still reference the departing employment. `PREBOARDING`, `ACTIVE`, `LEAVE` and `SUSPENDED` reports therefore act as a first-class exit blocker alongside assets, logical access and knowledge transfer.

HR can perform a governed batch handover from the separation workspace. The action requires `offboarding:write`, same-origin protection, tenant and employment-scope authorization and a 10–2000 character human rationale. The target manager must have an `ACTIVE` or `LEAVE` employment and must not be the departing employee or any employment inside the departing manager's reporting subtree. The server walks the current management chain before the mutation and rejects cyclic or excessively deep hierarchies instead of creating a reporting loop.

All currently active direct reports are reassigned in one serializable transaction. The update is state-aware: every report must still point to the departing manager when the transaction commits. Each moved employment receives a `MANAGER_CHANGED` lifecycle event, while `SeparationManagerReassignment` records preserve the report employment, previous manager, new manager, reason, actor and timestamp for terminal evidence reconstruction. Exit readiness is recalculated in the same transaction.

The manager handover does not choose a successor by score, performance data or AI. It only executes a human-selected organization decision and records the evidence. The final closure gate independently rechecks that no active direct reports remain on the departing employment before employment termination can commit.

## Governed cancellation

An approved exit can change before termination. HRBP One therefore supports cancellation as a first-class terminal outcome rather than deleting the process or silently resetting it.

Cancellation requires `offboarding:write`, tenant and employment-scope authorization, a human-entered reason of 10–2000 characters, same-origin mutation protection and a serializable state transition. The process records `cancellationReason`, `cancelledById`, `cancelledAt` and `completedAt`, while its existing tasks, asset records, access controls, interviews, decisions and settlement evidence remain intact for auditability.

A separation whose final settlement is already `SETTLED` cannot be cancelled through the ordinary cancellation route. The payment must first be formally reversed through the appropriate payroll control path. This prevents a cancelled HR process from contradicting a completed financial transaction.

Cancelling a process does **not** terminate the employment. Because the employment remains active, it can later enter a new separation process if a future exit is approved. Open notifications tied to the cancelled process and its tasks are retired so stale offboarding reminders do not remain in the action queue.

## Controlled final-settlement reversal

A final settlement that has already been marked `SETTLED` can be reopened only through the governed payroll reversal action. Reversal requires `payroll:pay`, a human-entered reason of 10–2000 characters and a different payroll payment actor from the person who confirmed the settlement. The reversal executes inside the same serializable settlement transaction and records `finalSettlementReversalReason`, `finalSettlementReversedById` and `finalSettlementReversedAt` in addition to restricted audit evidence.

The reversal moves final settlement from `SETTLED` back to `APPROVED`; it does not erase the prior preparation or approval decision. This reflects the operational meaning of a payroll reversal: the approved settlement remains the basis for correction, but payment completion is no longer valid. The existing `SETTLE` action can therefore be used again after the financial correction is confirmed, subject to the original separation-of-duties rule.

Readiness is recalculated in the reversal transaction. A process that had reached `READY_TO_CLOSE` falls back to `FINAL_PAY_REVIEW` while the financial settlement is open. Any stale ready-to-close notification is retired. When the corrected settlement is completed again, a new readiness notification generation is created instead of reusing the prior dedupe record. A fresh payroll payment notification is also created for the reopened settlement.

This reversal path is what makes cancellation after an accidental or superseded final payment coherent: once the financial reversal is formally recorded and the settlement is no longer `SETTLED`, the separate governed cancellation action may be used without falsely representing a completed payment as cancelled.

## Terminal history and evidence reconstruction

`CLOSED` and `CANCELLED` separation records remain in a read-only terminal history rather than disappearing from the operational queue. The history is still constrained by tenant and employment relationship scope and intentionally exposes no mutation control.

Each terminal record reconstructs the governed evidence that existed when the process ended: schedule amendments, manager-reporting-line handovers, replacement/backfill decisions, task completion and waiver counts, asset returns and write-offs, logical-access revocations and exceptions, knowledge-transfer state, final-settlement state and reversal evidence, exit-interview evidence, explicit human rehire decisions and the terminal outcome itself. A cancelled record clearly distinguishes process cancellation from employment termination and retains the cancellation reason, actor and timestamp.

Raw `AuditEvent` chain evidence is more privileged than ordinary offboarding history. It is included only when the viewing role also has `audit:read`; otherwise the domain evidence timeline remains visible while hashes and raw audit rows stay restricted. Where available, the history shows the process, employment and linked replacement-requisition audit chain including the current and previous hashes so an authorized reviewer can inspect immutable transition evidence without opening a mutation surface.

Terminal-history queries are bounded and failure-isolated from the active exit workspace. If historical evidence retrieval fails, live separation operations remain online rather than falling back with the history view.

## Human decision boundaries

Exit-interview feedback and rehire eligibility are separate records. Interview recommendations never convert automatically into rehire eligibility. Rehire eligibility remains an explicit human decision with a documented rationale. Replacement need and manager reassignment are also human workforce decisions: AI or scoring logic must not autonomously terminate employment, cancel a separation, amend the exit schedule, reverse payroll settlement, determine rehire eligibility, create/open replacement hiring demand, select a replacement candidate or choose a new manager.

## Evidence and audit

Material transitions append restricted audit events. Schedule amendments use `offboarding.schedule-amended`; manager continuity handover uses `offboarding.manager-handover-completed`; replacement decisions use `offboarding.replacement-required` or `offboarding.replacement-not-required`; a generated recruiting handoff uses `REQUISITION_CREATED_FROM_OFFBOARDING`; cancellation uses `offboarding.process-cancelled`; automatic retirement of an uncommitted linked backfill uses `REQUISITION_CANCELLED_FROM_OFFBOARDING`; settlement reversal uses `offboarding.final-settlement-reversed`; closure records both employment termination and process closure. Operational controls record their own state transitions, verifier identities and exception reasons. The aggregate evidence therefore remains reconstructable even after the separation reaches a terminal outcome.
