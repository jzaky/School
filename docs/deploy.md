# Deploying on Railway

One Docker image runs two Railway services from the same GitHub repository:

| Service | Config file | Start | Health check |
| --- | --- | --- | --- |
| `web` | `railway.json` | `/app/scripts/docker-start.sh`: migrations + RLS, seed the demo school if it is missing, then `node server.js` | `GET /login` |
| `worker` | `railway.worker.json` | `node --import tsx src/worker/index.ts` (same as `npm run worker`) | none |

Plus two Railway plugins: PostgreSQL and Redis.

## 1. Create the project

1. In Railway, create a new project from the GitHub repository.
2. Add a **PostgreSQL** database (New > Database > PostgreSQL).
3. Add a **Redis** database (New > Database > Redis).
4. The service created from the repo becomes `web`. Rename it to `web`.
5. Add a second service from the same repo and name it `worker`.
6. In `worker` > Settings > Config-as-code, set the config file path to `/railway.worker.json`. Leave `web` on the default `/railway.json`.
   - If you prefer not to use the second file: on `worker`, set Custom Start Command to `node --import tsx src/worker/index.ts` and remove the health check path.

Both services build with the `Dockerfile` (node 22 slim, multi-stage, Next.js standalone output).

## 2. Database roles

The app never connects as the database owner. Row-Level Security only holds for a role that does not own the tables, so there are two connection strings to the same database:

- `MIGRATION_DATABASE_URL`: the owner role Railway creates (`postgres`). Used for migrations, `prisma/rls.sql`, seeding, the demo reset and, in the worker, only to list organizations.
- `DATABASE_URL`: the `app_user` role. Used by every request and by all tenant work in the worker (through `tenantDb(orgId)` / `tenantTx`).

`app_user` does not need to exist beforehand. On every web start, `scripts/db-migrate.ts` runs `prisma migrate deploy`, creates or updates `app_user` with `APP_USER_PASSWORD`, grants it access and applies `prisma/rls.sql`. Build `DATABASE_URL` from the same host, port and database as the owner URL, with `app_user` and that password:

```
MIGRATION_DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_URL=postgresql://app_user:${{shared.APP_USER_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
```

If `APP_USER_PASSWORD` contains characters such as `@`, `:` or `/`, URL-encode it in `DATABASE_URL` (or generate a hex password, below, which never needs encoding).

## 3. Environment variables

Put shared values in Project > Settings > Shared Variables and reference them from both services (`${{shared.NAME}}`). Both `web` and `worker` need everything marked "both".

### Required

| Variable | Services | What it is |
| --- | --- | --- |
| `DATABASE_URL` | both | Postgres URL for `app_user` (see above). |
| `MIGRATION_DATABASE_URL` | both | Postgres URL for the owner role: `${{Postgres.DATABASE_URL}}`. The worker uses it to list organizations and for the nightly demo reset. |
| `APP_USER_PASSWORD` | web | Password `db-migrate` sets for `app_user`. Generate with `openssl rand -hex 24`. Must match the password inside `DATABASE_URL`. |
| `REDIS_URL` | both | `${{Redis.REDIS_URL}}`. Without it the app still works (outbound rows stay QUEUED) and the worker logs that it is disabled and exits 0. |
| `AUTH_SECRET` | web | Auth.js session encryption secret. Generate with `openssl rand -base64 32`. |
| `AUTH_URL` | web | Public URL of the web service, for example `https://school.up.railway.app`. Auth.js uses it for callback URLs. `trustHost` is on, so the Railway proxy host is accepted. |
| `APP_URL` | both | Same public URL. The worker uses it to build links in emails (`APP_URL/<locale>/<path>`). |
| `FIELD_ENCRYPTION_KEY` | both | 32 random bytes, base64. Encrypts Emirates ID, passport and medical fields (AES-256-GCM). Generate with `openssl rand -base64 32`. Never change it after data exists: encrypted fields become unreadable. The seed needs it too. |
| `DEMO_MODE` | both | `true` for the demo deployment: shows the persona switcher, seeds the demo school on first start, and enables the nightly demo reset in the worker (22:00 UTC, 02:00 Dubai). Anything else turns these off. |

### Optional

