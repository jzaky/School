# Deployment options, data residency and readiness

AEGIS runs the same code, database schema and row-level security in every deployment model. What
changes is who operates it, where it runs and who holds the keys.

## The four models

| Model | Operated by | Isolation | Installation files |
|---|---|---|---|
| Multi-tenant SaaS | AEGIS provider | Row-level security per organization in one database, a non-owner application role, secrets sealed per record | `deploy/k8s` or a managed platform (`docs/DEPLOYMENT.md`) |
| Single-tenant managed | AEGIS provider | Dedicated database, cache, storage and keys for one customer | `deploy/k8s`, one namespace and database per customer |
| Customer-controlled private cloud | Customer | Customer's own account and network | `deploy/k8s` or `deploy/docker-compose.yml` |
| On-premises | Customer | Customer's own hardware | `deploy/docker-compose.yml` or `deploy/systemd`; needs PostgreSQL 16 and Redis 7, and no internet access except for integrations the customer enables |

Status: the installation files exist and the Compose and Kubernetes layouts were written for these
models, but only the local development setup and the CI build are exercised in this repository. No
customer installation of any model has been carried out.

## The deployment manifest

`AEGIS_DEPLOYMENT_MANIFEST` (inline JSON or a file path) is the operator's declaration of where each
component runs, who the subprocessors are, how backups and recovery work and where secrets are kept.
Examples are in `deploy/profiles/`. Schema: `packages/core/src/deployment/manifest.ts`.

AEGIS cannot see a provider's data centres, so every fact from the manifest is labelled "declared".
An unset manifest means nothing is declared, never "compliant"; an invalid one is reported on the
page, not silently ignored.

## Data residency

The organization chooses its residency country in Settings (default `AE`). The Deployment page
(`/org/deployment`) allows a residency claim only when:

1. a hosting and a database component are declared;
2. every component that holds customer data, including each subprocessor, is declared in that country;
3. each of those was attested by a named person with a date in the last 365 days;
4. backups are declared in that country;
5. the installation is not a development installation.

Otherwise the page states "AEGIS makes no <country> data residency claim for this installation" and
lists what prevents it. Even when the claim is allowed, the statement says it is the operator's
declaration and not an independent audit. AEGIS does not advertise UAE data residency anywhere else,
and the example manifests carry no attestation, so none of them produces a claim.

Code: `packages/core/src/deployment/residency.ts`.

## Readiness checks

Each check says how it was established.

| Area | Check | Basis |
|---|---|---|
| Encryption in transit | Public web and API addresses use HTTPS | configuration |
| | The database connection uses TLS (read from `pg_stat_ssl` on the server) | live |
| | Redis uses `rediss://` | configuration |
| Encryption at rest | Every stored credential and webhook secret of the organization is an AES-256-GCM envelope bound to its record | live |
| | Database and backup storage encryption | declared |
| Secrets management | Master key present and 256 bits; evidence signing key present | configuration |
| | Where secrets are kept and how often they rotate | declared |
| Tenant isolation | Application role is not a superuser and cannot bypass row-level security | live |
| | Row-level security enabled on every table with an `org_id` column, none owned by the application role | live |
| Audit retention | Append-only triggers on the audit tables | live |
| | Retention period (organization setting, at least 365 days, default 2555) | configuration |
| Backup and disaster recovery | Schedule, encryption, last restore test (warning over 90 days) | declared |
| | Recovery point and time objectives, last exercise (warning over a year) | declared |
| Monitoring | OpenTelemetry export configured; System Health for the organization | configuration |
| Administrative access | Two-factor authentication required, and admins without it | live |
| | Number of platform administrators | live |

Code: `packages/core/src/deployment/readiness.ts` (`evaluateReadiness` is pure and unit tested;
`deploymentReadiness` gathers the live probes).

## Regional settings

Settings holds the organization's time zone (IANA name, validated), currency (ISO 4217), default
console language (English or Arabic), residency country and audit retention. Dates and times across
the console are shown in the organization's time zone. Amounts use Western digits in both languages,
as is usual in UAE business documents, so an approver reads the same figure either way. See
docs/LOCALIZATION.md for the language architecture.

## What this phase does not do

- It does not deploy anything. Production deployment needs the owner's explicit approval.
- It does not verify a hosting provider's region or certifications.
- It does not make AEGIS compliant with any regulation; it shows the evidence an operator needs.
