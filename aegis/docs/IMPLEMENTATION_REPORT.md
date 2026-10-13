# AEGIS implementation report: pilot-ready refund workflow

Build dates: 2026-10-10 to 2026-10-12. Branch `claude/aegis-ai-governance-bgmcnk`, directory `aegis/`.

This report separates four things per area: implemented (the code exists), executed and verified (it ran here and a test or a recorded run proves it), simulated (a stand-in behaves like the real thing), and remaining (not built, or built but not verified). Nothing is listed as verified unless it was run on the date above. The earlier report for the first build is superseded by this one.

## The claims that were checked first

The brief named five potential defects and asked that the earlier reports be treated as claims. All five were real.

| Claim | Finding | Fix | Verified by |
|---|---|---|---|
| Several grants per approved request allowed repeated execution | Confirmed. The agent-mode grant endpoint issued a fresh grant on every call while the request stayed `approved`; approval in agent mode also issued one, so two live grants existed and both verified downstream. | One live grant per request (application check plus a partial unique index); consuming a grant moves the request to `executing`, after which no grant is issued and no other verifies; approval in agent mode issues nothing; the agent reports its outcome instead of the gateway re-running the simulator. | `packages/core/tests/execution-safety.test.ts` (12 tests), including a raw SQL insert that the index rejects |
| Emergency pause blocked new requests but not previously approved actions | Confirmed. The pause was checked only at submission; approvals, grant issuance and grant verification ignored it. | Pause voids live grants and writes evidence; approving while paused is refused with the request kept pending; grant issuance and verification refuse while paused; approved-but-unexecuted requests can be run by an approver after resumption. Suspension and revocation also void grants. | execution-safety tests, Stripe connector test "pause blocks approval then resumes", API smoke test |
| Uploaded documents lacked persistent shared storage in the deployment templates | Confirmed. Only the database had a volume; uploads went to the container filesystem. | Shared `uploads` volume in Compose, `aegis-uploads` ReadWriteMany claim in Kubernetes, `AEGIS_STORAGE_DIR=/data/uploads` in every process, directory created in the images. | Manifest review; no runtime test of the cluster claim (see remaining) |
| Application services received the owner migration credentials | Confirmed. Compose passed `MIGRATION_DATABASE_URL` to api, worker and web; one Kubernetes secret served every pod. | Compose overrides the owner URL to empty for application services; Kubernetes splits `aegis-secrets` from `aegis-migrate-secrets`; `assertApplicationProcess` refuses to start in production when an application process finds owner credentials, and warns in development. | Startup guard runs in api, worker and web; the dev environment logs the warning |
| Lint commands were placeholders and the CI workflow was missing from the archive | Confirmed. Five packages ran `echo lint-ok`; the workflow lives at the repository root (GitHub requires it there) and the archive built from `aegis/` omitted it. | typescript-eslint flat config for packages and services, real `lint` scripts, an em dash check, and `scripts/make-archive.sh` that includes the workflow. | `pnpm -r lint` passes with 0 errors (2 pre-existing warnings in console config files); CI runs lint and the style check |

Branding: the product is presented as "AEGIS by Nexus AI Assurance" on the public site, in the console and in page titles (2026-10-12). Nexus AI Assurance is the owner's brand; no claim about Nexus beyond that is made.

Two further defects surfaced during the work and were fixed: the Shield inspector defaulted to a no-op when `installShield()` was not called in a process (now the default lazily loads the real inspector, with a regression test), and new organizations started without data classes, so Shield detected nothing for a fresh tenant (now provisioned at creation).

## What the acceptance criteria say, and where each stands

| Criterion | Status | Evidence |
|---|---|---|
| A new user completes the sample workflow without assistance | Implemented and verified in the console | Getting started checklist with seven data-derived steps; the refund demo runs against the simulated support platform with no credentials; Playwright `onboarding.spec.ts`, `console.spec.ts`, `control.spec.ts` |
| With sandbox credentials: connect an agent | Implemented; verified against a fake Stripe server, not against real Stripe | Agent registration, API keys, tool grants; Stripe integration present in the seed, disabled until a test key is stored |
| Set a policy | Implemented and verified | Guided refund template with thresholds, approver roles, duplicate and reason rules, business hours, denial cap; sample-request tester; JSON editor and four-eyes activation preserved. `policy-templates.test.ts` (12), `policies.spec.ts` (2) |
| Approve a real sandbox refund | Implemented; verified against the fake, not real Stripe | `stripe-connector.test.ts` approval tier executes once and the receipt matches the fake's refund; `scripts/stripe-sandbox-check.mts` is ready for a real test key |
| Prevent duplicate execution | Implemented and verified | Idempotency key replay returns the original; same key with different parameters is 409; a second refund for the same order is denied by policy (`priorRequestsSameReference`); one live grant per request; downstream idempotency key `aegis:<requestId>`; lost responses reconciled from the provider's records |
| Stop outstanding actions | Implemented and verified | Pause voids grants, blocks approvals and grant verification; Playwright and core tests |
| Export evidence of the outcome | Implemented and verified | Evidence Ledger export (JSON Lines, CSV) with chain verification stamp and public key; checklist step detects the export |

