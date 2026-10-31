# Staging deployment plan

Status: **plan for approval. Nothing has been deployed.** Staging uses synthetic data only. No public deployment happens until the owner approves this plan in writing.

**Update 2026-10-31:** the owner chose Fly.io for staging. The configuration is `deploy/fly/staging/fly.toml` and the runbook is `docs/STAGING_FLY.md`. Before the first deploy, the owner reviews `docs/STAGING_CONFIG_REVIEW.md`. This plan remains as the record of the options considered.

The step-by-step commands are in `docs/DEPLOY_STEP_BY_STEP.md`. This document decides where staging runs, what it costs, how it is configured and how it is watched.

## 1. What staging is for

- Show AEGIS to prospects and pilot sponsors on a stable URL.
- Run the live provider checks from a normal server: Stripe test mode, Alpaca paper, an AI provider, Entra ID and OSV.dev direct (`docs/INTEGRATION_VALIDATION.md`).
- Give an independent penetration tester a target (`docs/PENTEST_READINESS.md`).

Staging is **not** for:
- customer data;
- live payments or live trading (AEGIS refuses live Stripe and non-paper Alpaca keys);
- residency claims.

## 2. Hosting options

Prices are list prices found on 14 October 2026 from the sources below. Several providers changed prices in 2026. Confirm on the provider's own pricing page before buying.

| Option | What you get | Approximate monthly cost | Fit |
|---|---|---|---|
| **A. Free preview** | Oracle Cloud Always Free Arm VM, Docker Compose, Cloudflare Tunnel for HTTPS | USD 0 (a domain is about USD 10 to 15 a year, optional) | Short demos. The free allowance was reported cut in 2026, and idle free VMs can be reclaimed. Not for the pentest. |
| **B. One VM (recommended for staging)** | One 4 vCPU / 8 GB Linux VM running Route A or B of the step-by-step guide, Caddy for HTTPS, nightly `pg_dump` to object storage | About EUR 9 to 36 (Hetzner, depending on line and availability) or similar at DigitalOcean or Vultr, plus backups | Cheapest real staging. One machine to patch. |
| **C. Railway** | Four services (web, api, worker, migrate as a job) plus Railway Postgres and Redis | Pro is USD 20 a seat with USD 20 of usage included. Usage is USD 20 per vCPU-month and USD 10 per GB-month of RAM, billed per second. Estimate for a mostly idle staging: about USD 30 to 60. At full load on 3.75 vCPU and 3.75 GB: about USD 110. | Least operations work. US or EU regions only. |
| **D. UAE region** | AWS me-central-1 (or Azure UAE North): EC2 plus RDS PostgreSQL plus ElastiCache | Price per region must be taken from the AWS calculator. Third-party listings did not show me-central-1 on-demand prices for small instances. Expect several times option B. | Only when a pilot needs data held in the UAE. Residency is claimed only after the deployment and every subprocessor are confirmed (`docs/DEPLOYMENT_OPTIONS.md`). |

**Recommendation:**
1. **Option B for staging now.** It matches the path verified in the step-by-step guide: the four images built, the containers ran, and the smoke test passed 12 of 12.
2. **Option D only when a UAE pilot requires it.**
3. **Option A only for quick free previews before you approve spending.**

### Sizing

`docs/PERFORMANCE.md` measured about 20 governed decisions per second for one organization on 4 shared vCPUs, with the API's pool at 25 connections. A staging VM with 4 vCPU and 8 GB covers:
- web, API, worker, PostgreSQL 16 and Redis 7 together;
- demo traffic with a wide margin.

## 3. Database

- PostgreSQL 16 on the VM for options A and B. Railway Postgres for C. RDS for D.
- **Two roles, created as in the step-by-step guide:**
  - `aegis_owner` runs migrations only;
  - `aegis_app` is used by the running services. It is not the owner and not a superuser, so row-level security applies to it.
- `pnpm migrate` applies the migrations and `packages/db/prisma/rls.sql`. Run the tenant isolation tests against staging once before the first demo.
- **Backups:** nightly `pg_dump`, encrypted, to object storage outside the VM, kept for 14 days. Test one restore before the pentest (`docs/BACKUP_RECOVERY.md`).
- **Connections:** `DATABASE_URL` has `?connection_limit=25` for the API, with a lower value for web and worker. The total must stay under `max_connections`.

## 4. Domain and HTTPS

- Use a subdomain you control, for example `staging.<your-domain>` for the console and `api.staging.<your-domain>` for the API.
- **Options A and B:** Caddy (`deploy/Caddyfile`) gets and renews certificates automatically, or a Cloudflare Tunnel handles HTTPS without opening ports.
- **Option C:** Railway's custom domains. **Option D:** an ALB with an ACM certificate.
- Add `X-Robots-Tag: noindex` and a staging banner (`AEGIS_DEMO_MODE=true` labels demo data in the UI). That way staging is not indexed and is never mistaken for production.

## 5. Configuration

Every variable is listed in `.env.example`. These are the staging values:

