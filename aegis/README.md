# AEGIS

Enterprise AI governance, authorization, security and assurance platform. Organizations register their AI agents, define what each agent may do, enforce those boundaries at runtime before anything executes, route elevated actions to human approvers, and keep tamper-evident evidence of everything that happened.

Four products on one platform: **Control** (authorization and the action gateway), **Assurance** (evidence ledger, monitoring, governance reporting), **Shield** (sensitive-data protection, tool security, incidents) and **Audit** (document assessment against governance frameworks and remediation).

## Repository
```
apps/api       Fastify API and Action Gateway (port 4000)
apps/web       Next.js console and public site (port 3000)
apps/worker    Job worker (approval expiry, monitoring, evidence checkpoints)
packages/core  Domain modules: identity, orgs, agents, policy, gateway, approvals, evidence, monitoring, shield, incidents, audit, integrations
packages/db    Prisma schema, migrations, row-level security, tenant database helper
packages/sdk   TypeScript client for agents and downstream systems
deploy/        Dockerfile, Docker Compose, Kubernetes manifests
docs/          Architecture, research, policy language, API, security, deployment, status
```

## Quick start
See `docs/DEPLOYMENT.md`. In short: PostgreSQL 16 with an owner role and a non-owner app role, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, then start the api, web and worker. Sign in to the synthetic demo tenant with the credentials the seed prints.

## Status
`docs/STATUS.md` lists what is implemented, tested, simulated and missing, phase by phase. `docs/IMPLEMENTATION_REPORT.md` is the detailed report produced at the end of the build.

## Honesty notes
Demo data is synthetic and labelled. The evidence ledger is tamper-evident, not immutable. Prompt-injection detection produces signals, not guarantees. Automated compliance evidence shows that controls operated inside AEGIS; it does not prove organizational compliance with any standard. AEGIS has no customers, certifications or independent audits.
