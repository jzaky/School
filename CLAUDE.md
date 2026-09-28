# School Operations OS

## What this is
Multi-tenant School Operations + Student Services OS.
Full spec: docs/master-spec.md
UAE, Arabic, safeguarding, compliance, priorities and build phases: docs/overrides.md
Conflicts: this file wins, then docs/overrides.md, then docs/master-spec.md.

## Deadline
Live school presentation on [DATE]. The production URL must work every day. P0 before P1 before P2.

## Hard rules
1. No dead UI. Every visible control works, is disabled with a tooltip explaining why, or is removed. Unbuilt features do not appear in the UI.
2. Never use the raw prisma client in request code. Always use tenantDb(orgId) from src/lib/tenant-db.ts. Raw prisma only in migrations, seed scripts and platform admin.
3. Every tenant table has orgId. After any schema change: run the migration, run prisma/rls.sql, run the tenant isolation tests.
4. The app connects as app_user (non-owner, non-superuser). Migrations use MIGRATION_DATABASE_URL (owner role).
5. All user-facing text goes through next-intl with en and ar messages. No hard-coded strings in components. Tailwind logical properties only (ms, me, ps, pe, start, end), never ml, mr, pl, pr, left, right.
6. Cases with sensitivity WELLBEING or SAFEGUARDING go through one access module (src/server/access/case-access.ts). They never appear in global search, dashboards, analytics or parent/student portals unless that module allows it. Every view of a sensitive record writes an AuditEvent.
7. Parents are never auto-notified on WELLBEING or SAFEGUARDING cases. Notification is a recorded staff decision with a reason.
8. All AI calls go through src/server/ai/provider.ts. Never send WELLBEING, SAFEGUARDING or medical data unless org.aiSensitiveDataEnabled is true. AI output on sensitive matters is always a draft needing human approval.
9. Background jobs are idempotent, with idempotency keys on every side effect.
10. Code reuse: copy freely from MIT, Apache or BSD sources and log it in docs/third-party.md. Do not paste source from AGPL or GPL repos (HeyForm, cal.diy, Frappe Education). Reimplement from their patterns.
11. Never log student personal data. Never commit secrets.
12. No em dashes anywhere: UI copy, seed data, docs, code comments. Use a hyphen or rewrite.

## Stack
- Next.js App Router, TypeScript, Tailwind, shadcn/ui, Framer Motion
- next-intl (en, ar) with full RTL
- Prisma + PostgreSQL
- Auth.js: email/password, Google, Microsoft (switchable by env), magic link optional
- BullMQ + Redis, separate worker process
- Cloudflare R2 (S3 API), signed URLs only
- Resend for email behind a provider abstraction. SMS and WhatsApp abstractions with a console provider for now.
- React Flow for the workflow builder, dnd-kit for the form builder
- PDF generation with correct Arabic shaping and RTL
- Vitest for unit and integration, Playwright for E2E
- Deploy on Railway: web service, worker service, Postgres, Redis

## Structure
- src/app/(marketing): landing page and demo entry
- src/app/(app)/[locale]/...: the product
- src/server/<module>/: identity, schools, students, services, forms, workflows, cases, appointments, documents, career, communications, notify, analytics, ai, audit, access
- src/worker/: job processors
- prisma/seed/: demo tenant seed
- tests/: unit, integration, e2e

## Demo tenant
Horizon International School Dubai (slug: horizon). All people fully fictional.
Personas:
- Aisha Rahman (School Administrator)
- Omar Al Mansoori (Principal)
- Sarah Ahmed (Counselor)
- Layla Hassan (Career Advisor)
- Daniel Carter (Teacher)
- Khalid Yousef (Designated Safeguarding Lead)
- Adam Nasser (Student, Grade 9)
- Rania Nasser (Parent of Adam, plus a younger sibling at the school)
Use Adam Nasser and Rania Nasser wherever the master spec says Sameh Awadalla or Mariam Awadalla.
All seed dates are relative to the current date so the demo always looks current after reset.
Seed data is bilingual, realistic, and shows months of history. No empty screens.

## Definition of done (every feature)
- Works in en and ar, desktop and mobile
- Loading, empty and error states
- Permission-checked and tenant-scoped
- Audit events where required
- Typecheck, lint and tests pass
- Deployed and verified on the production URL

## Working rhythm
- Keep docs/progress.md current.
- Commit after each working unit. Deploy at the end of every phase.
- If the spec is ambiguous, pick the option that demos best, log it in docs/decisions.md and keep going. Only stop to ask me if you are truly blocked (for example, missing API keys).
- If a session ends or I say "continue": read CLAUDE.md and docs/progress.md and resume from Next.
- Never claim something works without running it. Prove flows with Playwright against production.
