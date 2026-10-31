# Staging configuration review (Fly.io)

**This is the review to complete before anything is deployed.** The owner approved preparing staging on Fly.io,
subject to this review. Nothing has been deployed.

Prepared 2026-10-31 for the owner's sign-off.

| File | Contents |
| --- | --- |
| `deploy/fly/staging/fly.toml` | The configuration |
| `docs/STAGING_FLY.md` | The runbook |
| `scripts/staging-preflight.sh` | Read-only checks against the Fly account |
| `scripts/deployment-check.sh` with `AEGIS_REMOTE=1` | HTTPS checks after a deploy |

Status values:
- **Ready:** in the configuration and checked here.
- **At set-up:** done by the operator in a runbook step, then confirmed by the preflight.
- **After deploy:** can only be shown on the running deployment.
- **Decision:** needs the owner.

## 1. Requirements

| # | Requirement | How it is met | Verified by | Status |
| --- | --- | --- | --- | --- |
| 1 | Separate staging environment | Its own app `aegis-staging`, separate from the hosted demo (`aegis-demo`) and from any production. It has its own volume, secrets and URL. | Preflight "separation" checks | At set-up |
| 2 | Separate database | Its own Fly Postgres app `aegis-staging-db`, never shared. | Preflight | At set-up |
| 3 | No production customer data | Only the synthetic seed is loaded (fictional Meridian Gulf Bank tenant, `.example` addresses). The runbook has no import step, and the console labels the tenant as synthetic demo data. There is no technical barrier to a person importing data later: it is a rule of use. | Runbook step 5; this review | Ready (rule of use) |
| 4 | Secrets stored securely | Fly secrets, imported from a file outside the repository (`fly secrets import`). None in `fly.toml`, the image or the repository (gitleaks in CI). Owner credentials and test switches are never set on the app: the preflight fails if they are, and production processes refuse to start with them. | Preflight "secrets" checks; gitleaks | At set-up |
| 5 | HTTPS enforced | Console: `force_https = true`, so HTTP is redirected, and it sends HSTS (`max-age=31536000; includeSubDomains`). API: only a TLS port, 8443, with no plain-HTTP port. TLS certificates are Fly's. | Preflight config checks; remote check "plain HTTP redirected", "HSTS", "API only over TLS" | Ready; confirm after deploy |
| 6 | Restricted database permissions | The app connects as `aegis_app`: no superuser, no `BYPASSRLS`, and row-level security on every tenant table. The append-only evidence tables have their triggers. The owner password is used only from the operator's machine through `fly proxy`. | Local test of this image (section 3); remote check "evidence chain verifies"; local deployment validation (`docs/DEPLOYMENT_VALIDATION.md`) | At set-up |
| 7 | Network isolation | The database has no public IP and is reached only on Fly's private network (`.flycast`). The app exposes only 443 (console) and 8443 (API). `/metrics` needs a bearer token (`AEGIS_METRICS_TOKEN`). Outbound calls to private addresses stay blocked (`AEGIS_ALLOW_PRIVATE_DESTINATIONS` absent). Not available on Fly: per-app egress firewalling and private-only console access. If staging must not be public, see decision 4. | Preflight "network isolation"; remote check "metrics refused" | At set-up |
| 8 | Monitoring, logging and health checks | Fly checks: `/login` (console), `/health` and `/ready` (API). JSON logs through `fly logs`. Metrics with a token, optional OpenTelemetry export, and the in-product System Health page. Fly's checks restart a failing machine but page nobody, so an external uptime monitor is needed. | `fly checks list`; runbook "Monitoring and logs" | Ready; uptime monitor at set-up |
| 9 | Backup and recovery | Database: Fly's daily volume snapshots, plus `pg_dump` before every migration and weekly. Upload volume: daily snapshots kept 14 days. Keys are kept in the password manager. Restore drill per `docs/BACKUP_RECOVERY.md`. | Preflight "backups"; the restore drill | Drill after deploy |
| 10 | Documented deployment and rollback | Runbook steps 1 to 10. Deploys come from a green commit labelled with its SHA. Rollback: `fly releases --image` then `fly deploy --image`. Migrations only add, are run before the deploy, and a dump is taken first. | `docs/STAGING_FLY.md` | Ready |
| 11 | Final configuration review | This document. | Owner sign-off below | Pending |

## 2. Changes made while preparing staging

Preparing staging turned up two weaknesses, both fixed in this change:

- **The published demo password would have opened staging.**
  - The seed gave every persona, the owner among them, the demo password that is printed on the public site
    and in this repository. Anyone could have signed in to a public staging as owner.
  - Fix: the seed now takes `AEGIS_SEED_PERSONA_PASSWORD` (12 characters or more; a shorter value is refused, not
    ignored), and the runbook requires it.
  - The remote check proves the published password is refused. The browser specs read the personas' password from
    `E2E_PERSONA_PASSWORD`.
  - Regression test: `packages/core/tests/seed-persona-password.test.ts`.
