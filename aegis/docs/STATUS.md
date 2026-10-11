# AEGIS status

Updated at the end of each phase. See the implementation report at the bottom for the per-module breakdown.

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
- Monitoring: 11 deterministic built-in rules (repeated denials, permission escalation, unusual tool usage, transaction volume, integration failures, policy evaluation failures, missing evidence or receipts, abnormal activity, approvals about to expire, chain integrity, credential rotation due) with configurable thresholds, deduplicated alerts, acknowledge and resolve with evidence, worker job every minute.
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
- Frameworks: ISO/IEC 42001 (65 controls), ISO/IEC 27001:2022 (93 Annex A controls), NIST AI RMF 1.0 (72 subcategories), custom frameworks with CSV import. ISO entries reference identifiers with original one-sentence summaries only.
- Assessment engine: BM25 lexical retrieval plus deterministic checks and 10 automated evidence types drawn from AEGIS records; findings covered, partial, ambiguous or missing with confidence, rationale, cited excerpts and recommendations; every conclusion labelled automated or human validated; control mappings refreshed per run for Assurance.
- Remediation tasks with owner, due date, evidence attachments, review workflow and history. Reports in JSON and PDF (executive summary, detailed, evidence inventory, gap report, remediation plan) with disclaimers on every page.
- Tests: 28 (retrieval 16, audit 12).

## Phase 6: in progress
- Done: OIDC SSO with PKCE and JIT provisioning, TOTP MFA, rate limiting, security headers, OpenTelemetry bootstrap, Dockerfile and Compose, Kubernetes manifests with network policy, CI workflow, backup and restore drill, deployment, security and third-party docs, per-organization transaction serialization with deadlock retry, float-safe canonical hashing.
- Remaining: performance test run, final security review pass, implementation report.

## Test totals at this point
Core 119, isolation 11, API 6, console Playwright 10. All passing on 2026-10-11.
