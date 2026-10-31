# Deployment validation (production-like, local)

Date: 2026-10-31. Commit: `18806db`.

What was tested: the repository's own production images and Docker Compose file
(`deploy/Dockerfile`, `deploy/docker-compose.yml`), run as a single-host deployment. It was checked over real HTTP
between real containers.

What this is not:
- not a cloud or staging deployment;
- not tested behind TLS, a load balancer or more than one replica;
- not independent.

A staging deployment needs the owner's approval and hosting credentials (`docs/STAGING_DEPLOYMENT_PLAN.md`,
`docs/DEPLOY_FLY_DEMO.md`).

## Set-up

- Images built from `deploy/Dockerfile`: api, worker, web and migrate.
- Services: Postgres 16, Redis 7, the migrate job, api, worker and web, plus the seed profile for the synthetic
  demo tenant.
- Production settings:
  - `NODE_ENV=production`;
  - freshly generated master key, session secret, evidence signing key and database passwords;
  - none of them committed.
- Two departures from a real deployment. Both are needed only because this build machine reaches the internet
  through a proxy with its own certificate:
  - At build time, a local copy of the Dockerfile trusted that certificate and fetched Debian packages over HTTPS.
  - The final images also carry that certificate (`NODE_EXTRA_CA_CERTS`).

  Nothing else differs from `deploy/Dockerfile`.

## Results

`scripts/deployment-check.sh` (27 checks) plus the browser suites. Every check passed.

| Area | Checks |
| --- | --- |
| Health | `/health` and `/ready` on the API, the console sign-in page. |
| Database roles | The api, worker and web connect only as `aegis_app`, which is neither superuser nor allowed to bypass row-level security. No owner credential is present in their environments. An app service given an owner URL refuses to start ("received settings it must not hold in production: MIGRATION_DATABASE_URL"). |
| Headers and exposure | The console sends a nonce-based Content-Security-Policy, refuses framing and sends `nosniff`; the API sends `nosniff`. Prometheus metrics are refused from outside the host. An unauthenticated agent list is refused (401). A malformed request's error body carries no stack trace. |
| Gateway end to end | With the seeded refund agent's key: a small refund is allowed (200), one in the approval band is held (202), one above the ceiling is refused (403), and a bad key is refused (401). |
| Worker | It runs, never restarted or crashed, and completes new jobs (approval expiry, monitoring, evidence checkpoints). Jobs done grew from 194 to over 199 during the test. |
| Restart resilience | After the API container restarts, and again after the database restarts, the API is ready, the gateway decides, the console serves and the worker completes new jobs. The worker logs the dropped connections and carries on. |
| Evidence | The evidence chain verifies through the API after the restarts: 3,464 events, including the signed checkpoints the worker wrote. |
| Browser | The live-URL smoke suite (20 tests: public site, marketing, CSP) and the full browser suite (141 tests) pass against the deployed console. |

## Observations

- **Image size.** web 5.6 GB, api and worker 3.4 GB, migrate 2.0 GB. The images carry the whole workspace with its
  development dependencies. They work, but they are slow to pull and enlarge the surface a container scanner has to
  cover. Recommendation: a pruned production install per service (`pnpm deploy --prod`), and Next.js standalone
  output for the console. Not changed in this pass.
- The worker's database errors during a database restart are logged at error level. That is expected, but an
  alert rule on worker errors should allow for a restart.

## Repeat it

```bash
cd aegis
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml --profile seed run --rm seed
scripts/deployment-check.sh            # restarts api and postgres: disposable deployments only
cd apps/web && E2E_BASE_URL=http://localhost:3000 npx playwright test
```

The browser suite reads the platform administrator's password from `aegis/.demo-keys.json`; copy the seed's
`deploy/seed-output/.demo-keys.json` there first.
