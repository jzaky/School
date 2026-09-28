# Build Plan

## 1. Architecture

One Next.js application serves the marketing site, the demo entry and the product. The demo school is an ordinary tenant in the production database. There is no separate demo build.

```
Browser
  |
  v
Railway "web" service (Next.js App Router, Node runtime)
  - src/app/(marketing)          landing page, persona chooser, demo entry
  - src/app/(app)/[locale]/...   the product (en, ar)
  - src/app/api/...              Auth.js, uploads, PDF, webhooks, health
  - src/server/<module>          domain logic, server actions call into here
        |                    \
        | tenantDb(orgId)      \ enqueue jobs (BullMQ)
        v                        v
  Railway Postgres            Railway Redis
  (RLS on every tenant table)    ^
        ^                        |
        |                        |
Railway "worker" service (src/worker, BullMQ processors)
  - workflow steps, wait timers, reminders, notifications,
    retention sweeps, nightly demo reset
        |
        v
  External providers behind abstractions:
  Resend (email), console SMS/WhatsApp, Cloudflare R2 (documents), AI provider
```

### Tenancy and data isolation
- Every tenant table carries `orgId`. `prisma/rls.sql` enables Row-Level Security on each of them with a policy of `orgId = current_setting('app.current_org_id')`.
- The app connects as `app_user` (no ownership, no BYPASSRLS). Migrations and seeds connect as the owner role through `MIGRATION_DATABASE_URL`.
- `src/lib/tenant-db.ts` exposes `tenantDb(orgId)`: a Prisma client extension that runs every operation inside a transaction that first calls `set_config('app.current_org_id', orgId, true)`. It also fills `orgId` on creates. `tenantTx(orgId, fn)` gives an interactive transaction with the same guarantee.
- Pre-tenant lookups (login, choosing an organization) use `userDb(userId)`, which sets `app.current_user_id` so a user can read only their own memberships and the organizations they belong to.
- Defense in depth: the application filters by org too, but the database is the enforcement point. The isolation suite proves it against real Postgres.

### Identity and access
- Auth.js v5 with JWT sessions. Providers: credentials (email and password, bcrypt), Google and Microsoft Entra ID (enabled only when their env vars exist), and a demo persona provider that only works for organizations flagged `isDemo` while `DEMO_MODE=true`.
- The session carries `userId`, `activeOrgId`, `membershipId` and the role keys. Switching organizations or personas rewrites the token.
- Roles are rows (`Role`) with permission keys. System roles are seeded per org: Platform Admin, School Admin, Principal, Registrar, Department Head, Teacher, Counselor, Career Advisor, Wellbeing Lead, DSL, Deputy DSL, IT Support, Nurse, Student, Parent.
- `can(membership, permission)` is the single permission check. Sensitive cases go through `src/server/access/case-access.ts` only.

### Modules (src/server)
| Module | Responsibility |
|---|---|
| identity | users, memberships, roles, permissions, sessions, persona login |
| schools | campuses, academic years, departments, subjects, classes, enrollments |
| students | students, staff, guardians, guardian links, CSV import, encrypted IDs |
| services | service catalog, service hub, requests and numbering |
| forms | form definitions, versions, drafts, submissions, renderer schema |
| workflows | workflow definitions, versions, engine, step runs, approvals |
| cases | cases, notes (versioned), tasks, saved views, SLA |
| safeguarding (inside cases + access) | concern levels, chronology, referrals, break-glass |
| appointments | appointment types, availability, slot calculation, bookings, calendar |
| documents | storage (R2), versions, templates, PDF generation |
| career | profiles, aptitude, recommendations, careers catalog, universities |
| communications | case messages, email threads |
| notify | notification center, preferences, delivery channels |
| analytics | KPIs and charts (never includes sensitive cases) |
| ai | provider abstraction, prompts, sensitive-data guard |
| audit | AuditEvent writer and viewer |
| access | case-access module, break-glass, reveal of encrypted fields |
| compliance | consent, DSR, breach log, retention, regulator reports |
| demo | persona list, reset, guided walkthroughs |

### Front end
- next-intl with `en` and `ar`. The locale lives in the URL for the product (`/en/...`, `/ar/...`), and in a cookie for the marketing site. Users save a preferred language on their profile; the organization sets the default.
- `dir="rtl"` at the html root in Arabic. Tailwind logical classes only. Directional icons flip with `rtl:rotate-180` or the `DirIcon` helper.
- Fonts: Inter for Latin, IBM Plex Sans Arabic for Arabic.
- shadcn/ui primitives (Radix), Framer Motion for motion, Recharts for charts, React Flow for workflows, dnd-kit for the form builder, cmdk for the command palette.

## 2. Build order
Phase order from docs/overrides.md, with this internal order so the hero flows get the most depth:
1. Data layer: schema, RLS, tenant client, isolation tests.
2. Auth, session, can(), i18n, app shell, persona login.
3. Seed: the whole Horizon tenant, bilingual, months of history.
4. Services, forms, requests. Workflow engine and approvals.
5. Cases, tasks, safeguarding.
6. Appointments and calendar. Documents and PDF. Career guidance.
7. Portals per role and the 5 hero flows end to end.
8. Notifications, communications, AI.
9. Landing page, walkthroughs, demo reset, compliance page.
10. Arabic audit, mobile, PWA, QA.

## 3. Deployment architecture (Railway)
| Service | Source | Start command |
|---|---|---|
| web | this repo, Dockerfile | `node server.js` after `prisma migrate deploy` via `npm run db:migrate` in a pre-deploy step |
| worker | this repo, same image | `npm run worker` |
| Postgres | Railway plugin | owner role provided by Railway, `app_user` created by `prisma/roles.sql` |
| Redis | Railway plugin | |

- Pre-deploy runs `npm run db:migrate` (migrate deploy, then rls.sql, then role grants) as the owner role.
- `DATABASE_URL` points at `app_user`. `MIGRATION_DATABASE_URL` points at the owner.
- The worker registers a repeatable job that resets the demo tenant nightly at 03:00 Asia/Dubai.
- Health check: `/api/health` verifies the database and Redis.

## 4. How the demo tenant runs in production
- Horizon International School Dubai (`slug: horizon`) is a normal tenant with `isDemo = true`.
- The landing page's "Explore the Live School" opens the persona chooser. Choosing a persona signs in through the demo persona provider. No password is needed, and it works only for `isDemo` organizations.
- In demo mode a persona switcher lives in the top bar. Switching re-issues the session for the other persona.
- "Reset demo" (visible to demo users) deletes every row with the demo `orgId` and replays the seed with dates relative to now. Other tenants are untouched because every delete is scoped by `orgId`. Target: under 30 seconds.
- Any real school created later runs side by side, isolated by RLS.