| Variable | Services | What it is |
| --- | --- | --- |
| `SIGNUP_ENABLED` | web | Default `true`. Set to `false` to close self-serve school sign-up: /signup shows a closed notice and the "Start free pilot" links disappear. Sign-up creates schools with the owner connection (`PLATFORM_DATABASE_URL`, falling back to `MIGRATION_DATABASE_URL`), so one of those must be set on the web service. |
| `PLATFORM_DATABASE_URL` | web | Optional owner connection for platform writes (school sign-up, global catalog). Falls back to `MIGRATION_DATABASE_URL`. |
| `SEED_ON_START` | web | Default `true`. Set to `false` to skip the "seed demo if missing" step at start. Seeding only ever runs when `DEMO_MODE=true` and the `horizon` organization does not exist. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | web | Google sign-in. The button appears only when both are set. Redirect URI: `AUTH_URL/api/auth/callback/google`. |
| `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` | web | Microsoft Entra ID sign-in. The button appears only when both are set. Redirect URI: `AUTH_URL/api/auth/callback/microsoft-entra-id`. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | web | Entra issuer, for example `https://login.microsoftonline.com/<tenant-id>/v2.0`. Leave unset for multi-tenant (common). |
| `RESEND_API_KEY` | both | Resend API key. The worker sends email through `https://api.resend.com/emails` when set; otherwise it logs `outbound <id> channel=<channel>` only. The web app uses it to show email preferences as enabled. |
| `EMAIL_FROM` | worker | Sender, for example `Horizon School <no-reply@yourdomain.com>` on a domain verified in Resend. Default `Horizon School <onboarding@resend.dev>` (Resend test sender, delivers only to the Resend account owner). |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | web | Cloudflare R2 (S3 API) for documents. Used only when all four are set. Files are served through signed URLs. |
| `LOCAL_UPLOAD_DIR` | web | Fallback directory for documents when R2 is not set. Default `/app/.uploads`, which is lost on every redeploy. For a demo without R2, attach a Railway volume and point this at its mount path. |
| `ANTHROPIC_API_KEY` | web | Enables the Anthropic AI provider. Without it the built-in (non-network) provider is used. |
| `AI_MODEL` | web | Model id for the AI provider. Default `claude-opus-5`. |
| `COLLEGE_SCORECARD_API_KEY` | web, worker | Free api.data.gov key for the US College Scorecard import (Universities, Manage programmes, Run import). Without it the import uses `DEMO_KEY`, which allows only a few requests an hour, so the button imports the first 5 pages only. |
| `PLATFORM_DATABASE_URL` | web, worker | Optional owner-role Postgres URL for writing the shared university catalog (catalog review publish, requirement page checks, Scorecard catalog import). Falls back to `MIGRATION_DATABASE_URL`. Without either, catalog review is read-only and the catalog jobs log a skip. |
| `PLATFORM_ADMIN_EMAILS` | web | Comma-separated emails of platform catalog reviewers who may publish shared requirements from a non-demo school. Members of the demo school with `catalog.review` may always publish. |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | both | Web push (phone and browser notifications). Generate the key pair with `npx tsx scripts/vapid-keys.ts`; the subject is a `mailto:` or `https:` contact. Without all three the push option is hidden in Settings and nothing is sent. Changing the keys invalidates every device subscription. |
| `WHATSAPP_PROVIDER` | both | Unset: WhatsApp is not offered. `console`: offered, messages are only logged (demo and development). `meta`: WhatsApp Business Cloud API, which also needs the variables below. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | worker (and web for the switch) | Meta Cloud API access token and the sending phone number id. |
| `WHATSAPP_TEMPLATE_GENERIC` | both | Name of the approved template used for every message without its own template and for all sensitive ones. Body `{{1}}` = school name; one URL button whose dynamic suffix is the portal path (base URL `APP_URL/` in the template). |
| `WHATSAPP_TEMPLATE_<KIND>` | worker | Optional approved template per message type, for example `WHATSAPP_TEMPLATE_REQUEST_COMPLETED`. Body `{{1}}` = school name, `{{2}}` = notification title; same URL button. Templates must exist in en and ar. |
| `WHATSAPP_API_VERSION` | worker | Graph API version. Default `v21.0`. |
| `PLATFORM_ADMIN_EMAILS` | web | Comma-separated emails of platform admins. They see the Platform section (marketing leads with CSV export, referrals per school, platform settings such as pricing) and may publish shared requirements from a non-demo school. Members of the demo school with `catalog.review` may always publish catalog changes. Never list a demo persona: in production, addresses on reserved domains (for example horizon.example) are ignored. |

