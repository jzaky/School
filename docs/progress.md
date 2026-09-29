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
- Workflow builder at /admin/workflows (workflows.manage): list with linked services, live version, steps, runs in 30 days and in progress; React Flow canvas with auto layout, palette, inspector for every node type, live validation that blocks publishing, dry-run simulation with approve/reject and yes/no choices, Draft with AI (workflow_draft, built-in keyword drafter fallback), save draft, revert, publish to a new immutable WorkflowVersion, version history. Safeguarding workflows keep DSL routing (validated client and server side).
- Calendar (day, week, month, agenda; scopes; RTL), career guidance (assessment, scoring, matches, explorer, shortlist, advisor review), documents (upload, versions, family sharing, expiry), notifications inbox, settings (language, numerals, Hijri, email preferences), analytics with AI questions over aggregates.
- Admin: school setup, people with CSV import (idempotent), service catalog, form builder (dnd-kit, conditions, preview, versioned publish, AI draft), workflow builder (React Flow, validation, simulation, versioned publish, AI draft, safeguarding routing guard), document templates with live PDF preview, compliance (AI safeguards, ID policies, transfers, retention, purposes and consent, data subject requests, incidents), audit log with CSV export.
- Worker (BullMQ): outbound delivery (Resend or log), reminders, workflow waits, sweeper, retention, nightly demo reset, idempotent jobs; tests.
- Landing page, PWA manifest and icons, per-persona demo guide, i18n audit (`npm run audit:i18n`), mobile pass at 390px (no horizontal overflow in en or ar).
- Deploy config: Dockerfile, railway.json, railway.worker.json, docs/deploy.md. ESLint flat config (0 errors).
- Docs: docs/demo-script.md, docs/compliance.md.
- Tests: 92 unit and integration tests passing. Playwright E2E for the five hero flows in en and ar (10 specs) passing locally; one intermittent failure seen once in 4 full runs (subject change, ar), passed on rerun.
- Demo reset measured at 15s locally.

- Subject registration and automatic class allocation: /admin/registration (offerings per grade with core and option blocks, prerequisites, registration window, rosters with section moves, CSV sheet import with preview), /subjects for students and parents (child switcher; staff register on behalf), /classes and /classes/[id] rosters, allocation engine with unit tests, subject change hook in the workflow engine, seed for grades 6 to 12.
- University pathways: programme catalogue (UK, US, UAE, Jordan, Canada, Australia, Europe; all indicative until checked), requirements checker across British, IB, American, UAE MoE and Tawjihi, grades and scores with counselor confirmation, shortlist integration, AI pathway advice draft, counselor admin and College Scorecard importer (snapshot pending an API key).

- Academic modules (merged and verified together): subject registration with automatic class allocation and Excel import; teacher assignment, clash-free timetable generation and staff absence with automatic substitute cover; grades with publishing and bilingual report cards; academic calendar with UAE holidays, exam schedules and trips with consent letters; university pathways (UK, US, UAE, Jordan, Canada, Australia, Europe) with a requirements checker per curriculum including Tawjihi and a College Scorecard importer; curriculum frameworks, lesson plans, coverage gaps, AI-drafted units and head of department review.
- Checks after merging: 208 unit and integration tests, lint 0 errors, i18n audit, every nav link for all 11 personas in en and ar, mobile overflow check, and the 10 hero-flow E2E specs all pass. Demo reset with all modules: 22s locally.

## In progress
- Nothing locally. Waiting on deployment access.

## Grades module
- /grades: spreadsheet-style gradebook with autosave, keyboard navigation, Excel paste, excused and comments, weighted averages and bands; publish with one notification per assessment and student; student and parent views of published grades with child switcher and term trend; staff overview (class averages, students below a threshold); grade band settings; bilingual term report card PDF stored as a GENERATED document. Seed: prisma/seed/academics/grades.ts. Tests: tests/unit/grades-calc.test.ts, tests/integration/grades.test.ts.

## Broken
- Deployment blocked: this environment's network policy denies backboard.railway.com. Deploy by connecting Railway to the GitHub repo (docs/deploy.md), or allow the host and provide a Railway token.

## Next
1. Deploy and smoke test the hero flows on the deployed URL in en and ar.
2. Run the E2E suite against production (E2E_BASE_URL) and fix anything environment-specific.
3. Phase 7 QA pass on production.

## Requirement data pipeline (catalog review)
- Built: source registry, polite fetcher with normalization and hashing, evidence-validated extraction (rule-based offline, AI on demand), versioned publishing with structured diffs and severity, change monitor with staff notifications, Scorecard import into the global catalog, worker jobs `catalog.refresh` (weekly) and `catalog.scorecard`, review screens under Career > Catalog review, demo seed `prisma/seed/catalog/pipeline-demo.ts`.
