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