Set by the image, no action needed: `NODE_ENV=production`, `PORT=3000` (Railway overrides `PORT`, the server follows it), `HOSTNAME=0.0.0.0`.

### US institutions (College Scorecard)

The demo shows every currently operating, degree-granting US institution when the snapshot `prisma/seed/data/us-institutions.json.gz` exists; the seed imports it without a network call. It is not committed yet because api.data.gov was not reachable from the build environment. To create it (about 50 requests of 100 institutions), run `COLLEGE_SCORECARD_API_KEY=... npx tsx scripts/import-scorecard.ts --snapshot` and commit the file.

Other modes: `--org horizon` fetches and upserts straight into one school, `--org horizon --from-snapshot` loads the committed snapshot into an existing school, and `--max-pages N` limits requests. Re-running is safe: institutions are matched by `University.scorecardId`, then by name for catalogue entries, and never duplicated. In the app, a member with `pathways.manage` can run the same import from Universities, Manage programmes.

## 4. Deploy

1. Push to the branch Railway watches (or click Deploy on each service).
2. `web` build: `npm ci`, `prisma generate`, `next build` (standalone). No variables are needed at build time: pages read the database on request. If a build ever fails on a database connection, a page is being prerendered and should be made dynamic. The build downloads the Google fonts used by `next/font`, so it needs network access (Railway builders have it).
3. `web` start logs, in order:
   - `db:migrate complete: migrations applied, app_user ready, RLS applied`
   - `[seed-if-missing] seeded demo organization ...` on the first deploy, then `demo organization present, skipping`
   - `[start] starting web server ...`
   The health check on `/login` allows 300 seconds so the first seed can finish.
4. `worker` start log: `[worker] started: queues=notify,reminders,workflow,maintenance demoReset=on email=resend`.
5. Generate a public domain for `web` (Settings > Networking), then set `AUTH_URL` and `APP_URL` to it and redeploy `web` and `worker`.

Deploy order does not matter: the worker only needs the tables, and web runs migrations on every start. If the worker starts first on a brand new database, its jobs fail and retry until the tables exist.

## 5. What the worker does

| Queue | Job | Source | Behavior |
| --- | --- | --- | --- |
| `notify` | `deliver` | `notify()` in `src/server/notify/notify.ts` | Claims the `OutboundMessage` atomically (`QUEUED` to `SENT`) before calling the provider, so it is sent at most once. Provider errors set `FAILED` with the error code. Addresses on reserved domains (`.example`, `.test`, `.invalid`, `.localhost`, used by the demo school) are never sent. |
| `reminders` | `appointment` | `bookAppointment()` (24h and 1h before) | One reminder per appointment and window (JobRun key `reminder:<id>:<window>`). Cancelled or past appointments are skipped. Meetings on wellbeing or safeguarding cases remind the host only. |
| `workflow` | `resume` | workflow `wait` nodes | Calls `advanceRun`, which is idempotent per step. |
| `maintenance` | `sweep` | every minute | Delivers `QUEUED` outbound rows older than one minute, sends due reminders whose job was lost, resumes elapsed `wait` steps. |
| `maintenance` | `retention` | daily 23:30 UTC | Applies each `RetentionPolicy` (see docs/decisions.md). One run per organization per day, summarized in an `AuditEvent` (`retention.sweep`). |
| `maintenance` | `demo-reset` | daily 22:00 UTC, only when `DEMO_MODE=true` | Restores the demo school (`runDemoResetCore`). |
| `maintenance` | `test.idempotent` | manual | Records one JobRun per key; a second run with the same key returns `duplicate`. |

The worker handles `SIGTERM` (Railway redeploys) by letting active jobs finish, then closing Redis and database connections.

## 6. Checks after a deploy

- `https://<domain>/login` loads, `/demo` lists the personas.
- Sign in as a persona, submit a request: the worker log shows `outbound <id> channel=EMAIL` (console provider) or Resend delivers it.
- Railway Postgres > Data: `JobRun` rows appear for reminders and the daily retention run.

## 7. Local equivalents

```
npm run db:migrate          # migrations + app_user + RLS
npm run db:seed             # seed the demo school
npm run worker              # worker (loads .env when present)
docker build -t school-os . # same image Railway builds
```
