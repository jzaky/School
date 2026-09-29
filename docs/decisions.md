# Decisions

Ambiguities resolved during the build. Newest last.

## 2026-09-28 Starting state
- The instructions say `prisma/schema.prisma`, `prisma/rls.sql` and `src/lib/tenant-db.ts` were already built and tested. The repository was empty (no commits, no remote branches). These three files are built from scratch in Phase 1, together with the isolation suite that proves them.
- The master spec section of the instructions contains only the five reference repository URLs. docs/master-spec.md saves it verbatim. Where the build phases refer to "every service in the master spec", "the full form template library" and "every node type in the master spec", the lists are defined here from the hero flows, the overrides and common school operations, and are recorded below as they are decided.
- `[DATE]` in the deadline is a placeholder. Treated as "as soon as possible"; the production URL must work at every checkpoint.

## cal.diy license
- The cloned cal.diy repo carries an MIT LICENSE, but CLAUDE.md groups it with the GPL/AGPL repos. CLAUDE.md wins, so nothing from cal.diy is copied; slot logic is reimplemented.

## Routing and locale
- Product routes live under `src/app/(app)/[locale]/...` (`/en/...`, `/ar/...`). The marketing site lives under `src/app/(marketing)` at `/` and `/demo`, with the locale read from a cookie and a toggle that sets it. Two root layouts, one per route group.

## Worker and retention
- The worker imports `src/server/queue-core.ts` and `src/server/demo/run-reset.ts`, which carry no `server-only` or Next.js request imports. `src/server/queue.ts` re-exports the queue core for the app. `runDemoReset` in the `"use server"` module is no longer exported, because every export of such a module is callable from the browser without the checks in `resetDemoAction`.
- `DeliveryStatus` has no in-flight state, so the worker claims an outbound row by moving it from `QUEUED` to `SENT` before calling the provider, then fills `sentAt` and `providerId`. Delivery is at most once: a crash between the claim and the provider call loses that message rather than sending it twice.
- One-off jobs (reminders, retention, `test.idempotent`) claim a `JobRun` row with `INSERT ... ON CONFLICT DO NOTHING` inside the same tenant transaction as their work, so a rollback frees the key for a retry.
- The sweeper's catch-up email for a lost `deliver` job has the subject and link but not the body, because the body is only carried in the job payload.
- Demo addresses use the reserved `.example` domain. The worker never sends to reserved domains and records them as `suppressed:reserved-domain`.
- Retention is conservative. DELETE is applied only to in-app notifications and AI drafts. Audit events are append-only for `app_user` (prisma/rls.sql), so the audit policy is counted and reported as `requires_owner`. REVIEW and ANONYMIZE policies never change records: eligible rows (closed requests and cases, and inactive students past the period) are counted into `lastRunCount` for a human to act on. Each run writes one `retention.sweep` AuditEvent with counts only.
- Automatic reminders for meetings linked to wellbeing or safeguarding cases go to the host only.

## People admin
- Staff are memberships that hold at least one staff role and are not linked to a student or guardian record. Adding a staff member creates the global User only when the email is new; an email that already belongs to this school is refused.
- `INVITED` means the account is prepared but sign-in stays off (auth only accepts `ACTIVE` memberships). An administrator activates it from the Staff tab. No email is sent; sign-in is through the school's SSO or a password set up by IT.
- Suspension is enforced in two places that already existed: `resolveActiveMembership` (password, OAuth and org switch) and `getCtx`, which rejects a non-active membership on every request, so an open session ends at the next page load.
- Guardrails: a member cannot suspend themselves or remove their own `school_admin` role, the last active `school_admin` can be neither suspended nor demoted, and only members with `school.manage` can grant, remove or suspend administrator access (a registrar with `people.manage` cannot escalate).
- CSV import validates in the browser for the preview and again on the server with the same module (`src/lib/people-csv.ts`). Grades are integers 1 to 13 (the schema stores `gradeLevel` as Int and has no KG levels). Dates accept `YYYY-MM-DD` or `DD/MM/YYYY`. Students upsert by `(orgId, studentNo)`, guardians match by email within the school, links are unique per guardian and student, and each row is its own transaction. Error entries hold only row number, field name and a code. Blank Arabic names fall back to English; blank identifiers never erase stored ones.

