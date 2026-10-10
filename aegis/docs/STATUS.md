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
