# Enterprise Architecture

## Target shape
HRBP One uses a domain-oriented modular architecture with a shared People Graph, event platform and governance plane. The initial web application is a modular monolith for delivery speed, but boundaries are defined so high-scale domains can later be extracted without changing business contracts.

```text
Experience: Employee | Manager | HRBP | HR Ops | Executive
                      |
API / BFF + Identity + Policy Enforcement
                      |
Core HR | ATS | Time | Payroll | Talent | ER | Learning | Service
                      |
People Graph + Workflow Engine + Event Bus
                      |
PostgreSQL | Object Vault | Redis | Search | Analytics | Audit Ledger
                      |
Privacy | Retention | Classification | Authorization | Observability
```

## System-of-record objects
Tenant, Person, Employment, Position, OrganizationUnit, Job, Contract, Compensation, PayrollPeriod, Leave, Attendance, Candidate, Application, Goal, Review, Skill, LearningAssignment, EmployeeCase, Document, Workflow, AuditEvent.

## Architectural decisions
- PostgreSQL is the primary transactional store.
- Object storage is private by default; access is time-limited and policy checked.
- Redis is ephemeral cache / coordination only and never the source of HR truth.
- Domain events use an outbox pattern to prevent dual-write loss.
- All business records carry tenant ownership.
- Critical state uses effective-from/effective-to rather than destructive overwrite.
- High-risk read paths are purpose-aware and produce audit events.
- Analytics receives minimized projections, not unrestricted production-table access.

## Deployment profiles
Standard: shared application + isolated tenant rows and tenant encryption context.
Enterprise: dedicated database and encryption key.
Regulated: dedicated database, KMS, object vault and deployment region.
