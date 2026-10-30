# Microsoft Entra ID connector

**Status:** implemented and tested against a local stand-in for the Microsoft identity platform and Microsoft Graph, with 8 tests. It has not yet run against a real tenant. That needs an app registration, which only a tenant administrator can create and consent to (see Validating against a real tenant).

## What it reads

| Feed | Microsoft Graph endpoint | Used for |
|---|---|---|
| Sign-ins | `GET /v1.0/auditLogs/signIns` | Which work accounts signed in to which applications |
| App consents | `GET /v1.0/auditLogs/directoryAudits`, filtered to activity names starting with "Consent to application" | Who granted an application access to organizational data |

Both feed Shadow AI discovery (`docs/SHADOW_AI.md`):

- Only entries that match an AI application are stored. Everything else is discarded as it is read, so AEGIS keeps no record of non-AI sign-ins.
- **Members** are linked to their AEGIS account. **Other identities** (guests, contractors) are stored only as keyed fingerprints.
- **Failed** sign-ins are skipped.
- Sign-ins and consents are recorded with **"confirmed"** confidence: an authenticated sign-in, or a recorded consent.

Neither feed shows what anyone typed into an application, and AEGIS never claims it does.

## Least privilege

The connector needs two **application** permissions on Microsoft Graph:
- **AuditLog.Read.All**
- **Directory.Read.All**

These are what Microsoft's reference for listing sign-ins names as least privileged. They are read-only, and the connector writes nothing to the tenant.

**Licence note.** Some tenants cannot read sign-in logs through the API. Microsoft returns `Authentication_RequestFromNonPremiumTenantOrB2CTenant`, which indicates a premium Entra ID licence is needed for that tenant. The connector:
- recognizes this error and says so in plain words;
- keeps reading app consents.

Microsoft's own documentation on the licence requirement is not consistent. Check the tenant's licence with Microsoft rather than relying on this note.

## Setting it up (a tenant administrator, about 10 minutes)

1. In the Microsoft Entra admin center, open **App registrations** and choose **New registration**.
   - Name it, for example, "AEGIS Shadow AI (read-only)".
   - Choose single tenant. No redirect URI is needed.
2. On the new app's page, note:
   - the **Application (client) ID**;
   - the **Directory (tenant) ID**.
3. Grant the permissions:
   1. Open **API permissions** and choose **Add a permission**.
   2. Choose **Microsoft Graph**, then **Application permissions**.
   3. Add **AuditLog.Read.All** and **Directory.Read.All**.
   4. Choose **Grant admin consent**.
4. Create a secret:
   1. Open **Certificates & secrets** and choose **New client secret**.
   2. Set a lifetime your policy allows. AEGIS records 180 days for rotation reminders.
   3. Copy the **Value** once.
5. Connect AEGIS:
   1. In the AEGIS console, open **Security**, then **Shadow AI**, then the **Microsoft Entra ID** panel.
   2. Paste the tenant ID, the client ID and the secret value. The secret goes straight into the AEGIS credential vault, is never shown again and is never logged.
   3. Choose **Test connection**. It requests a token and reads one record from each feed.
   4. Choose **Sync now**, or wait for the worker, which syncs every 15 minutes.

Do not paste the secret into chats, tickets or email. To rotate it, create a new secret in Entra and press **Update connection** with it. **Disconnect** revokes the stored secret at once.

## How a sync works

- **Token.** Client credentials flow against `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with scope `https://graph.microsoft.com/.default`.
  - The token is kept in memory only and refreshed five minutes before it expires.
  - On a 401 the token is refreshed once and the request retried.
- **Windows, not ordering.** Each feed has a cursor. A run reads windows of up to six hours, from the cursor forward, filtered with `ge` and `lt` on the timestamp.
  - A window is read completely, following every `@odata.nextLink`, before the cursor moves to its end. So the order Graph returns results in does not matter.
  - A window with more than 20 pages of 500 records is halved, down to five minutes.
  - If even a five-minute window is larger than that, the records read so far are kept and the skipped remainder is reported in the status. It is never silently dropped.
- **Lag.** The newest 15 minutes are left for the next run, because Microsoft can record sign-ins with a delay. A sign-in delayed by more than 15 minutes can be missed; this is a known limitation.
- **First run.** The first run reads back seven days by default. The backfill can be set from 1 to 30 days; Microsoft keeps sign-in logs for a limited time.
- **Retries.**
  - HTTP 429, 502, 503 and 504 honour `Retry-After`, capped at 60 seconds, or back off exponentially, up to five attempts.
  - Network errors back off the same way.
  - Other errors stop that feed and appear in the status in plain language.
- **Safety.**
  - `nextLink` is followed only on the Graph host the run started from.
  - Requests use AEGIS's DNS-pinned HTTPS client.
  - Custom endpoints (sovereign clouds) must use HTTPS.
- **Idempotent.** The cursor moves only after a window is stored, and every stored signal has a dedupe key. A crash or a repeated run reads one window again without creating duplicates.
- **Worker.** The `entra.sync` job runs every 15 minutes for each organization with an active connection.

## Monitoring

| Metric | Labels |
|---|---|
| `aegis_connector_syncs_total` | `connector="entra"`, `outcome` = ok, partial or failed |
| `aegis_connector_records_total` | `kind` = signIns or consents |
| `aegis_connector_retries_total` | `reason` = 429, 503, network and so on |

The console panel shows:
- the last successful sync;
- how far the connector has read;
- the last run's counts, including whether more remains;
- the last error in plain words.

Evidence events record:
- connecting (`connector.entra.connected`);
- testing (`connector.entra.tested`);
- each sync, with counts and no identities (`connector.entra.synced`);
- disconnecting (`connector.entra.disconnected`).

## Validating against a real tenant

On a machine with the monorepo and a migrated local database:

```
export AEGIS_VALIDATE_ENTRA_TENANT_ID=<directory id>
export AEGIS_VALIDATE_ENTRA_CLIENT_ID=<application id>
read -rs AEGIS_VALIDATE_ENTRA_CLIENT_SECRET && export AEGIS_VALIDATE_ENTRA_CLIENT_SECRET
npx tsx scripts/validate/run.mts entra
```

The run:
1. creates a temporary organization;
2. tests the connection;
3. syncs one day;
4. prints counts only;
5. deletes the organization and everything it read;
6. writes a validation record that contains no identities and no secret.

Use a test tenant, or get the tenant owner's written agreement first: sign-in logs are personal data about employees.

## Tests

`packages/core/tests/entra-connector.test.ts` (8) runs against a local stand-in that follows Microsoft's documented request and response shapes. It covers:
- a wrong secret, explained;
- a connection test reading both feeds, with no secret in the status;
- paging with `nextLink`;
- only AI matches kept, with guests fingerprinted;
- failed sign-ins skipped;
- the 15-minute lag;
- the cursor;
- incremental and repeated runs adding nothing;
- 429 retries with `Retry-After`;
- token refresh after an expired token;
- a tenant without sign-in log access still syncing consents and saying why;
- the permission error explained;
- a viewer refused;
- disconnect revoking the secret.

These tests show how AEGIS behaves; they show nothing about Microsoft's service.

## Not built

- Certificate credentials instead of a client secret.
- Matching applications by their application ID instead of their display name.
- Risky sign-ins and Defender for Cloud Apps discovery.
- Delta queries.
- Okta: see `docs/OKTA_CONNECTOR_SPEC.md`. It is specified, not built.
