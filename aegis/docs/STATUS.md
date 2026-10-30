# AEGIS status

## Current status (2026-10-30)
Sections below are a dated log; figures in older sections are as of their date. Today: core 534 tests, API 61, tenant isolation 22, SDK 19, MCP gateway 8, browser 139 in 36 spec files. The October 2026 audit's 7 P1 findings and 13 of 16 P2 findings are fixed with regression tests (docs/DEFECT_REGISTER.md); phase-by-phase status is in docs/AEGIS_IMPLEMENTATION_MATRIX.md.

Updated at the end of each phase. `docs/IMPLEMENTATION_REPORT.md` has the current per-area breakdown (implemented, executed and verified, simulated, remaining).

## Sellable-product hardening (2026-10-16): complete in code, waiting on the owner
- Done:
  - console CSP;
  - SAML replay refused across replicas;
  - KMS and Key Vault seam with rotation tooling;
  - generic HTTPS connector (execution protocol v1);
  - email copies of notifications through Resend;
  - blocking dependency, secret and image scans in CI;
  - live-URL browser test workflow;
  - Fly demo kit;
  - Resend and Slack validators;
  - pentest RFQ.
- See docs/AEGIS_BUILD_PROGRESS.md, "Sellable-product hardening R1 to R5".
- Waiting on the owner:
  - approval and a Fly account to publish the demo (docs/DEPLOY_FLY_DEMO.md);
  - test credentials set in their own shell for Resend, Slack, Stripe test mode and an Entra test tenant (docs/INTEGRATION_VALIDATION.md);
  - a budget and a choice of firm for the penetration test (docs/PENTEST_RFQ.md).

## Phase 10: DNRS follow-ups (2026-10-13): in progress
- Done: score-band policy template (core 7 tests, browser 2 tests, seeded example); replay calibration (core 4 tests, browser 1 test); autonomy posture per agent and the boundary sentence on approvals (core 6 tests, browser 2 tests); AEGIS Trading (trading mandate template, simulated brokerage, Alpaca paper connector refusing live keys, demo scenario; core 13 tests, browser 4 tests; the paper-account run still needs an Alpaca paper key); ten further framework catalogs, the free public checker and the Proof page (core 3 tests, browser 2 tests). CI runs the browser suite against a production build; two production-only defects fixed (platform admin owner credential, report period navigation).
- Next: autonomy posture and boundary sentence, AEGIS Trading (needs an Alpaca paper key), framework catalogs, free checker, Proof page.

## Phase 9: layout clean-up and continuous governance (2026-10-13): complete
- Layout scan tool and fixes for every text collision and sideways-scrolling page found at five widths (commit d9df1e6).
- Continuous governance mode: per-rule automatic responses (suspend agent, pause gateway, disable integration) with evidence, notifications and reversal by a person. Core 4 tests, Playwright 2 tests. See docs/CONTINUOUS_GOVERNANCE.md.
- DNRS.ai public pages and demo sites read and compared: docs/COMPARISON_DNRS.md (ideas to take on our own terms, what not to take, suggested order).
- Open: AEGIS Trading paper-account run (needs an Alpaca paper key), plain-language copy pass for non-technical users, a plain-language copy pass.

## Phase 8: pilot-ready refund workflow (2026-10-11 to 2026-10-12): complete
- Execution safety: one live grant per request (partial unique index), `executing` and `unknown` request states, three-phase execution with the downstream idempotency key `aegis:<requestId>`, reconciliation job and sweep, human settlement, monitoring rule RM-012. Pause voids grants and blocks approvals; suspension voids grants. 12 regression tests.
- Deployment: owner credentials only in the migrate job (Compose overrides, split Kubernetes secrets, startup guard), shared uploads storage, real typescript-eslint lint, em dash check, archive script that includes the CI workflow.
- Stripe test-mode refund connector with a fake Stripe server (20 tests), credential validation that refuses live keys, connection test, `scripts/stripe-sandbox-check.mts` for the real test-mode run (not yet executed: no network from the build container).
- Console: Overview, Agents, Approvals, Activity, Settings as primary sections, specialist areas under More; Getting started checklist; business-readable approvals; execution controls; Stripe integration screens.
- Guided refund policy template (thresholds, approver roles, duplicate and reason rules, business hours, denial cap) with live explanation and a request tester; the seeded refund policy is generated from it.
- Public site refocused on the refund workflow with real console screenshots, the integration status table, Explore the demo and Discuss a pilot pages.
- Shield default inspector now fails safe (lazy load) and every new organization gets the built-in data classes.

