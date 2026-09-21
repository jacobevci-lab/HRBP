# Authorization Model

HRBP One uses RBAC for coarse role grants and ABAC for the final decision. Tenant identity, organization scope, manager relationship, HRBP assignment, case assignment, classification and declared purpose can all narrow a role grant.

## Fail-closed request context
The current API boundary accepts `x-tenant-id`, `x-user-id`, `x-role` and optional `x-purpose` only as a development gateway contract. In production these headers must be stripped from untrusted traffic and injected by the authenticated BFF / identity gateway after OIDC validation. Direct client control of these headers is forbidden.

## Administrative separation
`TENANT_ADMIN` configures the platform but does not receive implicit access to `HIGHLY_RESTRICTED` content. Employee-relations, whistleblowing, health/accommodation and legal evidence require an explicitly privileged role plus object-level assignment where applicable.

## Data classification
- INTERNAL — organizational reference data.
- CONFIDENTIAL — ordinary employee and employment records.
- RESTRICTED — compensation, payroll, identity and document-vault records.
- HIGHLY_RESTRICTED — ER, whistleblowing, health/accommodation and legal evidence.

## API capabilities
The first vertical slice exposes policy-protected APIs for people, organization units, positions and document metadata. Every mutation creates an audit event. Delete endpoints are intentionally absent until retention and legal-hold policy is enforced transactionally.
