# Audit Ledger

Security-relevant business mutations can write an audit event in the same database transaction as the business record.

Each event records tenant, actor, action, resource, purpose, classification, network context and timestamp. Events are chained using SHA-256 where each event stores the previous event hash and its own digest.

The current implementation provides application-level tamper evidence. Scheduled verification uses a bounded tail window per tenant, an event-budget-limited rotating tenant batch and restricted failure notifications. Invalid empty ledgers (state claims events but none exist) must be treated as integrity failures, not valid empty tenants. The 15-minute selection is best-effort and is not a durable completed-tenant cursor. The production target remains stronger: external immutable retention, signed checkpoints, SIEM export and independently scheduled whole-history verification.

Work & Pay mutations use the ledger because time approvals, leave decisions, compensation changes and payroll transitions materially affect employee records and financial outcomes.
