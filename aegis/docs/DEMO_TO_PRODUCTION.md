# From demo to a working product

This is the operating plan for taking AEGIS from the verified demo build to a product a customer runs on real agents and real systems. Each stage names the environment, what runs there, what is tested, and the exit criteria. Nothing is marked done here; the state of each item is tracked in STATUS.md and IMPLEMENTATION_REPORT.md.

## Environments

| Environment | Purpose | Data | Who uses it | Where |
|---|---|---|---|---|
| Local | Development and the scripted demo | Synthetic Meridian tenant | Engineers, sales demos on a laptop | Docker Compose or `pnpm dev` |
| CI | Every push: typecheck, lint, isolation, core, API, seed, Playwright | Fresh synthetic tenant per run | Automated | GitHub Actions (`.github/workflows/aegis-ci.yml`) |
| Hosted demo | Stable URL for prospects and the website's demo requests | Synthetic, reset nightly | Sales, prospects | Railway, Render or a small VM with Compose |
| Staging | Release candidate, production configuration, real integrations in test mode | Synthetic plus partner test data | Engineering, design partner | Kubernetes (deploy/k8s) or the customer's staging |
| Pilot (customer staging) | One real agent, one real downstream system, the customer's identity provider | Customer test data only | Design partner | Customer's private deployment |
| Production | Governed real agents | Customer data | Customer | Customer's private deployment or a dedicated tenant |

Promotion is always the same image set (api, web, worker, migrate) built from one commit, with configuration from the environment only.

## Stage 1: hosted demo (one to two days)

Build
- Build the four images: `docker build -f deploy/Dockerfile --target api|web|worker|migrate`.
- Provision managed PostgreSQL 16 and Redis. Create the owner and app roles (`deploy/postgres-init.sql` shows the app role; the owner is the provisioned admin user).
- Set every variable in `.env.example`; generate the three secrets with `pnpm --filter @aegis/core keygen`; set `AEGIS_DEMO_MODE=true`, `NODE_ENV=production`, the public URLs and the CORS origin.
- Run the migrate image once, then `pnpm --filter @aegis/core seed` once (from a one-off job or a local machine pointed at the database).
- Schedule a nightly reset: run the seed again (it is idempotent and rebuilds the tenant) so prospects always see a clean history.

Test
- Smoke: `GET /health`, `GET /ready`, sign in, run all three demo scenarios from Action Gateway > Demos, approve the transfer as Lina Mansour, verify the chain on Evidence Ledger.
- Run the Playwright suite against the hosted URL: `E2E_BASE_URL=https://demo.example npx playwright test` after pointing `playwright.config.ts` at the URL (the config reads `E2E_BASE_URL` once that line is added; see the CI job for the pattern).
- Load: `AEGIS_URL=https://api.demo.example PERF_SCENARIO=transfers npx tsx scripts/perf-gateway.mts 300 10` and compare with docs/PERFORMANCE.md.

Exit criteria
- Three scenarios pass by hand and by Playwright on the hosted URL; nightly reset has run twice; error budget: zero 5xx in the API log over a day of demo traffic.

## Stage 2: staging with production configuration (one week)

Build
- Kubernetes manifests from `deploy/k8s`; two API replicas, one worker, two web replicas; PgBouncer in front of PostgreSQL; `AEGIS_DEMO_MODE=false`.
- Secrets from the platform's secret manager, not from files. Start the KMS work here: keep `AEGIS_MASTER_KEY` and `EVIDENCE_SIGNING_KEY` in the secret manager, and plan the envelope-encryption change so the master key is held by the KMS (code seam: `packages/core/src/lib/crypto.ts`, `packages/core/src/evidence/ledger.ts`).
- OpenTelemetry to a collector (`deploy/docker-compose.observability.yml` shows the collector config); dashboards for decision latency (`aegis.gateway.decision_latency_ms`), decisions by result, job queue depth, chain verification results.
- Backups: daily base backup plus WAL archiving; alert if the last successful backup is older than a day.

