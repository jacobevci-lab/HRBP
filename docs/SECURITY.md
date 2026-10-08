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
Security-relevant reads and all mutations produce append-only audit events. Audit entries include actor, action, resource, purpose, timestamp and network context. Each tenant ledger is hash-chained and carries a monotonic ledger sequence plus a durable tail record. Appends acquire a tenant-scoped PostgreSQL transaction advisory lock before reserving the next sequence, and the database enforces unique tenant/sequence, tenant/hash and predecessor references so concurrent requests cannot commit a fork. Versioned migration refuses pre-existing duplicate hashes, forks, multiple roots or disconnected events instead of silently normalizing corrupted history. Online and scheduled integrity checks verify sequence continuity, predecessor hashes, event hashes and the durable tail state.

External immutable/WORM retention remains a customer deployment integration rather than an implicit property of the application database.

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


## Operational metrics boundary

Operational metrics are exposed only through the authenticated internal metrics endpoint and use a dedicated deployment secret. The exported series are deliberately low-cardinality, aggregate operational state: notification channel/status counts, document malware-scan state/count/age signals, SCIM-managed identity counts/configuration posture, system-integration lifecycle/validation posture, and scrape health/timing.

Tenant identifiers, user identifiers, employee data, resource identifiers, notification event names, object keys, document metadata, scanner references and error bodies are not metric labels or values. Unknown notification channel values are collapsed to a bounded `OTHER` label rather than emitted verbatim. Database failures return only a generic scrape-failure gauge and HTTP 503; SQL or provider exception text is not returned to the collector.

The metrics token is independent from maintenance and malware-scanner credentials, and on-prem preflight rejects privileged-secret reuse.


## Browser response hardening

Every application route receives a small browser security baseline from the Next.js response configuration:

- Content Security Policy restricts base URLs and form submissions to the application origin, forbids framing, and disables plugin/object content without introducing `unsafe-inline`, `unsafe-eval` or wildcard sources.
- `X-Frame-Options: DENY` provides a legacy clickjacking fallback for browsers that do not enforce CSP `frame-ancestors`.
- `X-Content-Type-Options: nosniff` disables MIME sniffing.
- `Referrer-Policy: strict-origin-when-cross-origin` avoids leaking full internal paths cross-origin.
- `Permissions-Policy` disables camera, microphone, geolocation, payment and USB capabilities that HRBP does not require.
- HSTS is emitted with a one-year max age. Customer reverse proxies must preserve this header on the external HTTPS origin; browsers ignore it on plain HTTP development/loopback access.

The CSP intentionally does not yet define `default-src` or `script-src`: Next.js runtime scripts are not weakened with broad unsafe directives just to claim a full CSP. Tighter nonce/hash-based script and style policy should be introduced only with end-to-end browser regression coverage.


## SCIM provisioning boundary

SCIM is an optional service-to-service identity provisioning interface and is disabled by default. It uses a dedicated tenant-scoped bearer credential and never reuses browser-session, maintenance, metrics, scanner, database, storage, OIDC or SMTP secrets. Credential rotation can temporarily accept one separately configured previous bearer; the previous and current tokens must be distinct and the health surface reveals only whether that overlap is active. The retiring token should be removed immediately after the identity provider has switched.

Provisioning can create and synchronize only application user identity state. SCIM cannot assign privileged HRBP roles; newly created accounts are fixed to `EMPLOYEE`. User mutations are restricted to `userName`, `displayName`, `externalId` and `active`, and request bodies, filters, pagination and resource identifiers are bounded before database use.

SCIM operations are serialized per tenant with a PostgreSQL transaction advisory lock. This makes concurrent identity-provider retries converge on one account state and keeps deprovision/session-revocation updates ordered. Deactivation increments the account session version exactly once on the active-to-disabled transition; stale copied HRBP sessions therefore fail on subsequent verified requests.

Unmanaged-account adoption is disabled by default. When explicitly enabled for a reviewed migration, only non-local `EMPLOYEE` accounts are eligible; SCIM cannot silently take ownership of local-auth or privileged administrator accounts. All lifecycle mutations write restricted append-only audit evidence under the system SCIM actor.

The SCIM health endpoint is secret-free. Authentication failures return the SCIM error shape with a Bearer challenge but never echo the token, database error text or employee payloads.


## Outbound integration validation boundary

System-integration activation can require a real transport probe, but HRBP does not turn that control into an unrestricted server-side request primitive. The probe is limited to exact administrator-approved origins, uses an unauthenticated `HEAD` request, never follows redirects, never resolves or transmits stored secret references, discards response bodies and persists only bounded reachability state.

Literal localhost, loopback, unspecified, link-local and multicast destinations are rejected. Private enterprise network origins require explicit allowlisting, while plain HTTP additionally requires a separate deployment opt-in and preflight warning. Transport errors are collapsed to bounded failure classes so DNS/TLS/provider exception text is not returned to the browser or stored in connection state.

A successful probe proves endpoint transport reachability only. It does not assert that downstream credentials, scopes or business operations are valid; those remain connector-specific responsibilities.


## High-impact job-change confirmation boundary

Transfer and promotion are not executed from the first browser submission. An authorized operator must first obtain a short-lived signed impact preview. The receipt is bound to tenant, actor, person, employment, source and target position, event type, effective date and a digest of the stated business reason.

The signed receipt also carries a deterministic digest of the reviewed relationship-impact state. Apply recomputes that state from the database before mutation, including source/target organization and position attributes, current manager relationship, direct-report count, target criticality and open recruiting demand. If any of those reviewed conditions changed, the receipt is stale and the operator must preview again.

The receipt expires after ten minutes, cannot be reused by another actor, and is invalidated client-side when reviewed inputs change. The apply path still independently rechecks target vacancy/incumbency and writes employment, position state, lifecycle evidence and audit evidence in one transaction. The preview is decision support only: manager reassignment, compensation, open requisitions and location-dependent policy obligations are surfaced for review rather than silently changed.


## Future-dated job-change boundary

Future-dated transfers and promotions are persisted as governed schedule records; they do not mutate employment before the effective date. Schedule creation requires the same signed impact-preview receipt, write capabilities and employment relationship scope as immediate application.

The maintenance executor revalidates the exact reviewed source/target and relationship-impact digest after the effective date arrives. If employment, manager/direct-report state, organization/grade/location/criticality, recruiting demand, target vacancy or incumbent state changed, the schedule becomes a terminal `BLOCKED` outcome and requires human review. It is never silently adapted to new facts.

Only `PENDING` schedules can be cancelled. Successful execution writes employment/position state, lifecycle evidence, schedule state and append-only audit evidence transactionally. Aggregate monitoring exposes schedule status/due-age signals only; employee, requester, tenant and position identifiers never become metric labels.
