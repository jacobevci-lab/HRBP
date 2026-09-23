# HRBP One

Enterprise HRBP platform reference implementation built with Next.js, PostgreSQL/Prisma and Cloudflare/OpenNext.

## Product direction

HRBP One models the workforce as a governed relationship graph instead of a collection of disconnected forms. Core HR, work/pay, growth, employee services, governance/planning and administration share the same tenant, authorization, audit and effective-dated data plane.

## Security model

- Tenant isolation is enforced in server-side queries.
- Relationship-aware access limits employee populations for managers and HRBPs.
- Highly restricted case, privacy, compensation and payroll domains preserve dedicated boundaries.
- Mutations use origin checks, domain capabilities and append-only audit evidence.
- Employee documents use classification, explicit grants, legal hold, retention and malware-scan gates.
- Private document download is proxied server-side from S3-compatible object storage; bucket/object credentials are never returned to the browser.
- Policy governance follows DRAFT → REVIEW → APPROVED → PUBLISHED and requires independent approval.
- HR Service combines relationship scope with explicit queue membership and queue ownership.

## Local development

Copy `.env.example` to `.env.local`, configure PostgreSQL and authentication, then run:

```bash
npm install
npm run db:push
npm run dev
```

For the private document vault configure `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_BUCKET` and `OBJECT_STORAGE_REGION`.

## Quality gates

The GitHub Actions CI validates route structure, UI localization/theme rules, Prisma schema, TypeScript, Next.js production build, OpenNext/Cloudflare packaging and a local Worker runtime smoke test.

Staging schema synchronization is intentionally a manually dispatched workflow. It applies Prisma schema changes, seeds each vertical slice and verifies minimum domain counts before granting the runtime database role.
