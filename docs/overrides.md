# Overrides

========================================
PRIORITIES
========================================
P0: 5 hero flows perfect end to end, all portals, persona switcher, demo reset, landing page, Arabic/RTL, safeguarding flow, compliance page, deployed URL.
P1: Services hub, form builder, workflow builder (visual, working on templates), case management, calendar, dashboards, notifications, document generation, career guidance, AI assistant features.
P2: Everything else in the master spec. Build P2 only when P0 and P1 are complete and stable on production.
If time runs short, cut P2, never P0 quality.

========================================
ARABIC + RTL
========================================
- Full bilingual UI, English and Arabic, switchable per user, saved to profile. School sets the default language.
- Proper RTL: dir="rtl" at the root, logical properties everywhere, mirrored directional icons and layouts. Charts, calendars, tables, drawers and the command palette must be correct in RTL.
- Quality Arabic font (IBM Plex Sans Arabic or Noto Kufi Arabic) with correct line height.
- Bilingual data: students, parents and staff have English and Arabic names. Search matches both. Display follows the user's language with fallback.
- Bilingual services, form labels, workflow names, notifications, email and SMS templates, all editable per language by admins.
- Bilingual document templates: English only, Arabic only, or side-by-side bilingual PDF, with correct Arabic shaping.
- Gregorian dates by default, optional Hijri display. Western or Arabic-Indic numerals option.
- The AI assistant responds in the user's language.
- Arabic copy must read natively, not machine-translated.

========================================
SAFEGUARDING / CHILD PROTECTION
========================================
- Roles: Designated Safeguarding Lead (DSL) and Deputy DSL.
- A Safeguarding Concern service any staff member can submit, one click from the teacher dashboard.
- Safeguarding cases are restricted:
  - Visible only to DSL, Deputy DSL and explicitly granted staff.
  - The referrer sees only "Received" and "Being handled", never notes or outcomes.
  - Excluded from global search, dashboards, analytics and parent/student portals.
  - Principal access is audited.
- Concern levels: Low, Medium, High, Immediate danger. Immediate danger alerts DSL and Deputy DSL on every channel instantly and shows emergency guidance to the submitter.
- Parent notification is never automatic. It is a documented DSL decision with a reason. The same rule applies to wellbeing and counseling cases unless the counselor chooses to notify.
- Immutable chronology: every action, decision and contact timestamped. Notes can be amended, never deleted. Amendments are versioned.
- External referral log: agency (for example a Child Protection Unit), date, reference number, contact.
- Confidential student "I need to talk to someone" request that routes only to wellbeing and DSL staff.
- Break-glass emergency access requires a written reason, alerts the DSL and is audited.
- Separate retention policy and export controls (export by DSL only, audited).
- Demo: one fictional, non-graphic, low-level safeguarding case to show the flow. Tasteful for a school audience.

========================================
UAE COMPLIANCE (engineering controls, document in docs/compliance.md)
========================================
- UAE PDPL (Federal Decree-Law No. 45 of 2021): purpose tracking, consent records, data subject requests (access, correction, deletion) handled in the admin panel, breach log, cross-border transfer controls.
- Minors: parental consent capture where required, with a consent log per student.
- UAE child protection law (Federal Law No. 3 of 2016): support reporting duties through the safeguarding module and external referral log.
- KHDA (Dubai) and ADEK (Abu Dhabi): regulator configurable per tenant, with inspection-ready reports on wellbeing, attendance and support provision.
- Data residency: architecture supports a UAE hosting region. Data region is a tenant setting.
- Emirates ID and passport: optional per school policy, encrypted, masked by default, reveal is permission-checked and audited.
- AI: tenant-level controls. Counseling, wellbeing, safeguarding and medical data never go to an AI provider unless the school enables it. Sensitive AI output always needs human review.
- Configurable retention periods per record type, with automated review and deletion jobs.
- Encryption for sensitive fields, full audit log.
- Admin Compliance page showing all of these controls, since schools will ask in the demo.
- Locale defaults: Asia/Dubai, Monday to Friday school week, AED.

========================================
BUILD PHASES
========================================
Work through every phase in order without waiting for me between phases. At the end of each phase run the END OF PHASE ROUTINE, then continue straight into the next phase.

