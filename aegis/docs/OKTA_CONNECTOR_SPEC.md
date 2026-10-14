# Okta connector: specification (not built)

Okta is specified here so it can be built quickly when the first pilot needs it. Until then, Okta System Log exports can be imported as files (format `okta_system_log_json`, `docs/SHADOW_AI.md`).

## Scope

Read SSO events from the Okta System Log and feed them to Shadow AI discovery with "confirmed" confidence, the same way the Entra connector does.

## API

- `GET https://{yourOktaDomain}/api/v1/logs`
- **Filter:** `filter=eventType eq "user.authentication.sso"`. Optionally also `app.oauth2.as.consent.grant` for consents, mapped to a separate `okta_consent` source.
- **Time range:** `since` and `until` (ISO 8601), `limit` up to 1,000, `sortOrder=ASCENDING`.
- **Paging:** follow the `Link: <...>; rel="next"` header. The System Log also supports polling: with `since` and no `until`, the `next` link keeps returning new events. Use it for continuous sync.
- **Fields used:**
  - `published`;
  - `actor.alternateId` (the user);
  - `target[]` where `type` is `AppInstance` (`displayName`);
  - `outcome.result` (only `SUCCESS`);
  - `client.ipAddress`, stored as a fingerprint only.

## Authentication and least privilege

- **Preferred:** an OAuth 2.0 service app with a private key JWT (client credentials) and the scope `okta.logs.read` only. Okta supports scoped OAuth for its management API. Store the private key in the AEGIS vault.
- **Fallback:** an API token from a read-only administrator. It is less preferred because API tokens carry the creating administrator's permissions and expire after 30 days of inactivity.

## Sync design (same as Entra)

- A cursor per feed, held in the integration settings.
- Polling with the `next` link from `since=cursor`. The cursor advances to the `published` value of the last event stored, and only after the batch is stored.
- A lag of a few minutes for late events.
- Retries:
  - HTTP 429: honour `X-Rate-Limit-Reset` (epoch seconds), capped, or back off;
  - 5xx and network errors: back off, up to five attempts.
- Follow `next` links only on the configured Okta domain.
- Dedupe keys on every signal. Idempotent runs. A worker job every 15 minutes. Metrics with `connector="okta"`. A console panel like Entra's.

## Tests to write with it

A stand-in Okta server following the documented response shapes, covering:
- `Link` header paging;
- polling;
- `X-Rate-Limit-Reset` back-off;
- an expired or invalid token;
- a missing scope (403 `E0000006`), explained;
- only AI matches kept;
- idempotent re-runs.

Validate with a free Okta developer org before a pilot uses it.

## Effort

About two days, reusing the Entra connector's window, retry, state and console code.
