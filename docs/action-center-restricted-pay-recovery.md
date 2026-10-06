# Action Center restricted pay controls — support layer

This support layer prepares receipt-safe Action Center controls for compensation and payroll after the domain UI receipt verifiers landed.

Compensation queue metadata is accepted only as APPROVE/REJECT for one change ID or APPLY alone. Payroll queue metadata is accepted only as APPROVED or PAID for one run ID. Foreign/mixed IDs fail closed.

Each control seals a resource in a page-owned in-memory registry before POST. Filtering or queue refresh therefore cannot expose an opposite or duplicate action while the result is unknown. Mutations reuse the #113 bounded receipt verifiers and never retry an unknown result automatically. Notification acknowledgement remains best-effort after verified saves.

This branch intentionally does not wire the controls into WorkflowActionCenter yet because #112 is modifying the same parent surface. Integration will be rebased onto main after #112 lands. Server authorization, four-eyes controls, payroll input fingerprinting, audit and durable notifications remain authoritative.