- **The metrics check depended on the proxy.**
  - Without a token, `/metrics` answers loopback addresses, and behind a proxy that rests on the forwarded
    address. Tested locally with the proxy's behaviour: a client sending `X-Forwarded-For: 127.0.0.1` is refused
    once the proxy appends the real address (404). The same header with no proxy in front is accepted (200).
  - Fix: staging requires `AEGIS_METRICS_TOKEN`, and the preflight checks it is set.

## 3. Tested before any deploy

Done on 2026-10-31 against this commit's image, built from `deploy/Dockerfile`, target `demo`:

- The image ran with staging's settings: `NODE_ENV=production`, demo mode off, `aegis_app` connection, no owner
  credentials.
- The tenant was seeded with a private persona password.

| Check | Result |
| --- | --- |
| The API (`/health` and `/ready`) and the console (`/login`) answer | Pass |
| The three processes run as the unprivileged `aegis` user (UID 100), and the upload directory belongs to it | Pass |
| No `MIGRATION_DATABASE_URL` in the container | Pass |
| Console CSP, framing refused, `nosniff` on console and API, HSTS sent | Pass |
| Unauthenticated agent list refused; no stack trace in error bodies | Pass |
| Gateway with the seeded refund agent: 120 allowed (200), 1,200 held (202), 9,000 refused (403), bad key refused (401) | Pass |
| The published demo password is refused (401); the private one signs in | Pass |
| Evidence chain verifies | Pass |
| Metrics: forwarded public client refused, spoofed loopback behind a proxy refused | Pass |

The remote check gave 16 passes and 3 failures. The three failures are what local plain HTTP causes, and they are
re-checked after deploy:
- HTTP to HTTPS redirect;
- API only over TLS;
- metrics from loopback, which the test reached directly.

Not tested here, because it needs the Fly account:
- TLS termination;
- Fly's checks and restarts;
- Fly Postgres;
- private networking;
- snapshots;
- the restore drill.

The local Compose test (`docs/DEPLOYMENT_VALIDATION.md`, 27 of 27, browser suite 141 of 141) covered database
role separation and restart resilience with the same images.

## 4. Decisions for the owner

1. **One machine or several.**
   - Uploads are on a Fly volume, which belongs to one machine, so staging runs one machine and a deploy restarts it.
     That means a short outage at each deploy.
   - Several machines need a shared object store behind `packages/core/src/audit/storage.ts`, such as Tigris
     (S3-compatible). That is not built.
   - Recommendation: one machine for staging and the pentest. Build object storage before production.
2. **Region.**
   - Fly has no region in the UAE or the Gulf; the configuration uses Frankfurt (`fra`).
   - Staging holds synthetic data only, so residency does not apply to it. It does apply to any later pilot with
     customer data: see `docs/DEPLOYMENT_OPTIONS.md`.
3. **Domain.**
   - `aegis-staging.fly.dev` works with no set-up.
   - A custom domain (for example `staging.<your domain>`) needs a DNS record and `fly certs add`.
   - Recommendation: use the custom domain for the pentest, so the scope letter names a domain you control.
4. **Public or restricted.**
   - As configured, the console and API are reachable from the internet behind sign-in. That is what an external
     pentest needs.
   - If staging should be reachable only by named people before the pentest, there are two options:
     - leave the app with no public IP and reach it over WireGuard (`fly wireguard`);
     - put an identity-aware proxy in front of it.

   Say which.
5. **Machine size.**
   - `shared-cpu-2x` with 2 GB runs the three processes.
   - The images are large (`docs/DEPLOYMENT_VALIDATION.md`, Observations), so the first deploy is slow.
   - Shrinking the images is recommended before production, not needed for staging.
6. **Uptime monitor and log retention.**
   - Which external monitor pages whom?
   - Should logs go to a log store (Fly log shipper) or only `fly logs`, which is short-lived?

## 5. Before the first deploy (operator)

- [ ] Runbook steps 1 to 6 done in a Fly organization used only for staging
- [ ] `scripts/staging-preflight.sh` passes in full (output attached here)
- [ ] Decisions 1 to 6 answered
- [ ] The commit to deploy has green CI (AEGIS CI and SAST) and is the commit this review describes
- [ ] The owner signs off below

After deploy:
- [ ] Remote deployment check passes in full
- [ ] Smoke browser suite passes from GitHub
- [ ] Full browser suite passes from the operator's machine
- [ ] Restart drill done
- [ ] Restore drill done, with times recorded here
- [ ] External uptime monitor alerting

Only then is staging operational and ready for the external pentest (`docs/PENTEST_READINESS.md`,
`docs/PENTEST_RFQ.md`).

## Sign-off

| | Name | Date | Decision |
| --- | --- | --- | --- |
| Owner | | | Approve deploy / changes needed |
