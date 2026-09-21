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
- GitHub Actions CI for type checking and production builds

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

## Quality checks

```bash
npm run typecheck
npm run lint
npm run build
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

**Status:** enterprise foundation bootstrapped; CI typecheck and production build passing on `main`.
