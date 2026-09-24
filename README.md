# HRBP One

Enterprise HRBP platform reference implementation built with Next.js, PostgreSQL/Prisma and Cloudflare/OpenNext.

## Product direction

HRBP One models the workforce as a governed relationship graph instead of a collection of disconnected forms. Core HR, work/pay, growth, employee services, governance/planning and administration share the same tenant, authorization, audit and effective-dated data plane.

The operating experience is action-oriented: authenticated users see only modules allowed by their capabilities, global search respects the same scope, workflow tasks are routed into a personal Action Center, and in-app notifications deep-link users to the governed resource that needs attention. Public staging intentionally keeps the product map discoverable through read-only sample workspaces while protected records and mutations remain unavailable until an authorized sign-in.

## Security model

- Tenant isolation is enforced in server-side queries.
- Relationship-aware access limits employee populations for managers and HRBPs.
- Highly restricted case, privacy, compensation and payroll domains preserve dedicated boundaries.
- Mutations use origin checks, domain capabilities and append-only audit evidence.
- Employee documents use classification, explicit grants, legal hold, retention and malware-scan gates.
- Private document download is proxied server-side from S3-compatible object storage; bucket/object credentials are never returned to the browser.
- Policy governance follows DRAFT → REVIEW → APPROVED → PUBLISHED and requires independent approval.
- HR Service combines relationship scope with explicit queue membership and queue ownership.
- Authenticated navigation and global search are capability-aware. Public staging may expose module labels and sample-only previews, but never protected records, secrets or privileged actions.
- Workflow task completion is restricted to the assigned user, assigned platform role, or an explicitly governed shared task.

## Workflow and notification operations

Workflow task readiness, SLA warnings, overdue tasks, HR Service escalations and policy lifecycle events use a durable notification outbox. The dispatcher provides retry/backoff, stale-lock recovery, user/role routing, idempotent deduplication and dead-letter handling. The notification inbox tracks read state, supports resource-scoped acknowledgement and keeps the top-bar badge synchronized with actions completed elsewhere in the application.

Scheduled maintenance also applies configurable notification retention so operational outbox data remains bounded without deleting recent unread actions. See `.env.example` for dispatcher, workflow-reminder and retention settings.

## Local development

Copy `.env.example` to `.env.local`, configure PostgreSQL and authentication, then run:

```bash
npm install
npm run db:push
npm run dev
```

For the private document vault configure `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_BUCKET` and `OBJECT_STORAGE_REGION`.

## Quality gates

The GitHub Actions CI validates route structure, UI localization/theme rules, Prisma schema, TypeScript, Next.js production build, OpenNext/Cloudflare packaging and a local Worker runtime smoke test. The Worker smoke test also exercises scheduled maintenance and the durable notification dispatcher against PostgreSQL.

Staging schema synchronization is intentionally a manually dispatched workflow. It applies Prisma schema changes, seeds each vertical slice and verifies minimum domain counts before granting the runtime database role.