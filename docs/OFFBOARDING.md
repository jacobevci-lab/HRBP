# Offboarding governance

HRBP One treats separation as a governed employment-lifecycle transaction rather than a checklist. The offboarding domain owns the controlled path from approved separation through clearance, final settlement and employment termination while retaining the evidence needed to explain every human decision.

## State model

Active separation states are `DRAFT`, `NOTICE_PERIOD`, `CLEARANCE`, `FINAL_PAY_REVIEW` and `READY_TO_CLOSE`. Terminal outcomes are `CLOSED` and `CANCELLED`.

Readiness is derived from the underlying controls instead of being set manually. Blocking tasks, knowledge transfer, company assets and logical-access revocations must clear before operational clearance. Final settlement is independently prepared, approved and settled. A process becomes ready to close only when both operational clearance and final settlement are complete.

Closing a separation is intentionally stronger than completing a task. The last working date must have been reached, the process must still be `READY_TO_CLOSE`, the initiator cannot perform the final termination, and all clearance domains are rechecked inside the serializable closure transaction. Only then is the employment set to `TERMINATED` and lifecycle evidence written.

## Governed cancellation

An approved exit can change before termination. HRBP One therefore supports cancellation as a first-class terminal outcome rather than deleting the process or silently resetting it.

Cancellation requires `offboarding:write`, tenant and employment-scope authorization, a human-entered reason of 10–2000 characters, same-origin mutation protection and a serializable state transition. The process records `cancellationReason`, `cancelledById`, `cancelledAt` and `completedAt`, while its existing tasks, asset records, access controls, interviews, decisions and settlement evidence remain intact for auditability.

A separation whose final settlement is already `SETTLED` cannot be cancelled through the ordinary cancellation route. The payment must first be formally reversed through the appropriate payroll control path. This prevents a cancelled HR process from contradicting a completed financial transaction.

Cancelling a process does **not** terminate the employment. Because the employment remains active, it can later enter a new separation process if a future exit is approved. Open notifications tied to the cancelled process and its tasks are retired so stale offboarding reminders do not remain in the action queue.

## Terminal history and evidence reconstruction

`CLOSED` and `CANCELLED` separation records remain in a read-only terminal history rather than disappearing from the operational queue. The history is still constrained by tenant and employment relationship scope and intentionally exposes no mutation control.

Each terminal record reconstructs the governed evidence that existed when the process ended: task completion and waiver counts, asset returns and write-offs, logical-access revocations and exceptions, knowledge-transfer state, final-settlement state, exit-interview evidence, explicit human rehire decisions and the terminal outcome itself. A cancelled record clearly distinguishes process cancellation from employment termination and retains the cancellation reason, actor and timestamp.

Raw `AuditEvent` chain evidence is more privileged than ordinary offboarding history. It is included only when the viewing role also has `audit:read`; otherwise the domain evidence timeline remains visible while hashes and raw audit rows stay restricted. Where available, the history shows the process and employment audit chain including the current and previous hashes so an authorized reviewer can inspect immutable transition evidence without opening a mutation surface.

Terminal-history queries are bounded and failure-isolated from the active exit workspace. If historical evidence retrieval fails, live separation operations remain online rather than falling back with the history view.

## Human decision boundaries

Exit-interview feedback and rehire eligibility are separate records. Interview recommendations never convert automatically into rehire eligibility. Rehire eligibility remains an explicit human decision with a documented rationale. AI or scoring logic must not autonomously terminate employment, cancel a separation or determine rehire eligibility.

## Evidence and audit

Material transitions append restricted audit events. Cancellation uses `offboarding.process-cancelled`; closure records both employment termination and process closure. Operational controls record their own state transitions, verifier identities and exception reasons. The aggregate evidence therefore remains reconstructable even after the separation reaches a terminal outcome.
