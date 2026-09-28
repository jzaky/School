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

## Workflow builder
- The canvas always opens with an automatic top-to-bottom layout (src/server/workflows/layout.ts) and "Tidy layout" re-runs it. Saved positions are kept in the graph but are not relied on, and unsaved-change detection ignores positions.
- Validation (src/server/workflows/validate.ts) is one pure function used by the live Checks panel and again by the publish action. Loops are rejected because the engine runs each step once per request.
- Approval and condition steps must connect both exits (approved and rejected, yes and no). Seeded workflows all pass.
- A workflow counts as safeguarding when any SAFEGUARDING service uses it. It must open a SAFEGUARDING case assigned to role dsl, every approval, assign, task and meeting step must route to dsl, deputy_dsl or the case owner, and notify steps cannot target the student or guardians. The inspector only offers those choices, and validation enforces them on publish.
- Due dates and waits are edited in days in the UI and stored as hours (dueInHours, hours) as the engine expects.
- Adding a step while a step is selected inserts it after that step and relinks the path; with nothing selected it lands unconnected in the middle of the view.
- Draft with AI always loads the result as an unsaved draft. When no model is configured, a deterministic drafter builds a linear approval chain from English or Arabic keywords (parents, teacher, head of department, counselor, nurse, registrar, principal, IT, office, letter, meeting).
- Publishing appends WorkflowVersion n+1 and moves publishedVersionId; runs in progress keep their workflowVersionId. Linking workflows to services stays in the services admin.
