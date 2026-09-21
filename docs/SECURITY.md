# Security & Privacy Architecture

## Authorization
HRBP One uses RBAC + ABAC. A role alone never grants unrestricted access. Decisions can include tenant, legal entity, organization scope, manager relationship, HRBP assignment, case assignment, data classification, residency and declared purpose.

## Data classes
- INTERNAL — organization structure, public job taxonomy.
- CONFIDENTIAL — standard employee profile and employment data.
- RESTRICTED — compensation, payroll, identity documents, bank details.
- HIGHLY_RESTRICTED — employee relations, whistleblowing, health/accommodation and legal evidence.

## Administrative separation
Tenant administrators configure the platform but do not automatically gain content access to restricted cases, medical/accommodation evidence, whistleblower identity or payroll vault data. Exceptional support access must be JIT, approved, time-bound, justified and audited.

## Cryptography
TLS in transit; encrypted storage at rest; KMS-backed envelope encryption for sensitive data; tenant encryption context; optional dedicated keys / BYOK for enterprise tiers. Secrets must use a secrets manager and are never committed to source control.

## Audit
Security-relevant reads and all mutations produce append-only audit events. Audit entries include actor, action, resource, purpose, timestamp and network context. The target ledger supports chained hashes and external immutable retention.

## Privacy
Every sensitive data domain should declare purpose, legal basis, classification, retention schedule, residency and allowed audience. Privacy workflows include access, correction, restriction, deletion/anonymization where applicable, legal hold and export.

## AI
AI context is authorization-filtered before model access. No tenant data is used for shared-model training. High-impact employment decisions require a human decision maker. Sensitive attributes are excluded by default from model context unless the specific approved purpose requires them.

## Secure SDLC target
SAST, SCA, secret scanning, IaC scanning, container scanning, SBOM, protected branches, signed releases, dependency review, DAST/API tests in staging and recurring penetration tests.