## Phase 0: complete
Research, ADRs 0001 to 0005, architecture, database design, threat model, design system, plan.

## Phase 1: complete (core), console in progress
- Monorepo (pnpm): packages/db, packages/core, packages/sdk, apps/api, apps/web, apps/worker.
- PostgreSQL schema (60 tables), RLS on every tenant table, append-only triggers, SECURITY DEFINER lookups. Isolation suite: 11 tests.
- Identity: argon2id passwords, server-side sessions, TOTP MFA, API keys (hashed), lockout. Organizations with 8 system roles and 22 permissions, teams, invitations.
- Agent registry with lifecycle transitions, versions, tools, resource permissions; revocation kills keys, grants and pending approvals.
- Evidence ledger: per-org hash chain, Ed25519 checkpoints, verification.
- Demo tenant Meridian Gulf Bank (synthetic): 7 users, 8 agents, 8 tools, 6 resources, 5 simulated integrations.

## Phase 2: complete (core and API), console in progress
- Policy language v1 (docs/POLICY_LANGUAGE.md), deterministic evaluator with full traces, embedded policy tests, versions with four-eyes activation, rollback by copy, assignments to org, team or agent.
- Action gateway: idempotency, structural checks, Shield hook, policy evaluation, decisions, grants bound to the parameter hash, execution receipts, fail-closed on any error.
- Approval center service: eligibility (permission, role, separation of duties), approve, reject, request info, escalate, reassign, expiry (job plus sweep), hash binding.
- Emergency controls: suspend and revoke agent, revoke tool, disable integration, revoke credential, gateway pause.
- Simulated downstream systems verify the execution grant before acting.
- API: gateway, approvals, policies, webhooks (HMAC with replay window). Worker with PostgreSQL job queue. SDK.
- Demo scenarios (banking, refunds, sensitive data) run through the real gateway; seeded 75 days of synthetic history.
- Tests: 47 core tests (10 crypto, 10 evaluator, 6 foundation, 21 gateway and approvals) plus 11 isolation tests. HTTP smoke test of the banking approval flow passed.

## Phase 3: complete (core and API), console pending
- Monitoring: 12 deterministic built-in rules (repeated denials, permission escalation, unusual tool usage, transaction volume, integration failures, policy evaluation failures, missing evidence or receipts, abnormal activity, approvals about to expire, chain integrity, credential rotation due, unresolved execution outcomes) with configurable thresholds, deduplicated alerts, acknowledge and resolve with evidence, worker job every minute.
- Governance dashboard queries from real records: agents, decisions, approvals, violations, high-risk events, failed integrations, evidence status, service health; day series; approval turnaround percentiles.
- Evidence service: filtered listing, per-event verification, verify-and-record, JSON Lines and CSV export with chain verification stamp and checkpoint public key, governance report JSON.
- Compliance: observed technical controls with measurements and framework references; per-framework mapping summary fed by the Audit module.
- Tests: 7 monitoring and assurance tests (total core 54, isolation 11).

