# AEGIS deployment

## Processes
| Process | Package | Port | Notes |
|---|---|---|---|
| api | apps/api | 4000 | Action Gateway and REST API. Stateless; scale horizontally. |
| web | apps/web | 3000 | Console and public site (Next.js). Stateless. |
| worker | apps/worker | none | Approval expiry, monitoring, evidence checkpoints, retention. One or more replicas; the job table uses SKIP LOCKED. |
| migrate | packages/db | none | Runs once per release with owner credentials, then applies `prisma/rls.sql`. |

## Environment
See `.env.example`. Required secrets: `AEGIS_MASTER_KEY` (32 bytes base64, encrypts credentials, SSO secrets and MFA secrets), `AEGIS_SESSION_SECRET`, `EVIDENCE_SIGNING_KEY` (Ed25519 PKCS8 PEM, base64). Generate all three with `pnpm --filter @aegis/core keygen`. Rotating `AEGIS_MASTER_KEY` requires re-encrypting stored secrets (not automated in this version; documented gap). Rotating the signing key keeps old checkpoints verifiable only if the old public key is retained; export it first (`exportCheckpointPublicKey`).

Two database URLs: `DATABASE_URL` for the non-owner `aegis_app` role and `MIGRATION_DATABASE_URL` for the owner. The app role must not own tables or RLS would not apply to it.

## Local development
```
cd aegis
cp .env.example .env            # fill the three secrets with pnpm --filter @aegis/core keygen
pnpm install
pnpm db:migrate                 # migrations + RLS (needs MIGRATION_DATABASE_URL and AEGIS_APP_PASSWORD on first run)
pnpm db:seed                    # synthetic Meridian Gulf Bank tenant, demo keys written to .demo-keys.json
pnpm --filter @aegis/api dev    # http://localhost:4000
pnpm --filter @aegis/web dev    # http://localhost:3000
pnpm --filter @aegis/worker dev
```

## Docker Compose (single host)
```
cd aegis && cp .env.example .env   # fill secrets
docker compose -f deploy/docker-compose.yml up --build
```
Add `-f deploy/docker-compose.observability.yml` to run an OTLP collector and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`.

## Kubernetes
Manifests in `deploy/k8s`: namespace, config map, secret template, migrate job, api/web/worker deployments with non-root security contexts, services, ingress with TLS, and a network policy that restricts API egress to the database, Redis and DNS. Add explicit egress rules for real downstream systems so agents cannot bypass the gateway at the network level. Apply order: namespace, secrets, configmap, migrate job (wait for completion), deployments, ingress.

## Private deployment
Everything runs inside the customer boundary: no component calls an external AI provider, no telemetry leaves the cluster unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, documents uploaded to Audit are stored on the configured volume (`AEGIS_STORAGE_DIR`), and email is disabled unless `RESEND_API_KEY` is set (console provider logs instead).

## Release checklist
1. `pnpm -r typecheck && pnpm -r lint && pnpm -r test` green (CI: `.github/workflows/aegis-ci.yml`).
2. Build images from `deploy/Dockerfile` targets.
3. Run the migrate job; confirm `RLS and integrity triggers applied` in its log.
4. Roll api, worker, web.
5. Record the release in `deployment_versions` (platform admin screen or `INSERT`), which the console shows under Platform Admin.
6. Verify `GET /ready`, sign in, run the banking demo scenario against the new release.
