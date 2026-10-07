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

## Session security
Application sessions are HMAC-signed but are not treated as irrevocable bearer cookies. Every authenticated request revalidates the tenant-scoped account plus tenant/account session versions. The rollout from legacy v1 cookies to the versioned v2 contract intentionally requires one new sign-in; old cookies are never grandfathered into the revocable contract. Administrators can revoke one account or the entire tenant; copied cookies fail on the next verified request. The tenant security policy can also shorten the maximum session lifetime immediately, while the platform runtime TTL remains an upper bound. Password-reset/local-auth controls continue to invalidate local sessions independently.

## Audit
Security-relevant reads and all mutations produce append-only audit events. Audit entries include actor, action, resource, purpose, timestamp and network context. The target ledger supports chained hashes and external immutable retention.

## Privacy
Every sensitive data domain should declare purpose, legal basis, classification, retention schedule, residency and allowed audience. Privacy workflows include access, correction, restriction, deletion/anonymization where applicable, legal hold and export.

## AI
AI context is authorization-filtered before model access. No tenant data is used for shared-model training. High-impact employment decisions require a human decision maker. Sensitive attributes are excluded by default from model context unless the specific approved purpose requires them.

## Secure SDLC target
SAST, SCA, secret scanning, IaC scanning, container scanning, SBOM, protected branches, signed releases, dependency review, DAST/API tests in staging and recurring penetration tests.


## External notification data minimization

SMTP delivery is opt-in and event-allowlisted. In-app notification intent remains the primary durable channel. HIGHLY_RESTRICTED records are never mirrored to SMTP. RESTRICTED email requires a separate explicit deployment gate and suppresses event-specific subject text, payload summary and resource-specific URLs; recipients receive only a generic secure-notification message and a link to the authenticated HRBP application.

SMTP credentials are runtime secrets. TLS certificate verification cannot be disabled, STARTTLS is mandatory when implicit TLS is not used, and provider response bodies are not persisted into notification operations telemetry.


## Document malware-scanning boundary

Uploaded document versions are fail-closed until a malware-scanning verdict is recorded. The on-prem scanner worker authenticates to the internal scan endpoint with a dedicated scanner token and does not receive object-storage credentials. A claimed object is proxied by the application only while its database state is actively `SCANNING`.

Before invoking ClamAV, the worker independently verifies the immutable content hash and size. Integrity mismatch is quarantined rather than retried or treated as clean. ClamD listens only on the private Compose network; its TCP port is never published to the host. Scanner claims use bounded attempts, stale-lock recovery and conditional finalization so worker crashes, retries and replayed callbacks cannot silently overwrite a different final verdict.


## Identity-provider validation boundary

Identity-provider registry records are not treated as trustworthy merely because required fields are populated. Entra ID, Okta and generic OIDC drafts must pass a live HTTPS discovery check before activation: the configured issuer must match discovery metadata, authorization/token/JWKS endpoints must remain HTTPS, redirects are not followed, response size/time are bounded and JWKS must contain at least one usable key.

SAML drafts must fetch metadata over HTTPS, reject DTD/entity declarations and expose an HTTPS SingleSignOnService before validation evidence is recorded. Loopback, link-local and common cloud-instance metadata targets are rejected before outbound validation.

Validation evidence is bound to the exact metadata revision with optimistic concurrency and expires for activation after the configured `HRBP_IDENTITY_VALIDATION_MAX_AGE_MINUTES` window (default 24 hours). Any draft metadata change clears prior validation evidence.

LDAP records require `ldaps://` metadata. They are deliberately **not** marked live-validated by the web runtime yet; activation validation returns `LDAPS_LIVE_VALIDATION_AGENT_REQUIRED` until the on-prem LDAPS validation agent is implemented. This prevents configuration-only checks from being represented as proof of a working directory connection.