## Per area

### Execution safety (packages/core/src/gateway)
- Implemented: three-phase execution (consume grant and mark `executing`; downstream call outside any transaction with the stable idempotency key; receipt and final status), outcome semantics `succeeded`, `failed`, `unknown`, reconciliation by idempotency key through the connector's `reconcile`, worker job `execution.reconcile` plus a sweep for requests stuck in `executing`, `unknown` final state with a security event and monitoring rule RM-012, human settlement with a recorded reason, re-execution of approved requests whose grant was voided, agent-mode outcome reporting.
- Executed and verified: 12 execution-safety tests, 21 gateway tests, 20 Stripe connector tests (lost response, dropped connection, 500, idempotency replay), API smoke test over HTTP (12 checks).
- Simulated: the five in-process systems now honour the idempotency key and expose `reconcile`.
- Remaining: no chaos test that kills the process between phases (the sweep is tested by rewinding `updated_at`, not by a real crash).

### Stripe connector (packages/core/src/gateway/connectors/stripe.ts)
- Implemented: `POST /v1/refunds` with `Idempotency-Key`, pinned API version, metadata for reconciliation, minor-unit conversion including zero and three decimal currencies, `GET /v1/refunds?payment_intent` lookup, same-key replay inside the 24 hour window as the second reconciliation strategy, `GET /v1/balance` connection test that refuses live mode, credential validation at storage and at use (only `sk_test_` or `rk_test_`), console kind badge, Test connection button, plain-language not-connected state, refusal message for live keys. Provider choice justified in `docs/CONNECTORS.md`.
- Executed and verified: 20 tests against `tests/fixtures/fake-stripe.ts`, which implements the documented endpoints and error codes; two Playwright tests on the integration screens; the seed creates the integration disabled with no credential.
- Simulated: the fake Stripe server is a local emulation of Stripe's documented behaviour.
- Remaining and unverified: nothing has run against api.stripe.com, which is unreachable from the build container. The script `scripts/stripe-sandbox-check.mts` performs the whole journey when `STRIPE_TEST_SECRET_KEY` is set and refuses non-test keys; it typechecks and dry-runs but its live path has never executed. Statements about Stripe's idempotency window, error codes and currency rules come from Stripe's published documentation, not from a fetch during this build.

### Console (apps/web)
- Implemented: five primary sections (Overview, Agents, Approvals, Activity, Settings) with the specialist areas under a collapsible More (Control, Assurance, Security, Audit, Organization, Platform Admin) and unchanged permission gating; Overview with needs-attention, agent and integration health, recent actions grouped by outcome, next steps; Getting started checklist (seven steps derived from data, dismissible); business-readable approvals list and detail with technical details collapsed; decision outcome in words including the paused-gateway case; Activity with outcome and agent filters; Settings with pilot setup and the emergency pause; execution controls on the request detail (execute now, reconcile, settle); guided refund policy form, thresholds tab and tester; integration kind badges and connection test.
- Executed and verified: Playwright suites listed in the test record below.
- Remaining: no end-to-end test of the paused-gateway decision message (covered at the core level); the activity live feed is kept but collapsed.

### Policy (packages/core/src/policy)
- Implemented: `templates.ts` (settings schema, document generation, plain-language explanation, settings extraction with divergence detection, sample requests), optional `meta.template` on documents, `priorRequestsSameReference` and `duplicateReferenceKey` in the authorization input, the seeded refund policy generated from the template.
- Executed and verified: 12 template tests, 10 evaluator tests, gateway and Stripe suites, API smoke duplicate check.
- Remaining: none for the pilot scope.

### Deployment (deploy/, docs/DEPLOYMENT.md)
- Implemented: credential boundary, shared storage, startup guard, images with the storage directory, documentation.
- Executed and verified: the Compose and Kubernetes files were edited and reviewed; images were not built in this container (no Docker daemon).
- Remaining: build the images and run the Compose stack once on a host with Docker; choose a ReadWriteMany storage class for the cluster; a WAL point-in-time recovery drill (carried over).

