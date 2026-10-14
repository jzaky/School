# Integrations: marketplace and event destinations

Phase 8 of the enterprise expansion. Status: implemented and tested in this repository against local stand-ins. **No integration has been verified by AEGIS against a real vendor service.** Each one is built from the provider's public API documentation. An organization's own successful test is shown in its console as "verified in your organization", with the date.

## Marketplace

Control, Marketplace in the console lists every integration with one of three statuses.

| Status | Meaning |
|---|---|
| Built to the public API, tested against a local stand-in | Implemented from public documentation and exercised against a local server that imitates the provider. Not yet verified against the real service. |
| Tested in this repository | Runs inside AEGIS or the customer's code (SDKs, MCP gateway); no external service involved. |
| Simulator for demos | Nothing leaves AEGIS. |

| Integration | Category | Status | What the customer supplies |
|---|---|---|---|
| Stripe refunds (test mode) | Actions | Stand-in tested (`docs/CONNECTORS.md`) | A Stripe test-mode key |
| Alpaca paper trading | Actions | Stand-in tested | An Alpaca paper key |
| Demo systems | Actions | Simulator | Nothing |
| Single sign-on (OIDC), SAML 2.0, SCIM 2.0 | Identity | Stand-in tested | An application in the identity provider; a SCIM API key |
| Signed webhook, Slack, Microsoft Teams, Splunk HEC, Datadog Logs, ServiceNow incidents | Event destinations | Stand-in tested | See below |
| TypeScript SDK and framework adapters, Python SDK, MCP gateway | Agent frameworks | Tested in this repository | An agent API key |

Vendor names describe compatibility only; AEGIS is not affiliated with or endorsed by them.

**Shown as "verified in your organization":**
- event destinations, after a successful test event;
- connectors, after a passing connection test.

**Not built, and not shown in the console:**
- cloud inventory connectors for AWS, Azure and GCP;
- Salesforce, Jira and PagerDuty;
- interactive approvals inside Slack or Teams (this needs a public callback URL and request-signature verification for each platform).

## Event destinations

Control, Event Destinations sends governance events to the tools a team already watches.

### Events

| Category | Evidence types |
|---|---|
| security | `security_event.created`, `incident.created`, `incident.status_changed` |
| approvals | `approval.requested`, `approval.expired` |
| decisions | `gateway.decision.deny`, `gateway.decision.quarantine`, `gateway.decision.error` |
| agents | `agent.suspended`, `agent.revoked`, autonomy changes, `access.requested` |
| monitoring | `monitoring.alert_raised` |
| governance | `policy.activated`, `model.approved`, `model.retired`, enforcement changes, `regulatory.change_recorded`, `data.deletion_requested` |
| lab | `lab.run_completed`, `lab.run_failed` |
| audit | `report.generated`, `assessment.completed` |

A destination can also set a lowest severity for security events.

**Never sent:** events about Attack Simulation Lab agents. They stay on the evidence record.

### How delivery works

1. **Source.** The evidence ledger is the source. Each destination keeps a cursor (the last evidence sequence number it considered); a new destination starts at the current end, so history is not replayed.
2. **Dispatch.** The worker runs `events.dispatch` every minute. For each enabled destination it:
   - holds a two-minute claim, so two workers never deliver for it at once;
   - records a delivery row for each new matching event (unique per destination and event);
   - sends due deliveries outside any database transaction.
3. **Retries.**
   - Server errors, timeouts and HTTP 429 retry after 1, 5 and 15 minutes, 1 hour and 6 hours, then fail.
   - Other 4xx responses, redirects and unsafe addresses fail at once.
   - Failed deliveries stay listed; a person can retry them.
4. **Idempotency.** AEGIS sends each (destination, event) pair as one delivery. Receivers can deduplicate on the AEGIS event id: it is `X-AEGIS-Delivery` and the body `id` for webhooks, and `correlation_id` for ServiceNow.

### Formats

| Kind | Request |
|---|---|
| Signed webhook | `POST` to the URL with the full event envelope as JSON. Headers: `X-AEGIS-Event`, `X-AEGIS-Delivery`, `X-AEGIS-Timestamp`, and `X-AEGIS-Signature` (hex HMAC-SHA-256 of `<timestamp>.<raw body>` with the signing secret AEGIS generates and shows once). Reject timestamps older than five minutes. |
| Slack | Incoming webhook: `text` and `blocks` (a title, a link to the console, the event type and time) |
| Microsoft Teams | Workflow or incoming webhook: a `message` with one Adaptive Card 1.4 attachment and an "Open in AEGIS" action |
| Splunk HEC | `POST <base>/services/collector/event` with `Authorization: Splunk <token>`, `sourcetype` `aegis:event`, optional `index`, the envelope as `event` |
| Datadog Logs | `POST https://http-intake.logs.<site>/api/v2/logs` with `DD-API-KEY`, `ddsource` and `service` `aegis`, tags by category and type, the envelope under `aegis` |
| ServiceNow | `POST <instance>/api/now/table/incident` with Basic authentication: `short_description`, `description`, urgency and impact from severity, `correlation_id` (the event id) and `correlation_display` `AEGIS` |

**Chat messages** carry a title and a link only. **Machine destinations** receive the envelope, which includes the evidence payload. Evidence payloads are designed not to hold personal data; request parameters appear as hashes.

### Security

- **Destination URLs** must be HTTPS. They must not carry credentials, and must resolve only to public addresses. Refused: loopback, private ranges, link-local and cloud metadata (169.254.169.254), CGNAT, multicast, IPv6 unique-local and link-local, and `localhost`, `.local` and `.internal` names. The check runs on save and again before every delivery. Redirects are never followed.
- **`AEGIS_ALLOW_PRIVATE_DESTINATIONS=true`** lifts the address check for local tests. Production processes refuse to start with it set.
- **Secrets** (Slack and Teams webhook URLs, tokens, API keys, passwords) are encrypted with the master key, bound to the organization and kind. They are never returned by the API or the console, which shows only the last four characters. Replacing a credential clears the verified mark.
- **Who can manage:** reads need `integrations:read`; adding, changing, testing and retrying need `integrations:write`, by a person. Every API route under `/v1/integrations` refuses API keys, reads included. Each change is on the evidence record.

**Residual risk:** DNS can change between the check and the connection (DNS rebinding). The pre-delivery check narrows the window but does not pin the resolved address. Pinning is listed for Phase 13.

## Demo data

Two destinations, both paused, never tested, and so never marked verified:
- Slack #ai-governance (demo);
- Splunk SOC (demo).

Their credentials are placeholders.

## Tests

| Suite | Tests |
|---|---|
| Core | `destinations.test.ts` (8) |
| API | `self-governance.test.ts` (agent keys refused) |
| Browser | `integrations-marketplace.spec.ts` (3) |

**The core tests cover:**
- the address checks;
- every request format against the providers' published shapes;
- an end-to-end dispatch over a real HTTP socket to a local server: one delivery per event per destination, severity filtering, lab events excluded, no duplicates on a second pass, retry and permanent failure, manual retry, test events marking a destination verified, and paused destinations receiving nothing;
- secrets never appearing in listings or evidence.

## To verify for real

Each destination needs only its own credential. Add it in the console and send a test event. A successful test marks it verified in that organization, which is the evidence for a pilot.

The Stripe and Alpaca sandbox check scripts are described in `docs/CONNECTORS.md`.