| Variable | Staging value | Secret |
|---|---|---|
| `DATABASE_URL` | `postgresql://aegis_app:...@db:5432/aegis?connection_limit=25` | Yes |
| `MIGRATION_DATABASE_URL` | Owner URL, **only** in the migrate job. The api, web and worker refuse to start in production if it is set. | Yes |
| `REDIS_URL` | `redis://redis:6379` on a private network, or with a password | If it has a password |
| `AEGIS_MASTER_KEY` | 32 random bytes, base64 | Yes |
| `AEGIS_SESSION_SECRET` | 32 random bytes, base64 | Yes |
| `EVIDENCE_SIGNING_KEY` | Ed25519 key from `pnpm --filter @aegis/core keygen` | Yes |
| `EVIDENCE_VERIFY_KEYS` | Empty until the first rotation | No |
| `AEGIS_PLATFORM_ADMIN_PASSWORD` | 16 or more random characters, or unset so the seed writes one to the keys file | Yes |
| `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `API_CORS_ORIGINS` | The staging HTTPS URLs | No |
| `AEGIS_STORAGE_DIR` | One volume shared by api, web and worker | No |
| `AEGIS_DEMO_MODE` | `true` (synthetic demo tenant) | No |
| `AEGIS_ALLOW_PRIVATE_DESTINATIONS` | `false` | No |
| `NODE_ENV` | `production` | No |
| `LOG_LEVEL` | `info` | No |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional, see monitoring | No |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional; email goes to the console log without them | Yes |

## 6. Secrets

- **Never in git, never in a chat, never in a ticket.** `.dockerignore` and `.gitignore` already exclude `.env`, `.demo-keys.json` and `deploy/seed-output/`.
- **Generate each secret on the server** (`openssl rand -base64 32`, and `keygen` for the evidence key). Store them:
  - Options A and B: in a root-only `.env` file (`chmod 600`), with an offline copy in a password manager.
  - Option C: in Railway's variables. Option D: in AWS Secrets Manager.
- Provider test keys (Stripe test, Alpaca paper, AI provider) are entered **in the AEGIS console** under Integrations. They are stored encrypted with `AEGIS_MASTER_KEY`, not as environment variables.
- **Rotation:**
  - Losing `AEGIS_MASTER_KEY` makes stored credentials unreadable, so back it up offline.
  - Rotating the evidence key means moving the old public key to `EVIDENCE_VERIFY_KEYS`.

## 7. Monitoring

| What | How | Alert when |
|---|---|---|
| Up or down | An external uptime check (for example a free UptimeRobot or Better Stack plan) on `GET /health` and on the console `/login` | Two failed checks in a row |
| Ready | `GET /ready` checks the database and Redis | Not ready for 2 minutes |
| Metrics | `GET /metrics` (Prometheus format: requests by route group, decisions, connector syncs and retries). Keep it off the public internet; scrape it over the private network. | Error rate above 5% for 10 minutes |
| Traces | Optional OpenTelemetry collector (`deploy/docker-compose.observability.yml`) | None at staging |
| Evidence | System Health in the console (`/org/health`): evidence not yet covered by a signed checkpoint, jobs, integrations | Checkpoint older than 1 hour |
| Logs | Structured JSON on stdout; `journalctl` or `docker logs`. Logs carry no prompt text and no personal data. | Any `fatal` |
| Backups | The backup job reports success to the uptime check's heartbeat URL | Heartbeat missed |

## 8. Deployment process

1. **Approval.** The owner approves this plan, the hosting option and the monthly spend.
2. **Provision.** Create the VM (or Railway project), DNS records and firewall: only 80 and 443 open, plus SSH from your IP or no SSH with a tunnel.
3. **Install** following `docs/DEPLOY_STEP_BY_STEP.md` Route A or B.
4. **Configure.** Generate the secrets on the server and write `.env`.
5. **Migrate and seed** the synthetic demo tenant.
6. **Verify:**
   - run `scripts/smoke-refund-journey.mts` against the staging API;
   - open the console in English and Arabic;
   - run the tenant isolation tests against the staging database;
   - record the results under `docs/validation/`.
7. **Run the live provider checks** from the staging server with test credentials (`docs/INTEGRATION_VALIDATION.md`), including `AEGIS_VALIDATE_DIRECT=1` for OSV.dev.
8. **Updating later.** `git pull` on a tagged commit, rebuild, run the migrate job, then restart api, worker and web. Roll back by deploying the previous tag. Migrations are additive.

## 9. What approval unlocks, and what it does not

**Approving this plan allows:**
- one staging environment with synthetic data;
- test-mode and paper provider keys;
- the spend in the chosen option.

**It does not allow:**
- production;
- customer data;
- live payments or live trading;
- connecting a customer's identity tenant without that customer's written authorization.

## Sources

- Railway pricing: https://docs.railway.com/reference/pricing/plans
- Hetzner 2026 price changes (third-party summaries; confirm on hetzner.com):
  - https://findstack.com/resources/hetzner-price-increase-2026
  - https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/
  - https://northflank.com/blog/hetzner-cloud-server-price-increases
- AWS t4g region listings (me-central-1 on-demand not shown; use the AWS Pricing Calculator):
  - https://sparecores.com/server/aws/t4g.medium
  - https://www.devzero.io/instances/aws/t4g.medium
- Oracle Cloud Always Free:
  - https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
  - Report of the 2026 reduction: https://terminalbytes.com/oracle-cloud-free-tier-changes-2026
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
