# Deploy AEGIS, step by step

Two routes. Route A (one Linux VM, no Docker) runs the code the way the build environment does. Route B (Docker Compose) uses the same images the Kubernetes manifests use.

What has been verified, and how (14 October 2026):
- All four images (migrate, api, worker, web) built from a clean checkout of this branch. The first build found three deployment bugs, all fixed:
  - the web image needed runtime secrets just to compile;
  - the containers' non-root user could not start pnpm;
  - the Compose seed wrote the demo keys inside a container that is then deleted.
- The images ran in production mode: migrate, seed, then API, worker and console. The HTTP smoke test (`scripts/smoke-refund-journey.mts`) passed 12 of 12 against the containerized API. The console answered 200 on /login.
- The build environment's registry quota ran out for the stock `postgres:16` image, so that run used the host's PostgreSQL 16 and Redis 7 with host networking instead of the Compose containers for them. The `postgres` and `redis` services in `deploy/docker-compose.yml` are the stock official images and were not exercised in that run.
- Nothing has been deployed to a public host.

Everything below uses the synthetic demo tenant. No real money can move: the only real connector is Stripe in test mode and it refuses live keys.

## Route A: one Linux VM (verified path)

What you need: an Ubuntu 22.04 or 24.04 VM with 2 CPUs, 4 GB RAM, 20 GB disk, a public IP, and two DNS names pointed at it. The templates assume the product lives under the owner's existing domain as `aegis.nexusai.ae` (site and console) and `aegis-api.nexusai.ae` (API): add two A records with those names at the registrar, pointing at the VM's IP. The main nexusai.ae website is a separate site and is not affected. Root or sudo access on the VM.

### 0. Before touching the server: DNS and the machine

1. At the registrar or DNS host for nexusai.ae, add two records of type A. Name `aegis`, value: the server's public IP. Name `aegis-api`, value: the same IP. Leave the TTL at its default. Nothing else on nexusai.ae changes.
2. Rent one Ubuntu 24.04 server (2 vCPU, 4 GB RAM, 20 GB disk) from any provider, with a public IPv4 address and SSH access. Put that IP into the two records above.
3. Open ports 22, 80 and 443 in the provider's firewall. Caddy needs 80 and 443 to obtain certificates.
4. Check from your laptop: `nslookup aegis.nexusai.ae` and `nslookup aegis-api.nexusai.ae` must both answer with the server IP before you run step 8.

### 1. Install the runtime

```
sudo apt update && sudo apt install -y git curl unzip postgresql-16 redis-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo corepack enable && sudo corepack prepare pnpm@10.34.7 --activate
node -v && pnpm -v      # expect v22.x and 10.34.7
```

### 2. Create the database and the two roles

Pick two passwords now. OWNER_PASSWORD is used only for migrations and the seed. APP_PASSWORD is what the running application uses.

```
sudo -u postgres psql <<'SQL'
CREATE ROLE aegis_owner LOGIN PASSWORD 'OWNER_PASSWORD';
CREATE ROLE aegis_app LOGIN PASSWORD 'APP_PASSWORD' NOBYPASSRLS;
CREATE DATABASE aegis OWNER aegis_owner;
SQL
```

Redis needs nothing: `redis-cli ping` should answer `PONG`.

### 3. Get the code

Either unzip the archive or clone the branch:

```
sudo mkdir -p /opt/aegis && sudo chown "$USER" /opt/aegis && cd /opt/aegis
git clone --branch claude/aegis-ai-governance-bgmcnk https://github.com/jzaky/School.git .
cd /opt/aegis/aegis
pnpm install
```

(If you use the zip: unzip it so that `/opt/aegis/aegis/package.json` exists.)

### 4. Create the configuration

```
./scripts/setup-env.sh
```

This writes `.env` with three freshly generated secrets. Open `.env` and set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://aegis_app:APP_PASSWORD@127.0.0.1:5432/aegis` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `API_PUBLIC_URL` | `https://aegis-api.nexusai.ae` |
| `WEB_PUBLIC_URL` | `https://aegis.nexusai.ae` |
| `API_CORS_ORIGINS` | `https://aegis.nexusai.ae` |
| `AEGIS_DEMO_MODE` | `true` for the hosted demo (shows the demo personas on the site), `false` for a pilot tenant |
| `NODE_ENV` | `production` |

Leave `MIGRATION_DATABASE_URL` commented out. Application processes refuse to start in production if they find owner credentials; you pass them inline in the next step only.

### 5. Migrate and seed

```
cd /opt/aegis/aegis
MIGRATION_DATABASE_URL=postgresql://aegis_owner:OWNER_PASSWORD@127.0.0.1:5432/aegis AEGIS_APP_PASSWORD=APP_PASSWORD pnpm db:migrate
MIGRATION_DATABASE_URL=postgresql://aegis_owner:OWNER_PASSWORD@127.0.0.1:5432/aegis pnpm db:seed
```

Expected: the first prints `All migrations have been successfully applied` and `RLS and integrity triggers applied`. The second takes about a minute and ends with `Seeded demo tenant ...`, the list of demo users, and `Demo agent API keys written to .../.demo-keys.json`. Keep that file private; it holds the demo agents' API keys.

### 6. Build the console and create the upload directory

```
pnpm --filter @aegis/web build
sudo useradd --system --home /opt/aegis --shell /usr/sbin/nologin aegis || true
sudo mkdir -p /var/lib/aegis/uploads && sudo chown -R aegis:aegis /var/lib/aegis /opt/aegis
```

### 7. Run the three processes as services

```
sudo cp deploy/systemd/aegis-api.service deploy/systemd/aegis-web.service deploy/systemd/aegis-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aegis-api aegis-web aegis-worker
systemctl status aegis-api aegis-web aegis-worker --no-pager
curl -s http://127.0.0.1:4000/health && echo && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
```

