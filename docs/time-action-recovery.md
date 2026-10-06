# Time action receipt and recovery

Time-entry creation and transitions are server-authorized transactions. The client must not infer success from HTTP 200/201 alone.

This increment adds a bounded receipt checker shared by employee self-service and the operational transition buttons. A successful response must identify the expected time entry, employment (for creation), target state and timestamps/quantities consumed by the UI. HTML, malformed JSON, oversized bodies, 5xx responses, timeouts and mismatched records are treated as an unknown result.

Unknown does not mean failed: the server may already have committed the transaction. The client therefore never retries a POST automatically. Employee draft input is retained and further time mutations are blocked until the user explicitly reloads and checks current records. Operational transition controls follow the same fail-closed pattern. Notification acknowledgement remains best-effort and only runs after a verified approval/rejection receipt.

Server-side RBAC/ABAC, transition policy, serializable transactions, overlap checks, schedule requirements, audit evidence and notification outbox remain authoritative and unchanged.

Limits: this is page-local duplicate protection, not a cross-tab idempotency key. Action Center's generic time quick action path remains a separate follow-up surface. Browser/PostgreSQL regression should be added before claiming parity with the leave recovery depth.
