# Real-world validation: deliverables (14 October 2026)

This report answers the validation directive. Each item says whether it is **implemented**, **tested** (with AEGIS's own automated tests), **simulated** (a local stand-in or test double), or **externally verified** (run against the real provider). Nothing here is a certification or an independent validation.

## 1. Staging deployment plan

`docs/STAGING_DEPLOYMENT_PLAN.md` covers:
- hosting options with sourced prices;
- the recommendation;
- sizing;
- database roles and backups;
- domain and HTTPS;
- every environment variable;
- secret handling;
- monitoring;
- the deployment process.

**Status: plan only, waiting for your approval.** Nothing is deployed publicly.

The packaged images were verified locally in production mode:
- the smoke test passed 12 of 12;
- recorded in `docs/DEPLOY_STEP_BY_STEP.md`.

## 2. Credential and setup instructions

`docs/INTEGRATION_VALIDATION.md` explains how to create test-only credentials for:
- Stripe test mode;
- Alpaca paper;
- an AI provider (with a budget cap);
- Microsoft Entra ID (a test tenant).

It also explains how to run each check on your own machine with `read -rs`, so keys never enter a chat, a file or shell history.

## 3. Integration validation matrix

| Integration | Externally verified | Simulated (local stand-in) | Blocked by |
|---|---|---|---|
| OSV.dev | **Yes**, 5 of 5 (`docs/validation/results/osv-2026-10-14-12-03-27.json`) | Yes | Nothing |
| Stripe test mode | Not run | Yes, fake Stripe server | Your test key |
| Alpaca paper | Not run | Yes, fake Alpaca server | Your paper key pair |
| AI provider | Not run | Yes, recording stand-in | Your provider key |
| Microsoft Entra ID | Not run | Yes, stand-in identity platform and Graph (8 tests) | A test tenant app registration with admin consent |

All provider hosts were reachable from the build environment. Stripe, Alpaca and OpenAI answered 401 without keys, so only credentials are missing.

## 4. Performance results

Full method and raw records: `docs/PERFORMANCE.md` and `docs/validation/performance/`. Reproduce with `pnpm bench:gateway:setup` and `pnpm bench:gateway`.

| Run | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| Before, 1 organization, concurrency 20 | 7.0/s | 2,118 ms | 5,812 ms | 6,481 ms | 0 |
| After, 1 organization, concurrency 10 | 19.5/s | 473 ms | 829 ms | 1,052 ms | 0 |
| After, 1 organization, concurrency 20 | **20.7 to 21.1/s** | 960 to 981 ms | 1,452 to 1,522 ms | 1,626 to 1,655 ms | 0 |
| After, 1 organization, concurrency 40 | 19.8/s | 1,914 ms | 3,245 ms | 3,456 ms | 0 |
| After, 2 organizations, concurrency 40 | 22.6/s total | 1,605 ms | 3,235 ms | 3,465 ms | 0 |

**Test conditions:**
- one 4-vCPU shared test machine;
- local PostgreSQL and Redis;
- a realistic mix of allowed, held and denied refunds.

**What did not change:**
- Authorization checks, evidence and tenant isolation are unchanged. Evidence is still written in the same transaction as the decision.
- Duplicate and velocity rules are protected by narrow advisory locks.
- A race test proves no duplicate refunds under concurrency.

**Limits:**
- The next bottleneck is Prisma engine CPU.
- Throughput on production hardware has not been measured.

## 5. Microsoft Entra ID connector

**Implemented and tested against a local stand-in** that follows Microsoft's documented API (`docs/ENTRA_CONNECTOR.md`, 8 tests):
- least-privilege application permissions (AuditLog.Read.All, Directory.Read.All);
- client credentials with token refresh;
- incremental sync with cursors and a 15-minute lag;
- paging restricted to the same origin;
- retries that honour Retry-After;
- plain explanations for licence and permission errors;
- metrics;
- a 15-minute worker job;
- a console panel.

**Not externally verified.** That needs a test tenant you control.

The CI browser test for the panel failed on a locator that matched three buttons. The test was fixed and passes locally, 3 of 3.

**Okta:** specification only (`docs/OKTA_CONNECTOR_SPEC.md`). It will be built when a pilot needs it.

## 6. Security readiness

`docs/PENTEST_READINESS.md` covers:
- scope;
- architecture;
- eight trust boundaries;
- authentication and authorization;
- tenant isolation;
- audit integrity;
- ten known risks;
- a ten-area test plan;
- a before-and-after remediation checklist.

Checked on the local database: row-level security is on every public table except `_prisma_migrations`, and the application role has neither superuser nor BYPASSRLS.

Fixed while preparing the pack: the console now sends HSTS. Still open:
- **K10:** no Content-Security-Policy on the console.

**No independent penetration test has been performed.**

## 7. Pilot demo

`scripts/pilot-demo.mts`, documented in `docs/PILOT_DEMO.md`. An agent attempts refunds and AEGIS:
- allows a small one;
- holds a larger one for a person (a viewer is refused, the approver approves the exact parameters, it executes once);
- refuses changed parameters;
- denies one above the limit, with proof that nothing reached the refund system;
- lets the auditor verify the evidence ledger.

**Recorded run:** all checks passed (`docs/validation/pilot/pilot-demo-2026-10-14.txt`).

Each step is labelled real or simulated:
- **Simulated:** the agent is a script, not a language model, and the refund system is a simulator.
- **Real:** AEGIS itself.

## 8. Remaining production blockers

1. **Your approval** of the staging plan and its spend, then the staging deployment itself.
2. **Test credentials** for Stripe, Alpaca, an AI provider and an Entra test tenant, so the four external checks can be run and recorded.
3. **An independent penetration test** against staging, and the fixes for its findings.
4. **A Content-Security-Policy** for the console (K10).
5. **Keys in a KMS or HSM** instead of environment variables (K1), and documented key rotation (K2).
6. **A shared SAML replay cache** before running more than one web instance (K3).
7. **Performance measured on the staging hardware**, plus a multi-instance test.
8. **For UAE pilots:** a UAE-region deployment and confirmation of every subprocessor before any residency statement.
9. **Product scope not yet built:**
   - secure execution workspaces;
   - investigations;
   - data lineage;
   - the Okta connector.