PHASE 0 (keep under 30 minutes)
- docs/plan.md: architecture, module map, build order, deployment architecture, how the demo tenant runs on the same production app.
- docs/reference-analysis.md: for each of the 5 reference repos in the master spec, the license, the patterns we take, and any permissively licensed code we copy. Shallow-clone into /tmp to inspect. Do not add them to our repo.

PHASE 1: Foundation
1. Next.js with Tailwind, shadcn/ui and next-intl. Switching English and Arabic flips the whole layout to RTL correctly.
2. Auth.js email/password working. Google and Microsoft wired, switchable by env.
3. Session carries activeOrgId. Every server action and route handler gets its db from tenantDb(session.activeOrgId).
4. Seed system roles (including DSL and Deputy DSL) and permissions. A can(membership, permission) helper with tests.
5. db:migrate script: prisma migrate, then prisma/rls.sql.
6. Vitest tenant isolation suite against real Postgres proving School A cannot read, update, insert into or delete School B data across Student, Case, Request, Document and Appointment.
7. App shell: sidebar, top bar, language toggle, Cmd/Ctrl+K command palette, premium theme with Horizon branding. Linear and Stripe quality, not generic school software.
8. Worker process with BullMQ and one idempotent test job.
9. Deployed on Railway: web, worker, Postgres (app_user and owner roles), Redis. Report the live URL.
10. Tell me exactly which env vars and keys you need from me.

PHASE 2: School, people, services, forms
1. School structure admin: campuses, academic years, departments, subjects, classes, enrollments. Full CRUD with good tables, filters and drawers.
2. Students, staff and guardians with bilingual names, guardian links (multiple children per parent) and profile pages. Emirates ID and passport encrypted, masked, reveal audited.
3. Re-runnable demo seed: Horizon International School Dubai with 75+ students, 20+ teachers, 50+ parents, all staff roles and all personas. Bilingual, dates relative to now.
4. Services Hub: role-aware cards from ServiceDefinition, searchable, categorized, bilingual. Seed every student and teacher service in the master spec.
5. Form renderer: all field types, multi-step, sections, validation, conditional show/hide, auto-save drafts, prefill from student context.
6. Form builder: dnd-kit drag and drop, field settings drawer with bilingual labels, conditional logic editor, preview, publish creates a new FormVersion, clone. Seed the full form template library from the master spec.
7. Submitting a service form creates a Submission and a numbered Request with a timeline entry.
8. CSV import for students, staff and guardians with column mapping and an error report.

PHASE 3: Workflows, approvals, cases, tasks, safeguarding
1. Workflow engine executing published WorkflowVersions with every node type in the master spec. Wait nodes use delayed BullMQ jobs. Each step writes a WorkflowStepRun with an idempotency key. Retries are safe.
2. Approval engine: sequential, parallel-all, parallel-any and conditional. Approvals inbox with approve or reject plus comment.
3. Visual workflow builder with React Flow: node palette, bilingual config drawers, condition editor, validation before publish, versioning, duplicate.
4. Seed workflow templates: Academic Concern, Behavioral Referral, Career Guidance, Subject Change, Document Request, Parent Meeting, IT Support, Learning Support, Wellbeing Referral, Safeguarding Concern.
5. Case list with saved views and filters. Case page with header (student, type, number, assignee, priority, status, SLA countdown) and tabs: Overview, Timeline, Appointments, Tasks, Documents, Forms, Communications, People, Audit Log.
6. Tasks: My tasks, Team, Overdue, Today, Upcoming, linked to cases, students and requests.
7. Full safeguarding module as specified above.
8. Integration tests for the workflow engine, approvals, and proof that a teacher who referred a safeguarding case cannot see its notes.