### Continuous governance (packages/core/src/governance, added 2026-10-13)
- Implemented: an optional organization mode, off by default, in which AEGIS runs a chosen containment response when a monitoring rule raises an alert: suspend the agent the alert names, pause the gateway, or disable the integration the alert names. Per-rule configuration in Settings with a shipped starting point, system-actor execution inside the monitoring run, result stored on the alert, evidence event `governance.auto_response`, administrator notifications, skips recorded with a reason, mode changes recorded as `governance.mode_changed`. Alerts show the response on the row and in the detail. Documented in `docs/CONTINUOUS_GOVERNANCE.md`; offered on the pricing page as an option on every tier.
- Executed and verified: 4 core tests (defaults and validation, assisted mode takes no action, suspend once with evidence and notification then a human resumes, pause once and skip when already paused); 2 Playwright tests (switch on, persist, evidence, switch off; viewer cannot change).
- Simulated: nothing; the responses call the same service functions the console buttons call.
- Remaining: request-scoped responses, time-boxed responses and a dry-run mode (listed in the document as planned).

### Public site (apps/web/src/components/marketing, app/(marketing))
- Implemented: home page led by the product promise and the refund workflow, who it is for, how authorization and downstream enforcement work with real console screenshots, what is implemented today, integration status table (sandbox tested, simulated, planned), how to start a pilot, calls to action Explore the demo and Discuss a pilot; Explore the demo page with seven guided steps and persona sign-in shown only in demo mode; Discuss a pilot page with the request form; sitemap updated.
- Executed and verified: 15 Playwright tests including the forbidden-claims sweep over every page.
- Remaining: none; no customers, certifications, audits or performance figures are claimed.

## Test execution record (2026-10-12, development container)

| Suite | Command | Result |
|---|---|---|
| Typecheck | `pnpm -r typecheck` | 6 projects clean |
| Lint | `pnpm -r lint` | 0 errors, 2 pre-existing warnings (console config) |
| Style rule | `./scripts/check-no-em-dash.sh` | clean |
| Tenant isolation | `pnpm --filter @aegis/db test` | 11 passed |
| Core | `pnpm --filter @aegis/core test` | 166 passed (16 files): gateway 21, execution safety 12, Stripe connector 20, policy templates 12, policy evaluator 10, Shield 24 plus eval and default 2, Audit 28, monitoring 7, jobs 5, SSO 3, foundation 6, crypto 10, incidents and others |
| API | `pnpm --filter @aegis/api test` | 6 passed |
| Refund journey over HTTP | `npx tsx scripts/smoke-refund-journey.mts` | 12 of 12 checks passed |
| Seed | `pnpm db:seed` | 461 historical requests, 75 approvals, 18 denied; Stripe integration disabled with no credential; chain valid |
| Console and site | `cd apps/web && npx playwright test` | see the line below, recorded from the full run |
| Layout scan (2026-10-13) | `node tests/overlap-scan.mjs` | 0 findings over 30 pages at 390, 768, 1024, 1280 and 1440 px after the fixes in commit d9df1e6 |
| Continuous governance (2026-10-13) | `npx vitest run tests/continuous-governance.test.ts`, `npx playwright test tests/e2e/governance.spec.ts` | 4 passed, 2 passed; full core suite 170 passed |

Playwright, full run against the dev server on 2026-10-12: 63 tests, 61 passed in one 14.5 minute run; the two that failed asserted the old Activity heading and the old first policy tab, were updated for the redesign, and passed on re-run. By suite: console 11, control 11, onboarding 5, policies 2, integrations 2, assurance 5, shield 5, audit 7, marketing 15.

CI (`.github/workflows/aegis-ci.yml`) runs typecheck, lint, the style rule, isolation, core, API, the seed and the Playwright suite.

## Known gaps carried forward
1. Real Stripe test mode has not been exercised (network). The command and expected outcome are in `docs/CONNECTORS.md`.
2. Keys live in environment variables, not a KMS; no SAML; prompt-injection detection is heuristic; no independent penetration test.
3. Docker images and Kubernetes manifests were not built or applied in this container.
4. Approvals are decided in the console and over the API; Slack or Teams delivery is planned, not built.
5. The hosted demo environment itself is not deployed; the site's demo page shows persona credentials only when a deployment runs in demo mode.
6. Docker Compose: the owner reports running the stack locally on 2026-10-13 and reaching the console; that run was not observed from the build environment, so it is recorded as reported, not verified here.