## Workflow builder
- The canvas always opens with an automatic top-to-bottom layout (src/server/workflows/layout.ts) and "Tidy layout" re-runs it. Saved positions are kept in the graph but are not relied on, and unsaved-change detection ignores positions.
- Validation (src/server/workflows/validate.ts) is one pure function used by the live Checks panel and again by the publish action. Loops are rejected because the engine runs each step once per request.
- Approval and condition steps must connect both exits (approved and rejected, yes and no). Seeded workflows all pass.
- A workflow counts as safeguarding when any SAFEGUARDING service uses it. It must open a SAFEGUARDING case assigned to role dsl, every approval, assign, task and meeting step must route to dsl, deputy_dsl or the case owner, and notify steps cannot target the student or guardians. The inspector only offers those choices, and validation enforces them on publish.
- Due dates and waits are edited in days in the UI and stored as hours (dueInHours, hours) as the engine expects.
- Adding a step while a step is selected inserts it after that step and relinks the path; with nothing selected it lands unconnected in the middle of the view.
- Draft with AI always loads the result as an unsaved draft. When no model is configured, a deterministic drafter builds a linear approval chain from English or Arabic keywords (parents, teacher, head of department, counselor, nurse, registrar, principal, IT, office, letter, meeting).
- Publishing appends WorkflowVersion n+1 and moves publishedVersionId; runs in progress keep their workflowVersionId. Linking workflows to services stays in the services admin.

## Hero flow E2E
- A parent or guardian who submits a request has given consent by submitting it. When an approval step resolves to guardians and one of them is the requester, the engine records that guardian's row as approved at submission (with a timeline event and an `approval.approved` AuditEvent, `meta.onSubmit`), instead of asking them to approve their own request. For a parallel-any step that settles the step; for sequential or parallel-all steps the other approvers still decide. This makes a parent-submitted subject change go straight to the teacher, then the Head of Computing, then the Registrar. It lives in the engine, so it applies to new requests without a demo reset; the seeded workflow graph did not need to change.
- When a family books a real slot before filling in a meeting form, the form's `withWhom`, `preferredDate` and `preferredTime` questions are hidden, because the booking already answers them.
- Booking a meeting from a case closes the workflow's open "book a meeting" task for that case.
- A parent sees a child's meeting on a wellbeing or safeguarding case (meetings list, meeting page, .ics, home widget, calendar) only when staff invited them to it. Meetings on standard cases, such as an academic referral meeting, show normally, including on the parent's calendar.
- The Playwright suite (`tests/e2e`, `playwright.config.ts`) creates its own requests and bookings on the demo school and never resets it, so it can run against a shared or production database. It signs in through `/demo` personas and runs every hero flow in English and Arabic.
- Curriculum: a standard counts as "planned" when any lesson plan (draft, submitted, changes requested or approved) links to it; approved coverage is shown separately. Missing means no plan, "covered only once" means exactly one plan, covered means two or more. Coverage for a framework matches plans by the framework's subject and grade, optionally filtered to one class. Drafts are private to their author in lists, but still count in the aggregate coverage numbers.
- Curriculum: any member with `curriculum.plan` can plan for any subject and grade that has a framework (their own classes are listed first). This lets the demo teacher Daniel Carter, who teaches Physics 9 in the core seed, plan the Grade 9 Computing class the brief asks for. Plans are reviewed by the head of the subject's department; school leaders (`admin.access`) can review any subject. Nobody reviews their own plan.
- Curriculum: the "Grade 10 Science" demo framework is attached to Physics, since plans and frameworks are keyed by one subject. Standard statements are written generically in the style of the UK National Curriculum and UAE MoE outcomes, not copied from any document.
- Curriculum: document import reads PDF text with a small built-in extractor (Flate streams, object streams, ToUnicode maps), because no PDF parsing library is installed. Scanned PDFs have no text and the person is asked to paste instead. The deterministic fallback for both "curriculum_import" and "lesson_plan" works without an API key; AI output is never saved until a person accepts it, and accepted unit plans are always DRAFT with aiDrafted set.
- Curriculum: lesson plan bodies are bilingual. Activities and materials are JSON with en and ar fields; differentiation is stored as a JSON string {"en","ar"} in its text column. The editor edits one language at a time, and views fall back to the other language when a field is empty.