PHASE 4: Scheduling, calendar, career, documents
1. Appointment types (duration, buffers, notice, daily max, location, intake form, specific or round-robin hosts). Staff availability and date overrides. Slot calculation that respects Asia/Dubai, buffers and existing bookings, with tests.
2. Premium booking flow: service, advisor, day, time, intake questions, confirm. Reschedule and cancel. Confirmation plus 24h and 1h reminder jobs. Booking updates the linked case and timeline and notifies staff.
3. Calendar: day, week, month, agenda, plus staff, department and student schedules. Appointments, tasks, events, deadlines, follow-ups, with filters. Correct in RTL.
4. Career guidance: career profile, aptitude assessment across all 9 dimensions with deterministic scoring, recommendations from a seeded bilingual catalog of 40+ careers with match score and reasoning, DRAFT until counselor approval, Career Explorer pages, university shortlist with reach/target/safety, requirements checklist, statuses and deadlines. Seed universities weighted to UAE, UK, US, Canada and Europe.
5. Documents: upload to R2 with signed URLs, categories, versions, expiry, sensitivity permissions, audit on every view or download of sensitive documents.
6. Document templates with merge fields and English, Arabic or bilingual PDF output. Seed Enrollment Confirmation Letter and Transcript Cover Letter.

PHASE 5: Hero flows, portals, notifications, AI (most important phase)
1. All 5 hero flows from the master spec working end to end on real data with Adam and Rania Nasser:
   - Career Guidance: assessment, results, choose AI Engineer, book Layla, Layla sees full context, action plan, tasks to Adam, appropriate parent update.
   - Teacher Referral: Daniel refers for Academic Support, case created, counselor notified, parent meeting booked, action plan, follow-up.
   - Document Request: Enrollment Letter, prefilled, registrar approves, bilingual PDF generated, student notified.
   - Subject Change: Physics to Computer Science through parent, teacher, department head and registrar, with a beautiful progress timeline.
   - Parent Meeting: Rania picks child, teacher, slot. Both calendars, confirmation and reminder.
2. Portals:
   - Student: greeting, today, next meeting, tasks, request status timelines, services.
   - Teacher: classes, students, referrals, approvals, schedule, Refer Student quick action.
   - Counselor: today, urgent cases, overdue follow-ups, new referrals, full student context page.
   - Parent: only authorized children, multiple children, approvals, signatures, meetings.
   - Admin: KPIs and charts (requests by service, cases by department, resolution time, SLA compliance, appointment utilization).
3. Notification center, in-app plus email, with per-user preferences.
4. Communications on the case timeline (internal message and email).
5. AI through the provider abstraction: counselor pre-meeting summary and suggested questions, teacher referral draft from notes, action plan draft, form generated from a sentence, workflow draft from a sentence, admin questions like "which services are slowest this month". Sensitive data rules apply.
6. Playwright E2E tests for all 5 hero flows in English and Arabic, passing against production.

PHASE 6: Demo layer and polish
1. Landing page: hero "One portal for every school procedure", the master spec subtitle, "Explore the Live School" and "Book a Demo" CTAs, sections built from real interactive product components, language toggle.
2. Persona chooser: Admin, Principal, Teacher, Counselor, Career Advisor, DSL, Student, Parent. One click logs in as that persona. Persona switcher always available in demo mode.
3. Guided walkthrough overlay for each hero flow plus safeguarding and the compliance page, usable live in a sales meeting.
4. Demo reset restores the seed in under 30 seconds, available to demo users, and runs automatically every night.
5. Admin Compliance page.
6. Arabic audit script that fails if any UI string lacks an ar translation or any component uses non-logical direction classes. Fix everything it finds.
7. Mobile pass on student and parent portals. PWA installable.
8. docs/demo-script.md: a 10-minute scripted walkthrough.

PHASE 7: QA only, no new features
1. List every route. For each persona, in English and Arabic, at desktop and mobile widths, use Playwright to visit every route and click every interactive element. Log anything that errors, does nothing, overflows, or shows English in Arabic mode. Fix every item.
2. Zero console errors and zero failed network requests on main pages.
3. Run demo reset 3 times in a row, running all 5 hero flow E2E tests after each. All must pass.
4. Run the tenant isolation suite and safeguarding access tests.
5. Main pages feel instant after first load, with skeleton loaders everywhere.
6. Final deploy, then give me a go/no-go report: what's solid, what to avoid clicking in the demo, and anything at risk.

P2 FEATURES: only after Phase 7 passes, build remaining master spec items, re-running the Phase 7 checks after each.
