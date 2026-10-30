# Hosted demo on Fly.io

This guide puts the AEGIS demo on a public HTTPS URL, with synthetic data only. It is for prospects and the DCAI sprint, not for customer data. Production for UAE customers runs in a UAE region on another platform (docs/DEPLOYMENT_OPTIONS.md, docs/STAGING_DEPLOYMENT_PLAN.md).

**Approval.** Publishing the demo is the owner's decision. Nothing in this repository deploys it automatically.

## What runs where

| Piece | On Fly | Notes |
|---|---|---|
| Console (web), Action Gateway API, worker | One app, one machine, image target `demo` (`deploy/Dockerfile`) | They share one volume for uploads. `deploy/fly/start-all.sh` runs the three processes as the unprivileged `aegis` user and exits if any of them dies, so Fly restarts the machine. |
| PostgreSQL 16 | Fly Postgres app | The app connects as `aegis_app`, a non-owner role with row-level security. The owner password stays off the app machines. |
| Redis | Upstash Redis through `fly redis` | Optional. AEGIS keeps its jobs and rate limits in PostgreSQL and does not read or write Redis; `REDIS_URL` is only reported by the deployment readiness check. |
| Console URL | `https://<app>.fly.dev` | Port 443. |
| API URL for agents and SDKs | `https://<app>.fly.dev:8443` | Port 8443, TLS handled by Fly. |

`fra` (Frankfurt) is set as the region in `deploy/fly/fly.toml`. Change it if a closer Fly region suits your audience.

Tested before release: the start script, the privilege drop, the shared volume, and restart on a crashed process. These ran in a container locally, against PostgreSQL and Redis. The full Fly deployment has not been run from here, because it needs your Fly account.

## Steps

All commands run from the `aegis/` directory on your machine. Type secrets into your own shell; never paste them into a chat or commit them.

**1. Install and sign in.** Install `flyctl` (fly.io/docs/flyctl/install), then run `fly auth login`.

**2. Create the app.** Pick a name and put it in `deploy/fly/fly.toml` as `app`:

```
fly apps create aegis-demo
```

**3. Create the database:**

```
fly postgres create --name aegis-demo-db --region fra --vm-size shared-cpu-1x --volume-size 10 --initial-cluster-size 1
```

Keep the printed `postgres` password in your password manager. It is the owner role. It is used only from your machine, in step 6.

**4. Create Redis:**

```
fly redis create --name aegis-demo-redis --region fra --no-replicas
```

When asked "Would you like to enable eviction?", answer N (the default). AEGIS stores nothing in Redis today, so the answer has no effect, and eviction would be wrong for a queue later. You can also skip this step and leave `REDIS_URL` out of step 7.

Keep the printed `redis://` URL for step 7.

**5. Create the volume for uploads:**

```
fly volumes create aegis_data --region fra --size 3 -a aegis-demo
```

**6. Migrate and seed from your machine.** This keeps the owner credentials off the app.

In one terminal:

```
fly proxy 15432:5432 -a aegis-demo-db
```

In another terminal:

```
pnpm install
pnpm --filter @aegis/core keygen > ~/aegis-fly-demo.secrets   # three generated keys, kept outside the repository
read -rs PGOWNER && export PGOWNER                            # the postgres password from step 3
read -rs AEGIS_APP_PASSWORD && export AEGIS_APP_PASSWORD      # choose a new long random password for aegis_app
set -a; . ~/aegis-fly-demo.secrets; set +a
export MIGRATION_DATABASE_URL="postgresql://postgres:$PGOWNER@127.0.0.1:15432/aegis"
export DATABASE_URL="postgresql://aegis_app:$AEGIS_APP_PASSWORD@127.0.0.1:15432/aegis"
export AEGIS_DEMO_MODE=true WEB_PUBLIC_URL=https://aegis-demo.fly.dev
psql "postgresql://postgres:$PGOWNER@127.0.0.1:15432/postgres" -c "CREATE DATABASE aegis"
pnpm --filter @aegis/db generate && pnpm --filter @aegis/db migrate
AEGIS_DEMO_KEYS_FILE=$HOME/aegis-fly-demo-keys.json pnpm --filter @aegis/core seed
```

The migration creates the `aegis_app` role with the password you chose and applies row-level security. The seed builds the demo tenant. It writes the agent API keys and the platform admin password to `~/aegis-fly-demo-keys.json`, outside the repository.

**7. Set the app's secrets.** Write them to a file outside the repository and import it, so nothing lands in your shell history:

```
cat > ~/aegis-fly-demo.env <<EOF
DATABASE_URL=postgresql://aegis_app:<app password>@aegis-demo-db.flycast:5432/aegis
REDIS_URL=<the redis:// URL from step 4>
AEGIS_MASTER_KEY=<from the secrets file>
AEGIS_SESSION_SECRET=<from the secrets file>
EVIDENCE_SIGNING_KEY=<from the secrets file>
API_PUBLIC_URL=https://aegis-demo.fly.dev:8443
WEB_PUBLIC_URL=https://aegis-demo.fly.dev
API_CORS_ORIGINS=https://aegis-demo.fly.dev
EOF
fly secrets import -a aegis-demo < ~/aegis-fly-demo.env
```

Do not set `MIGRATION_DATABASE_URL`, `AEGIS_APP_PASSWORD` or `AEGIS_ALLOW_PRIVATE_DESTINATIONS` on the app. Production processes refuse to start when they find them.

Optional, for email copies of approvals and alerts: set `AEGIS_EMAIL_NOTIFICATIONS=true`, `RESEND_API_KEY` and `EMAIL_FROM` (docs/INTEGRATION_VALIDATION.md, Resend).

**8. Deploy:**

```
fly deploy --config deploy/fly/fly.toml --dockerfile deploy/Dockerfile --build-target demo
```

Fly builds the image on its own builders. The first build takes several minutes.

**9. Verify:**

```
curl -sf https://aegis-demo.fly.dev/login > /dev/null && echo console ok
curl -s https://aegis-demo.fly.dev:8443/health
AEGIS_API_URL=https://aegis-demo.fly.dev:8443 npx tsx scripts/smoke-refund-journey.mts
```

Then run the browser tests against the URL. Go to GitHub Actions and run "AEGIS browser tests against a live URL" with the console URL, suite `smoke`. The `full` suite also works on this demo, because the demo holds synthetic data only. Reset the data afterwards (next step).

**10. Keep it fresh.** Run step 6's seed command again (with the proxy open) whenever the demo data should be reset. It is idempotent and rebuilds the demo tenant.

## Costs and limits

Fly bills by machine size, volume and egress. Check fly.io/pricing for current prices before you create the resources; no figure is given here. One `shared-cpu-2x` machine with 2 GB, a 10 GB Postgres and a 3 GB volume is enough for demonstrations, not for load tests.

## Taking it down

```
fly apps destroy aegis-demo
fly apps destroy aegis-demo-db
fly redis destroy aegis-demo-redis
```

Then delete `~/aegis-fly-demo.secrets`, `~/aegis-fly-demo.env` and `~/aegis-fly-demo-keys.json`.