Test
- Restore drill from a real backup into a fresh database, then migrate, then `POST /v1/assurance/evidence/verify` for every tenant (docs/BACKUP_RECOVERY.md). Record the RTO achieved.
- Failure tests from docs/ARCHITECTURE.md: stop PostgreSQL and confirm the gateway returns 503 and the SDK reports deny; kill the worker mid-run and confirm `recoverStaleJobs` resumes; expire an approval and confirm the late approval is refused; revoke an agent and confirm its key stops working within one request.
- Multi-replica: run the load script against the load balancer; confirm idempotency holds across replicas (same key, two replicas, one execution).
- Security: dependency scan (`pnpm audit`), container image scan, and the first external penetration test scoped to the API and console.

Exit criteria
- Restore drill documented with times; failure tests green; penetration test findings triaged with high and critical fixed; a week of synthetic traffic without unexplained 5xx.

## Stage 3: pilot with a design partner (two to four weeks)

Integration work with the partner
1. Register their agent and issue an API key. Decide the execution mode: gateway mode (AEGIS calls the downstream system through an integration you write) or agent mode (the agent executes and the downstream system verifies the grant).
2. Write their first policies in the console from the templates; put the embedded tests in the policy so review is objective.
3. Add the authorize call to their agent with the SDK (`packages/sdk`). The agent must treat any non-2xx as deny; the SDK already does.
4. Downstream verification. This is the step that makes AEGIS enforcement rather than advice: the receiving service calls `POST /v1/gateway/grants/verify` with the exact parameters it received, using an integration API key, and refuses to act on failure. For gateway mode, implement a `DownstreamSystem` for their API (see `packages/core/src/gateway/simulators.ts` for the contract) and register it in the worker and API processes.
5. Connect their identity provider through OpenID Connect (Settings > SSO) and map approvers to the Approver role.
6. Turn on the monitoring rules they care about and route high alerts to their on-call (webhook or email provider to be wired; the notification table and jobs exist).

Test
- Shadow mode first: the agent calls authorize but the downstream system does not yet verify grants, so denials are visible without blocking the partner. Review the Action Gateway daily with them.
- Then enforce: enable grant verification downstream. Re-run their scripted scenarios: allowed, approval, denied, duplicate, expired, modified parameters.
- Audit: upload their real governance documents in their environment (never in yours) and run an ISO 42001 assessment; have their compliance lead validate ten findings so the human-validated path is exercised.

Exit criteria
- Two weeks of enforced operation on at least one real tool; every elevated action approved by a named person; evidence export verified by their audit team; a written list of changes they need before production.

## Stage 4: production readiness (gates, not tasks)

- Keys in KMS or HSM; master key rotation procedure tested.
- SAML if the customer requires it (not built; OIDC is).
- Penetration test findings closed; dependency and image scans in CI as blocking steps.
- Runbooks: on-call, incident response for AEGIS itself, upgrade and rollback (migrations are forward-only; test rollback by restoring the pre-upgrade backup).
- Support: SLA you can actually meet, status page, release notes.
- Legal: license review of the two flagged packages (docs/THIRD_PARTY.md), the ISO control summaries, and the standards references on the website.
- Commercial: pricing, contract, data processing terms, and a security questionnaire answer pack built from docs/SECURITY.md and docs/THREAT_MODEL.md.

## Testing matrix by environment

| Test | Local | CI | Hosted demo | Staging | Pilot | Production |
|---|---|---|---|---|---|---|
| Typecheck, lint | yes | yes | | | | |
| Isolation (RLS) | yes | yes | | on migrate | on migrate | on migrate |
| Core and API suites | yes | yes | | | | |
| Playwright console and site | yes | yes | nightly | release | | |
| Scripted demo scenarios | yes | seed | daily | release | partner scenarios | |
| Load (`scripts/perf-gateway.mts`) | ad hoc | | weekly | release | partner volume | |
| Failure injection (db down, worker killed, expiry, revocation) | | | | release | once | drill quarterly |
| Restore drill | once (done) | | | monthly | once | quarterly |
| Chain verification | tests | tests | nightly | nightly | nightly | continuous (RM-010) |
| Penetration test | | | | before pilot | | annually |

## What to say to a buyer about the current state
Feature-complete software with real runtime enforcement, verified by automated tests and a load test, before its first pilot. No customers, certifications, audits or partnerships are claimed. The route to production is the four stages above, and the first pilot is where the remaining risk is retired.
