# Staging on Fly.io

Staging is where AEGIS runs on real infrastructure before any customer does: HTTPS, Fly's private network, a
managed PostgreSQL and real restarts.

- **Data:** synthetic data only. No customer or production data is ever loaded into it.
- **Separation:** it is separate from the hosted demo (`docs/DEPLOY_FLY_DEMO.md`). It has its own app, database,
  volume, secrets and domain.
- **Approval:** the owner approved preparing it on Fly.io. **Deploying needs the owner's go-ahead after the
  configuration review** (`docs/STAGING_CONFIG_REVIEW.md`). Nothing in this repository deploys it.

## What runs where

| Piece | On Fly | Notes |
| --- | --- | --- |
| Console, Action Gateway API, worker | App `aegis-staging`, one machine, image target `demo` (`deploy/Dockerfile`) | `deploy/fly/start-all.sh` runs the three processes as the unprivileged `aegis` user. If any of them exits, the machine restarts. Configuration: `deploy/fly/staging/fly.toml`. |
| PostgreSQL 16 | App `aegis-staging-db` (Fly Postgres) | Its own cluster, never shared with the demo. No public IP. The app connects as `aegis_app` (no superuser, no RLS bypass); the owner password never reaches the app. |
| Uploads | Volume `aegis_staging_data` on the app machine | Daily volume snapshots, kept 14 days. |
| Console | `https://aegis-staging.fly.dev` (or a custom domain) | HTTPS only; HTTP redirects. |
| API for agents and SDKs | `https://aegis-staging.fly.dev:8443` | TLS terminated by Fly; no plain-HTTP port. |

**One machine.** Uploads live on a Fly volume, and a volume belongs to one machine. More than one replica needs a
shared object store behind `packages/core/src/audit/storage.ts`, such as Fly's S3-compatible Tigris. That is not
built. It is decision 1 in the configuration review.

## Steps

All commands run from `aegis/` on the operator's machine, with `flyctl` signed in (`fly auth login`). Type secrets
into your own shell or files outside the repository; never paste them into a chat or commit them.

**1. Create the app**, in an organization or project used only for staging:

```
fly apps create aegis-staging
```

**2. Create the database.** It gets no public IP unless you add one: do not.

```
fly postgres create --name aegis-staging-db --region fra --vm-size shared-cpu-1x --volume-size 10 --initial-cluster-size 1
```

Keep the printed `postgres` (owner) password in the password manager. It is used only from the operator's machine,
in step 5.

**3. Create the upload volume:**

```
fly volumes create aegis_staging_data --region fra --size 3 -a aegis-staging
```

**4. Generate the application keys**, into a file outside the repository:

```
pnpm install
pnpm --filter @aegis/core keygen > ~/aegis-staging.secrets
```

**5. Migrate and create the test tenant from the operator's machine.** The owner credentials stay off the app.

In one terminal:

```
fly proxy 15432:5432 -a aegis-staging-db
```

In another:

```
read -rs PGOWNER && export PGOWNER                         # the owner password from step 2
read -rs AEGIS_APP_PASSWORD && export AEGIS_APP_PASSWORD   # a new long random password for aegis_app
read -rs AEGIS_SEED_PERSONA_PASSWORD && export AEGIS_SEED_PERSONA_PASSWORD   # a new password for the test personas
set -a; . ~/aegis-staging.secrets; set +a
export MIGRATION_DATABASE_URL="postgresql://postgres:$PGOWNER@127.0.0.1:15432/aegis"
export DATABASE_URL="postgresql://aegis_app:$AEGIS_APP_PASSWORD@127.0.0.1:15432/aegis"
export WEB_PUBLIC_URL=https://aegis-staging.fly.dev
psql "postgresql://postgres:$PGOWNER@127.0.0.1:15432/postgres" -c "CREATE DATABASE aegis"
pnpm --filter @aegis/db generate && pnpm --filter @aegis/db migrate
AEGIS_DEMO_KEYS_FILE=$HOME/aegis-staging-keys.json pnpm --filter @aegis/core seed
```

What these do:
- The migration creates `aegis_app` with the password you chose and applies row-level security and the integrity
  triggers.
- The seed creates the synthetic test tenant. Its agent keys and the platform administrator's password go to
  `~/aegis-staging-keys.json`, outside the repository.
- The personas get `AEGIS_SEED_PERSONA_PASSWORD`, not the demo password published on the public site and in this
  repository. Without it, anyone who read the repository could sign in to staging as the owner. Keep it in the
  password manager.

**6. Set the app's secrets** from a file outside the repository, so nothing lands in shell history:

```
cat > ~/aegis-staging.env <<EOF
DATABASE_URL=postgresql://aegis_app:<app password>@aegis-staging-db.flycast:5432/aegis
AEGIS_MASTER_KEY=<from ~/aegis-staging.secrets>
AEGIS_SESSION_SECRET=<from ~/aegis-staging.secrets>
EVIDENCE_SIGNING_KEY=<from ~/aegis-staging.secrets>
API_PUBLIC_URL=https://aegis-staging.fly.dev:8443
WEB_PUBLIC_URL=https://aegis-staging.fly.dev
API_CORS_ORIGINS=https://aegis-staging.fly.dev
AEGIS_METRICS_TOKEN=<output of: openssl rand -hex 32>
EOF
fly secrets import -a aegis-staging < ~/aegis-staging.env
```

