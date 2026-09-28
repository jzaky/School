# Progress

## Done
- Step 0 docs, Phase 0 plan and reference analysis.
- Data layer: prisma/schema.prisma (80+ models), prisma/rls.sql, src/lib/tenant-db.ts, db:migrate script (migrate, app_user role, RLS).
- Tenant isolation suite (20 checks) passing against real Postgres.
- Auth.js v5: password, demo persona provider, Google and Microsoft (enabled by env). Session carries activeOrgId and membershipId.
- Roles and permissions (15 system roles incl. DSL and deputy DSL), can() with tests.
- i18n en/ar with full RTL, IBM Plex Sans Arabic, logical classes only (shadcn components converted).
- App shell: sidebar, top bar, language toggle, command palette with search (no sensitive cases), notifications bell, demo bar with persona switcher and reset.
- Demo seed: Horizon (99 students, 45 staff, 112 guardians), bilingual, relative dates, real workflow runs, stable membership ids across resets. ~15s locally.
- Workflow engine (13 node types, idempotent step runs, wait timers), approval engine (sequential, parallel-all, parallel-any, conditional approvers), notifications with idempotent outbound queue.
- Services hub, form renderer (21 field types, steps, logic, drafts, prefill), booking picker, request pages with progress stepper, approvals inbox with signatures.
- Slot calculation (Dubai time, buffers, notice, daily max, overrides, round robin) with tests. Booking, reschedule, cancel, ICS, reminders.
- Bilingual PDF letters with correct Arabic shaping and bidi (pdfkit plus custom bidi runs). Document download with access checks and audit.
- Role dashboards: student, parent, teacher, counselor, career advisor, DSL, admin/principal (KPIs and charts), other staff.
- Cases: list with views, case page with 9 tabs, versioned notes, parent notification decisions, external referrals, access grants, break-glass, chronology export (DSL only for safeguarding), audit tab.
- case-access.ts module; safeguarding hub; tasks views; students list and profile (encrypted IDs with audited reveal); parent children pages; meetings pages.
- AI provider (Anthropic SDK, claude-opus-5, sensitive data guard, built-in deterministic drafter when no key): case brief, action plan draft and approval into tasks, referral draft, admin questions.
- Integration tests: workflow engine, approvals, idempotency, wait nodes, safeguarding access, rule 7. 51 tests passing.

## In progress
- Phase 4 remainder: calendar, career guidance module, documents page, document templates admin.

## Broken
- Deployment blocked: this environment's network policy denies backboard.railway.com. Railway must deploy from GitHub (see docs/deploy.md once written) or the host must be allowed.

## Next
1. Calendar (day, week, month, agenda; RTL).
2. Career guidance: assessment, scoring, recommendations (DRAFT until approved), explorer, shortlist, advisor view.
3. Documents page with upload.
4. Admin: school setup CRUD, people, CSV import, services and forms admin, form builder (dnd-kit), workflow builder (React Flow), templates, compliance page, audit log, analytics page with AI questions, notifications page and preferences, settings.
5. Worker process (BullMQ): deliver outbound, reminders, workflow resume, retention sweeps, nightly demo reset.
6. Landing page, walkthrough overlay, PWA, Arabic audit script, docs/demo-script.md, docs/compliance.md.
7. Deploy config (Dockerfile, railway.json), Playwright E2E for 5 hero flows in en and ar.
