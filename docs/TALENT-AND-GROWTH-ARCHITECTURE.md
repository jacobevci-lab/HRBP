# Talent & Growth Architecture

HRBP One treats benefits, performance, talent, succession, skills and learning as connected parts of the employee system of record rather than isolated modules.

## Connected lifecycle

`Employment -> Goals -> Performance Review -> Talent Assessment -> Succession / Development -> Skills -> Learning Assignment`

Benefits remain effective-dated against employment and can feed approved payroll inputs without becoming payroll's source of truth.

## Human decision boundary

People decisions remain human-owned. The platform may use AI to summarize evidence, identify missing documentation, highlight contradictory inputs or draft development actions, but it must not automatically:

- assign a final performance rating;
- designate a worker as high-potential or low-potential;
- select a successor;
- decide promotion, compensation, disciplinary action or termination;
- generate an opaque individual flight-risk or loyalty score.

Every material assessment stores its cycle, human assessor/manager where applicable, timestamp and auditable business context.

## Performance

Goals are linked to employment and may be aligned through parent goals. Performance review cycles are tenant-level processes. Each employee review is unique within a cycle and preserves self, manager and calibrated outcomes separately so calibration does not overwrite the evidence trail.

## Talent

Talent assessment separates performance and potential and records critical-talent designation as a human assessment. The UI may render a configurable talent matrix, but the matrix is a visualization of recorded decisions, not an AI scoring engine.

## Succession

Succession planning is position-centric. A critical position can have multiple successor candidates with explicit readiness bands. Candidate readiness is a governed assessment and not inferred from private communications, health data, protected characteristics or employee surveillance.

## Skills & learning

Skills use a tenant-owned taxonomy and can be linked to an employment with proficiency, source and assessment date. Learning courses and assignments track mandatory and optional development. Certificates and evidence can later be stored in the restricted document vault.

## Benefits

Benefit plans are effective-dated and jurisdiction-aware. Employee enrollment preserves coverage tier, status and employer/employee contribution history. Enrollment changes should create controlled payroll inputs only after eligibility and effective-date validation.

## Authorization

The capability plane separates benefits, performance, talent, succession and learning. Broad tenant administration is not equivalent to unrestricted people-data access. Restricted employee relations, payroll and compensation boundaries remain separate.

Manager self/team access must ultimately combine RBAC with ABAC relationship checks; broad tenant-wide manager reads are not an acceptable production authorization model.

## Audit

Material creates and updates are written to the hash-chained audit ledger in the same database transaction as the business mutation wherever practical. Reads of high-value restricted records should also be purpose-aware and audited in later hardening phases.
