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
- University application tracker (worktree branch, not yet merged): /career/applications (student and parent), /career/applications/[id], /career/applications/manage (pipeline board with drag and stage menu, filters, bulk task planning), /career/applications/letters (teacher letter requests). Deadline engine with source labels, late-start compression and dependency alignment; idempotent task generation and reconcile; daily reminders job; calendar deadlines; seed prisma/seed/academics/applications.ts. Tests: tests/unit/applications.test.ts, tests/integration/applications.test.ts.

### Pathway engine (engine module)
- Global catalog seed (59 canonical subjects, 43 fields, 141 career links, 181 curriculum courses, 92 universities, 256 programmes, 512 intakes, 1,653 EXAMPLE requirement rows), scripts/seed-catalog.ts, run on deploy and before every demo seed.
- Pure engine in src/server/pathway-engine (evaluate, grade scales, unlock ranking, what-if, planner), service and actions, University planning pages at /career/pathways (hub, plan builder with approval, what-if, programme requirements), nav and guide steps, demo plans for Adam and four other students. 63 unit tests and an integration test.

### Programme search and comparison (discovery)
- /career/pathways/search: full text and filters (countries, field, degree type, level, language, tuition band, intake, curriculum, match status), four sorts, pagination, match chips from the engine cache, add to shortlist, compare selection. /career/pathways/compare?ids=: side by side facts, deadlines, confidence and source, requirements aligned by canonical subject with the student's status per line; stacked cards with a switcher on mobile.
- /career/universities and its manage page are paged and filtered in the database. Universities and programmes in the Ctrl K search. Demo script section 9 and tests/e2e/pathways-hero.spec.ts; unit tests in tests/unit/discovery.test.ts.

### Access management and joining (access module, worktree branch)
- /admin/roles (roles with member counts, plain-language permissions grouped by area with typed confirmation for sensitive ones, create, copy, rename, restore default, delete with move, members, Access check), a Roles control on /admin/people, /admin/invitations (staff single and CSV, parents, students, all families, resend, revoke, staff join links with QR, family join code with printable poster PDF, How people sign in), /admin/join-requests (match hints, approve with chosen children or roles, reject with a note, nav badge). Public /join/[token], /join (school code, children verification, rate limits, lockout) and /join/waiting. First-run cards for new parents and teachers, school switcher. Seed prisma/seed/access.ts. Tests: tests/unit/access.test.ts, tests/integration/access.test.ts, tests/e2e/access.spec.ts.

## In progress
- Global University Requirements + Academic Pathway Engine (owner spec, Sept 2026). Done: reference analysis (docs/university-engine-reference-analysis.md), schema with a shared global catalog (nullable orgId, RLS read-global/write-own, tests/integration/global-catalog-isolation.test.ts), evidence fields, permissions (planner.approve, applications.manage, catalog.review). Building in parallel: engine (canonical subjects, curriculum mappings for 8 curricula, global catalog, deterministic match, unlock, what-if, goal-first planner, /career/pathways), pipeline (sources, fetch and hash, validated extraction, review queue, change monitor, Scorecard), applications (tracker, deadline engine, tasks, reminders). Next wave: transcript import and mapping review, counselor dashboard, parent view, compare and global search, demo hero flow, E2E, deploy.

## Grades module
- /grades: spreadsheet-style gradebook with autosave, keyboard navigation, Excel paste, excused and comments, weighted averages and bands; publish with one notification per assessment and student; student and parent views of published grades with child switcher and term trend; staff overview (class averages, students below a threshold); grade band settings; bilingual term report card PDF stored as a GENERATED document. Seed: prisma/seed/academics/grades.ts. Tests: tests/unit/grades-calc.test.ts, tests/integration/grades.test.ts.

## Broken
- Nothing known. Production: https://myhorizon.up.railway.app (press Reset demo after each deploy to load new seed data).

## Next
1. Deploy and smoke test the hero flows on the deployed URL in en and ar.
2. Run the E2E suite against production (E2E_BASE_URL) and fix anything environment-specific.
3. Phase 7 QA pass on production.

## Requirement data pipeline (catalog review)
- Built: source registry, polite fetcher with normalization and hashing, evidence-validated extraction (rule-based offline, AI on demand), versioned publishing with structured diffs and severity, change monitor with staff notifications, Scorecard import into the global catalog, worker jobs `catalog.refresh` (weekly) and `catalog.scorecard`, review screens under Career > Catalog review, demo seed `prisma/seed/catalog/pipeline-demo.ts`.

## Transcripts, school catalog and counselor dashboard (pathway engine, wave 2)
- Built: transcript import (CSV with downloadable template, XLSX via a small built-in reader, text-based PDF via the curriculum PDF extractor, manual entry) at /career/pathways/imports; mapping review at /career/pathways/imports/[id] (code, normalized name and fuzzy matching with confidence, confirm, choose another course, keep local, idempotent commit with before/after match changes per programme and per row); course record tab at /career/pathways/[studentId]/courses and /career/pathways/courses (students) with mapping chips, edits, mapping fixes and the Grades module "Use current average" suggestion; school course catalog admin at /career/pathways/catalog; counselor dashboard at /career/pathways/dashboard from cached RequirementMatch rows with a Recompute button. Seed: prisma/seed/academics/transcripts.ts. Tests: tests/unit/transcripts.test.ts, tests/integration/transcripts.test.ts.
