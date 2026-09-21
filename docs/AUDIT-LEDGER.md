# Audit Ledger

Security-relevant business mutations can write an audit event in the same database transaction as the business record.

Each event records tenant, actor, action, resource, purpose, classification, network context and timestamp. Events are chained using SHA-256 where each event stores the previous event hash and its own digest.

The current implementation provides application-level tamper evidence. The production target remains stronger: serialized append semantics, external immutable retention, signed checkpoints, SIEM export and periodic chain verification.

Work & Pay mutations use the ledger because time approvals, leave decisions, compensation changes and payroll transitions materially affect employee records and financial outcomes.