Never set `MIGRATION_DATABASE_URL`, `AEGIS_APP_PASSWORD` or `AEGIS_ALLOW_PRIVATE_DESTINATIONS` on the app.
Production processes refuse to start with them, and the preflight fails if they are present.

**7. Preflight and review.** Run the read-only preflight, then complete `docs/STAGING_CONFIG_REVIEW.md` with its
output:

```
scripts/staging-preflight.sh aegis-staging aegis-staging-db
```

**8. Deploy, only after the review is signed off.** Deploy from a reviewed commit and label the image with it:

```
fly deploy --config deploy/fly/staging/fly.toml --dockerfile deploy/Dockerfile --build-target demo --image-label "$(git rev-parse --short HEAD)"
```

**9. Verify over HTTPS.**
- Run the deployment check in remote mode. It makes HTTP checks only, with no restarts:

  ```
  AEGIS_REMOTE=1 AEGIS_API=https://aegis-staging.fly.dev:8443 AEGIS_WEB=https://aegis-staging.fly.dev \
    AEGIS_AGENT_KEY=<support-refund-agent key from ~/aegis-staging-keys.json> \
    AEGIS_SIGNIN_EMAIL=nadia.haddad@meridian-demo.example AEGIS_SIGNIN_PASSWORD=<persona password> \
    scripts/deployment-check.sh
  ```

  Among its checks: the published demo password must be refused.
- Run the GitHub workflow "AEGIS browser tests against a live URL" against the console URL, suite `smoke`. It
  needs no credentials.
- Run the full browser suite from the operator's machine. It signs in as the personas and the platform
  administrator, so it needs the staging keys file. Copy the file in for the run and delete it afterwards:

  ```
  cp ~/aegis-staging-keys.json .demo-keys.json
  cd apps/web && E2E_BASE_URL=https://aegis-staging.fly.dev E2E_PERSONA_PASSWORD=<persona password> npx playwright test
  cd ../.. && rm .demo-keys.json
  ```

  It changes data: run it only against staging's synthetic tenant, never against a deployment holding anything
  else.

**10. Restart and recovery drill.** Record each result in the review:
- `fly machine restart <id> -a aegis-staging`: the API is ready again, the gateway decides and the evidence verifies;
- `fly postgres restart -a aegis-staging-db`: the same;
- the restore drill under Backups.

## Monitoring and logs

- **Health:** Fly runs the checks in `fly.toml`: `/login` on the console, `/health` (process) and `/ready`
  (database through `aegis_app`) on the API. A failing check shows in `fly checks list -a aegis-staging`, and
  Fly restarts the machine after repeated failures (`[[restart]] policy = "always"`).
- **External uptime:** add an external monitor on `https://aegis-staging.fly.dev:8443/ready` and on the console
  URL, alerting the owner. Fly's own checks do not page anyone.
- **Logs:** structured JSON on stdout, through `fly logs -a aegis-staging`. They never contain secrets or request
  bodies with personal data (`docs/SECURITY.md`). To keep them, attach a Fly log shipper to the organization's log
  store.
- **Metrics and traces:** with `AEGIS_METRICS_TOKEN` set, `/metrics` answers only to that bearer token. The
  check no longer depends on the proxy's forwarded address. A Prometheus scraper or Fly's metrics agent can read
  it with the token. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an OpenTelemetry collector to export traces and metrics
  (collector example: `deploy/otel-collector.yaml`).
- **In the product:** Platform Diagnostics and System Health show the checks, jobs, dead letters and evidence
  verification.

## Backups and recovery

- **Database:** Fly Postgres takes daily volume snapshots (`fly volumes snapshots list`). In addition, take a
  logical backup before every migration and weekly:

  ```
  fly proxy 15432:5432 -a aegis-staging-db &
  pg_dump -Fc "postgresql://postgres:$PGOWNER@127.0.0.1:15432/aegis" > ~/aegis-staging-$(date +%F).dump
  ```

  Store it encrypted, outside the repository.
- **Upload volume:** daily snapshots, kept 14 days (`snapshot_retention` in `fly.toml`).
- **Keys:** the master key and the evidence signing key are in Fly secrets and in the operator's password manager.
  Losing the master key makes stored integration credentials unrecoverable; evidence still verifies.
- **Restore drill**, before staging is called operational:
  1. Restore the latest dump into a scratch database.
  2. Run the migration against it.
  3. Verify the evidence chain (`POST /v1/assurance/evidence/verify`).
  4. Record the time it took. The method is the one in `docs/BACKUP_RECOVERY.md`. A drill on Fly has not been
     done yet.

## Deploying a change, and rolling back

- **Deploy:** every deploy comes from a commit whose CI is green, labelled with its SHA (step 8).
  1. Take a database dump if the commit adds a migration.
  2. Run the migration from the operator's machine (step 5's migrate line) **before** `fly deploy`.
  3. Deploy.
  4. Run step 9.
- **Roll back the application:**

  ```
  fly releases -a aegis-staging --image
  fly deploy --config deploy/fly/staging/fly.toml --image <previous image>
  ```

  Then run step 9.
- **Roll back the database:** migrations only add (new tables, columns and policies), so the previous release runs
  against the newer schema. If a migration itself must be undone, restore the pre-migration dump into a new
  database. Point `DATABASE_URL` at it with `fly secrets set`, which restarts the machine, and verify the evidence.

## Taking it down

```
fly apps destroy aegis-staging
fly apps destroy aegis-staging-db
```

Then delete `~/aegis-staging.secrets`, `~/aegis-staging.env`, `~/aegis-staging-keys.json` and the dumps.
