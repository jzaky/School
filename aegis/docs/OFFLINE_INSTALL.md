# Offline installation (air-gapped and on-premises)

AEGIS can run entirely inside an entity's own network with no internet access. The decision engine
(allow, approval, block), approvals, the evidence ledger and the audit workspace are rule-based and run
locally. AEGIS does not call an outside AI model. Every feature that talks to an outside service is
off by default and only works when the entity enables it and its network allows it:

| Feature | Outside service | Default |
|---|---|---|
| Software advisories | OSV.dev (`AEGIS_OSV_URL` can point at an internal mirror) | Off per organization |
| Email copies of alerts | Resend | Off (`AEGIS_EMAIL_NOTIFICATIONS=false`) |
| Microsoft Entra ID sync and sign-in | Microsoft | Off until configured |
| Azure Key Vault for the master key | Microsoft | Off; the local key is used |
| Payment and trading connectors | Stripe, Alpaca | Off until configured |
| Telemetry export | The entity's own OpenTelemetry collector | Off (`OTEL_EXPORTER_OTLP_ENDPOINT` empty) |

## What the bundle contains

One archive, `aegis-offline-<version>.tar`, built on a machine with internet access by
`scripts/offline-bundle.sh`:

- `images.tar.gz`: the AEGIS api, worker, web console and migration images, plus PostgreSQL 16, Redis 7
  and Caddy 2. Nothing is pulled or built on the target machine.
- `docker-compose.yml`, `Caddyfile`, `postgres-init.sql`, `install.sh`, `VERSION`
- `SHA256SUMS`: `install.sh` refuses to install if any file does not match.

No secrets are in the bundle. `install.sh` generates the database passwords, the master key, the
session secret and the evidence signing key on the target machine and writes them to `.env` (mode 600).

## Requirements on the target machine

- Linux server with Docker Engine and the compose plugin, `openssl`, `curl`, `sha256sum`
- 4 CPU cores, 8 GB memory and 40 GB disk for a pilot
- A host name users will type, for example `aegis.entity.local`, in the entity's internal DNS

## Install

```bash
tar xf aegis-offline-<version>.tar
cd aegis-offline-<version>
./install.sh --host aegis.entity.local          # add --demo for the synthetic demo tenant
```

The installer verifies the bundle, loads the images, writes `.env`, starts AEGIS, waits until the
console and gateway answer, and finally runs `verify-offline` (below).

- Console: `https://aegis.entity.local` (and `http://localhost:3000` on the server itself)
- Gateway for AI agents: `https://aegis.entity.local:8443` (and `http://localhost:4000`)

### Certificates

By default Caddy issues a certificate from its own internal authority. Browsers warn until the
entity trusts that root, which the installer prints how to export. To use the entity's own certificate
instead, place `cert.pem` and `key.pem` in `certs/` before running `install.sh`.

## The network boundary, and how to prove it

The compose file puts the database, cache, api, worker and console on an internal Docker network
(`core`) that has no route out. Only the Caddy proxy is also on the published network (`edge`), so
people can reach AEGIS while AEGIS cannot reach out.

```bash
./install.sh verify-offline
```

opens a connection from each AEGIS container to a public address and fails if any succeeds. The
entity's own firewall remains the primary control; this check shows that AEGIS does not depend on
outbound access.

Enabling an outside feature from the table above needs a deliberate change to that boundary (for
example, an internal OSV mirror reachable on `core`). Record the change in the deployment manifest
(`AEGIS_DEPLOYMENT_MANIFEST`, see `docs/DEPLOYMENT_OPTIONS.md`).

## Operate

```bash
./install.sh check      # service status and health
./install.sh logs       # recent logs
./install.sh stop       # stop; data is kept in Docker volumes
./install.sh start
```

Backups: see `docs/BACKUP_RECOVERY.md`. The PostgreSQL volume `aegis_pgdata` and the uploads volume
`aegis_uploads` hold all state; `.env` holds the keys and must be backed up separately and securely.

## Upgrade

Build a new bundle, copy it over, extract it next to the old one, copy the old `.env` into the new
folder and run `./install.sh` there. Migrations run automatically before the services start.

## Status

Verified on 2026-10-29 in a Linux build sandbox, from a freshly built bundle with every AEGIS,
PostgreSQL and Caddy image removed from the machine first:

- `install.sh --demo` verified the checksums, loaded the images, generated `.env`, ran migrations,
  started every service and seeded the demo tenant, with no image pulled from a registry.
- The console and gateway answered over HTTPS for the configured host name (Caddy internal
  certificate) and over HTTP on the server itself; a browser signed in to the console over HTTPS.
- `verify-offline` reported no route out from the api, worker and web containers. The sandbox's own
  network was already restricted, so this run cannot by itself distinguish the internal network from
  the sandbox; the guarantee comes from the `internal: true` network in `docker-compose.yml`.

The test found and fixed two defects that affected every Docker installation: migrations called
`npx`, which the images no longer contain, and the migration step did not apply the configured
application database password. No customer installation has been carried out yet.
