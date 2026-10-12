# AEGIS

Let AI agents handle routine work. Require human approval for risky actions. Keep a verifiable record of every decision.

AEGIS sits between AI agents and the systems they act on. The first workflow it supports end to end is refunds issued by an AI customer-support agent: small refunds run on their own, larger ones wait for a named approver, duplicates and anything above the limit are refused, and every decision, approval, execution grant and downstream receipt is appended to a tamper-evident ledger.

Underneath the pilot workflow sit four products on one platform: **Control** (authorization and the action gateway), **Assurance** (evidence ledger, monitoring, governance reporting), **Shield** (sensitive-data protection, tool security, incidents) and **Audit** (document assessment against governance frameworks and remediation). The console shows five everyday sections (Overview, Agents, Approvals, Activity, Settings) and keeps the specialist areas under More.

## Repository
```
apps/api       Fastify API and Action Gateway (port 4000)
apps/web       Next.js console and public site (port 3000)
apps/worker    Job worker (approval expiry, execution reconciliation, monitoring, evidence checkpoints)
packages/core  Domain modules: identity, orgs, agents, policy, gateway (plus connectors), approvals, evidence, monitoring, shield, incidents, audit, integrations, onboarding
packages/db    Prisma schema, migrations, row-level security, tenant database helper
packages/sdk   TypeScript client for agents and downstream systems
deploy/        Dockerfile, Docker Compose, Kubernetes manifests
scripts/       Smoke test of the refund journey, Stripe test-mode check, archive and style checks
docs/          Architecture, policy language, connectors, API, security, deployment, status, implementation report
```

## Local setup (about fifteen minutes)
Requirements: Node 22, pnpm 10, PostgreSQL 16 (an owner role and a non-owner app role, see `deploy/postgres-init.sql`), Redis.

```
cd aegis
cp .env.example .env                 # then: pnpm --filter @aegis/core keygen  and paste the three keys
pnpm install
pnpm db:migrate                      # migrations plus row-level security; needs MIGRATION_DATABASE_URL and AEGIS_APP_PASSWORD once
pnpm db:seed                         # synthetic tenant Meridian Gulf Bank; agent API keys land in .demo-keys.json (gitignored)
pnpm --filter @aegis/api dev         # http://localhost:4000
pnpm --filter @aegis/web dev         # http://localhost:3000
pnpm --filter @aegis/worker dev
```

Sign in at http://localhost:3000/login with a seeded persona (the seed prints them; password `AegisDemo2026!`). Start at Getting started: the checklist walks through the sample refund workflow, which needs no external credentials.

Prove the refund journey over the API: `npx tsx scripts/smoke-refund-journey.mts` (expects the api on port 4000).

Connect Stripe test mode: store an `sk_test_` key on the Stripe (test mode) integration in the console (live keys are refused), press Test connection, and run `STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/stripe-sandbox-check.mts` for the full journey against real Stripe test mode. See `docs/CONNECTORS.md`.

## Checks
`pnpm -r typecheck && pnpm -r lint && pnpm -r test` runs typescript-eslint, the tenant isolation suite, the core suite (gateway, execution safety, Stripe connector against a fake server, policy templates, Shield, Audit) and the API tests. `cd apps/web && npx playwright test` runs the console and site journeys against the dev server. CI runs the same from `.github/workflows/aegis-ci.yml` at the repository root.

## Deployment
`docs/DEPLOYMENT.md`: Docker Compose and Kubernetes, with the credential boundary (only the migrate job holds owner credentials) and shared upload storage. `docs/DEMO_TO_PRODUCTION.md` describes the path from hosted demo to pilot to production.

## Status and honesty
`docs/IMPLEMENTATION_REPORT.md` separates what is implemented, executed and verified, simulated, and remaining. Demo data is synthetic and labelled. The evidence ledger is tamper-evident, not immutable. The Stripe connector is verified against a local fake of Stripe's documented test-mode API; the live test-mode run needs a customer test key. Prompt-injection detection produces signals, not guarantees. AEGIS has no customers, certifications or independent audits.