Expected: three active services, `{"ok":true...}` from the API and `200` from the console.

### 8. Put HTTPS in front

```
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile      # already set to aegis.nexusai.ae and aegis-api.nexusai.ae
sudo systemctl reload caddy
```

Caddy obtains the certificates automatically on the first request. The API and console cookies are marked Secure in production, so sign-in only works over HTTPS.

### 9. Prove it works

1. Open `https://aegis.nexusai.ae/login` and sign in as `nadia.haddad@meridian-demo.example` with the password printed by the seed (`AegisDemo2026!`).
2. Open Getting started and press Explore a sample workflow, then Run on the Refunds scenario. Expect six steps including one refund executed, one waiting for approval, one refused as a duplicate and one denied.
3. Sign out, sign in as `lina.mansour@meridian-demo.example`, open Approvals, approve the AED 1,450 refund. Expect "Approved and executed" with a reference.
4. From the VM, run the HTTP smoke test:

```
cd /opt/aegis/aegis && AEGIS_API_URL=https://aegis-api.nexusai.ae npx tsx scripts/smoke-refund-journey.mts
```

Expect `12/12 checks passed`.

### 10. Updating later

```
cd /opt/aegis/aegis && git pull && pnpm install
MIGRATION_DATABASE_URL=postgresql://aegis_owner:OWNER_PASSWORD@127.0.0.1:5432/aegis pnpm db:migrate
pnpm --filter @aegis/web build
sudo systemctl restart aegis-api aegis-web aegis-worker
```

To reset the demo tenant to a clean state, re-run the seed command from step 5; it rebuilds the tenant.

## Route B: Docker Compose on one host

What you need: a machine with Docker 24 or newer and the Compose plugin.

```
cd aegis
./scripts/setup-env.sh                        # then edit .env as in Route A step 4 (keep 127.0.0.1 URLs; Compose overrides them)
docker compose -f deploy/docker-compose.yml up --build -d
docker compose -f deploy/docker-compose.yml --profile seed run --rm seed
docker compose -f deploy/docker-compose.yml ps
curl -s http://127.0.0.1:4000/health                     # {"ok":true,...}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login   # 200
```

The stack is Postgres, Redis, a one-shot migrate job, the API on port 4000, the console on port 3000 and the worker. The seed prints the demo users. It writes the demo agent API keys and the platform admin password to `deploy/seed-output/.demo-keys.json` on the host (mode 600, ignored by git). Keep that file private.

To run the smoke test from the host, copy that file to `aegis/.demo-keys.json`, then run `AEGIS_API_URL=http://127.0.0.1:4000 npx tsx scripts/smoke-refund-journey.mts`. Expect 12/12.

Put Caddy or any other TLS proxy in front exactly as in Route A step 8, pointing at ports 3000 and 4000. Sign-in needs HTTPS in production because the cookies are Secure.

Database passwords for Compose come from `POSTGRES_OWNER_PASSWORD` and `POSTGRES_APP_PASSWORD` in your shell environment (defaults are development values; set real ones for anything reachable from the internet).

The images are large (about 3.9 GB for api and worker) because they carry the full workspace and its development dependencies. Slimming them is a follow-up, not a blocker.

## Route C: Kubernetes

Manifests in `deploy/k8s`. Apply in this order: namespace, secrets (copy `secrets.example.yaml`, fill in, never commit), configmap, storage (choose a ReadWriteMany storage class), migrate job (wait for completion), api, web, worker, ingress, networkpolicy. Build and push the four images first:

```
docker build -f deploy/Dockerfile --target api     -t REGISTRY/aegis-api:TAG .
docker build -f deploy/Dockerfile --target web     -t REGISTRY/aegis-web:TAG .
docker build -f deploy/Dockerfile --target worker  -t REGISTRY/aegis-worker:TAG .
docker build -f deploy/Dockerfile --target migrate -t REGISTRY/aegis-migrate:TAG .
```

Then replace the `ghcr.io/example/...` image names in the manifests with yours.

## Connecting Stripe test mode (pilot)

1. In the Stripe dashboard, switch to test mode and create a secret key. It starts with `sk_test_`.
2. In the console as `karim.nassar@meridian-demo.example` (engineer), open More, then Integrations, then Stripe (test mode), store the key under the name `secret-key`, and press Test connection. Live keys are refused with an explanation.
3. Enable the integration (it is created disabled until a credential exists).
4. From the VM, run the full journey against real Stripe test mode and reconcile:

```
STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/stripe-sandbox-check.mts
```

This has not yet been run against real Stripe by us; report its output and we will adjust anything the live API answers differently.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| A service fails with "received privileged database settings it must not hold" | `MIGRATION_DATABASE_URL` or `AEGIS_APP_PASSWORD` is in `.env`. Remove them; pass them inline to migrate and seed only. |
| `Invalid environment: AEGIS_MASTER_KEY ...` | `.env` is missing the secrets. Run `./scripts/setup-env.sh` (delete the old `.env` first) or generate with `pnpm --filter @aegis/core keygen`. |
| Sign-in form submits but you stay logged out | You are on plain HTTP in production; cookies are Secure. Use the HTTPS hostname. |
| Console shows "Requires an organization" | The seed did not run or ran against a different database. Re-run step 5 with the same `DATABASE_URL` host. |
| Uploads disappear after a restart | `AEGIS_STORAGE_DIR` points at a non-persistent path. Use `/var/lib/aegis/uploads` (Route A) or the `uploads` volume (Route B). |
| Stripe connection test says the key is unavailable | No credential stored yet, or it was revoked. Store a test-mode key named `secret-key`. |
