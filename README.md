# HRBP One

Enterprise Human Capital Management & HRBP Operating System.

HRBP One is designed as the primary HR system of record for the complete employee lifecycle — from candidate to alumni — with privacy, security, workflow, audit and AI governance built into the platform foundation.

## Current foundation

The initial enterprise shell is live in the repository and includes:

- Executive / HRBP Command Center dashboard
- Responsive enterprise navigation and module shell
- Core HR, organization, recruiting, onboarding and position domains
- Time, attendance, leave, payroll, compensation and benefits domains
- Performance, talent, succession, skills, learning and engagement domains
- Employee Relations / HR Service / documents / policy domains
- Workforce planning, people analytics, AI assistant and workflow domains
- Privacy & Compliance and Audit workspaces
- PostgreSQL-oriented connected people data model
- Effective-dated employment, organization, position and compensation concepts
- Tenant-aware security architecture
- Restricted Employee Relations data boundary
- Append-only audit ledger direction
- Local PostgreSQL, Redis and MinIO development stack
- GitHub Actions CI for type checking, Next.js production builds and Cloudflare Workers builds

## Product architecture

```text
Employee | Manager | HRBP | HR Ops | Executive
                    |
              Experience Layer
                    |
        Identity + Policy Enforcement
                    |
Core HR | ATS | Time | Payroll | Talent | ER | Learning
                    |
       People Graph + Workflow + Events
                    |
PostgreSQL | Object Vault | Redis | Search | Analytics
                    |
 Privacy | Retention | Audit | Classification | AI Governance
```

## Product principle

One platform, one employee golden record, one organization model, one workflow engine, one audit trail and one privacy model.

External services may integrate with HRBP One, but employee, employment, recruiting, compensation, payroll, performance, talent, case, document and lifecycle records remain mastered by the platform.

## Technology foundation

- Next.js + React + TypeScript
- Prisma + PostgreSQL
- Redis for ephemeral coordination/cache
- S3-compatible private object storage (MinIO locally)
- Cloudflare Workers deployment through OpenNext
- GitHub Actions CI
- Domain-oriented modular architecture

## Local development

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:generate
npm run dev
```

Open `http://localhost:3000`.

## Cloudflare Workers deployment

The repository is ready for deployment to Cloudflare Workers. The existing Next.js 15 application uses the Cloudflare OpenNext adapter so the current application can be deployed without a framework-major upgrade.

Cloudflare Workers configuration lives in `wrangler.jsonc`; the adapter configuration lives in `open-next.config.ts`.

Useful local commands:

```bash
npm run cf:build
npm run cf:preview
npm run cf:deploy
```

For automatic deployment from GitHub:

1. Cloudflare Dashboard → **Workers & Pages** → **Create application**.
2. Choose **Import a repository** and select `jacobevci-lab/HRBP`.
3. Set **Production branch** to `main`.
4. Set **Build command** to `npm run cf:build`.
5. Set **Deploy command** to `npx wrangler deploy`.
6. Leave the root directory at the repository root.
7. Add required build/runtime variables and secrets in Cloudflare instead of committing them to Git.
8. Deploy first to the generated `*.workers.dev` address, then attach the production custom domain.

For the first UI-only staging deployment, a syntactically valid `DATABASE_URL` build variable is sufficient because the current dashboard and module workspaces do not require a live database during static build. Before enabling real API-backed HR records, replace this with the production PostgreSQL connectivity design (recommended: PostgreSQL through Cloudflare Hyperdrive) and configure private object storage bindings.

Recommended custom domain:

```text
hrbp.fornostsecurity.com
```

## Quality checks

```bash
npm run typecheck
npm run lint
npm run build
npm run cf:build
```

## Documentation

- `docs/PRODUCT.md` — product scope and principles
- `docs/ARCHITECTURE.md` — platform architecture and deployment profiles
- `docs/DATA-MODEL.md` — connected people data model
- `docs/SECURITY.md` — security, privacy, access and AI guardrails

## Delivery direction

The platform will be implemented in vertical slices rather than disconnected screens. Each slice must include domain model, authorization, workflow, audit, retention, UI, API contract and tests before it is considered complete.

Initial build sequence:

1. Tenant / Identity / Authorization foundation
2. Core HR + Organization + Position Management
3. Employee 360 + Document Vault
4. Recruiting → Hire → Onboarding lifecycle
5. Leave / Attendance / Time
6. Compensation + Payroll core
7. Performance + Talent + Succession
8. Employee Relations + HR Service
9. Workforce Planning + Analytics
10. AI Assistant with policy-aware retrieval

---

**Status:** enterprise foundation bootstrapped; Next.js production build and Cloudflare Workers adapter build are passing on `main`.