## Phase 4: complete (core and API), console in progress
- Detector registry (email, phone, IBAN with mod-97, card numbers with Luhn, Emirates ID with check digit, API keys and high-entropy tokens, JWT, private keys, password assignments, IP, URL, safe custom regex) with per-class actions allow, mask, redact, block, require approval; addressing fields are classified but never rewritten (destination allowlists govern them).
- Shield inspector wired into the gateway before policy evaluation; fails closed on internal error. Data classes per organization with 11 system defaults and custom classes.
- Prompt-injection signals (instruction override, role hijack, exfiltration, tool coercion, hidden text, encoded payloads, urgency) labelled heuristic; enforcement never depends on them.
- Tool security report reusing the gateway's structural checks; security events with triage and automatic incident escalation; incident management with timeline, assignment, status workflow and notifications.
- Security evaluation corpus: 38 cases; on the corpus, injection recall 18/18, benign false blocks 0/10, PII 10/10; enforcement proven through the gateway (ungranted tool denied regardless of injected text; card data blocked before execution).
- Execution grants now bind to the parameters that execute after masking.
- Tests: 29 (shield 18, eval 7, incidents 4).

## Phase 5: complete (core and API), console in progress
- Document ingestion for PDF, DOCX, TXT and Markdown with size and type limits, chunking, retention; files stored under the configured directory with opaque names; no content ever leaves the deployment.
- Frameworks: 20 shared catalogs, 472 controls (seven of them JSON drop-ins under packages/core/src/seed/frameworks/catalogs, see docs/FRAMEWORKS.md): ISO/IEC 42001 (65), ISO/IEC 27001:2022 (93), NIST AI RMF 1.0 (72), EU AI Act (28), GDPR (25), UAE PDPL (17, by principle), Dubai DESC ISR v3 (15, by domain under AEGIS identifiers), ISO/IEC 23894 (14), 27701 (15), 27017 (10), 27018 (11), 42005 (10), 38507 (8), OWASP LLM Top 10 (10), NIST CSF 2.0 (22), DIFC DPL 2020 (15), Singapore Model AI Governance Framework (10), SDAIA AI Ethics Principles (7), SOC 2 criteria (13), PCI DSS v4 (12); custom frameworks with CSV import. Every entry references identifiers with original one-sentence summaries only. A free public checker (/site/checker) and a Proof page (/site/proof) are on the website; the Proof page is edited through apps/web/src/content/proof.ts and its figures are checked against the repository in CI.
- Assessment engine: BM25 lexical retrieval plus deterministic checks and 10 automated evidence types drawn from AEGIS records; findings covered, partial, ambiguous or missing with confidence, rationale, cited excerpts and recommendations; every conclusion labelled automated or human validated; control mappings refreshed per run for Assurance.
- Remediation tasks with owner, due date, evidence attachments, review workflow and history. Reports in JSON and PDF (executive summary, detailed, evidence inventory, gap report, remediation plan) with disclaimers on every page.
- Tests: 28 (retrieval 16, audit 12).

## Phase 6: complete
- OIDC SSO with PKCE and JIT provisioning, TOTP MFA, rate limiting, security headers, OpenTelemetry bootstrap, Dockerfile and Compose, Kubernetes manifests with network policy, CI workflow (green on the final head), backup and restore drill, deployment, security and third-party docs, per-organization transaction serialization with deadlock retry, float-safe canonical hashing, pool-safe tenant transactions, gateway load test (docs/PERFORMANCE.md).
- Remaining for production: WAL-based recovery drill, KMS-backed keys, penetration test, multi-replica run.

## Phase 7: complete
- Console: every navigation item released. Control (policies with editor, canvas and simulator, gateway with decision traces, approval center, integrations, live activity, alerts, demo runner), Assurance (evidence ledger with verification and exports, monitoring rules, governance reports, policy history), Shield (security events, data protection with sample testing, tool security, incidents), Audit (documents, standards, assessments with validation, remediation, reports with download).
- Public website: home, products, interactive tour, architecture, security, open source, pricing inquiry, contact and demo forms, legal drafts; no unsupported claims.
- Implementation report: docs/IMPLEMENTATION_REPORT.md.

## Final test totals (2026-10-11)
Core 120, isolation 11, API 6, console and website Playwright 49 (console 10, control 9, assurance 5, shield 5, audit 7, marketing 13). All passing locally in one run; CI (test and e2e jobs) green on head 20c39c8.
