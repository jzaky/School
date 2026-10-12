# Connectors: real providers in their documented test mode

AEGIS executes allowed or approved actions through downstream systems behind one interface,
`DownstreamSystem` (`packages/core/src/gateway/simulators.ts`). The demonstrations use in-process
simulated systems. A connector implements the same interface against a real provider in that
provider's sandbox or test mode. The gateway, policies, approvals, grants, evidence and console do
not change; the console labels each integration `Simulated` or `Sandbox` from `settings.kind`.

This document covers the first connector: Stripe refunds in test mode
(`packages/core/src/gateway/connectors/stripe.ts`, system key `stripe-test`).

## Why Stripe test mode

Stripe test mode is a free, documented sandbox with everything the refund journey needs:

- Test payment methods (for example `pm_card_visa`) that confirm instantly, so there is always a
  payment to refund against.
- A refunds API: `POST /v1/refunds` with `payment_intent` (or `charge`), `amount` in minor units,
  `reason` and free-form `metadata`.
- Native request idempotency through the `Idempotency-Key` header. Stripe saves the result of the
  first request made with a key and returns that same result for a retry with the same key within a
  24 hour window; a reused key with a different body is refused with an `idempotency_error`.
- Lookups by id (`GET /v1/refunds/{id}`) and by payment intent
  (`GET /v1/refunds?payment_intent=...`), which is what reconciliation needs.
- `GET /v1/balance` as a cheap authenticated call for a connection check; the response carries
  `livemode`, which the connector uses to refuse live mode.

Alternatives considered and rejected for a first connector: PayPal sandbox (OAuth token flow and
merchant setup before the first call), Adyen test (merchant account approval), Shopify (a dev store
plus coupling refunds to orders). They remain candidates for later connectors.

## Money safety: live keys are refused

The connector only ever acts with a Stripe test-mode key. Secret keys in test mode start with
`sk_test_`, restricted keys with `rk_test_`. Two independent gates enforce this:

1. At store time. `storeCredential` asks the integration's downstream system to validate the secret
   (`validateCredential`). For `stripe-test` any other key is refused with: "Only Stripe test-mode
   keys (sk_test_ or rk_test_) can be stored. Live keys are refused so no real money can move." The
   console surfaces that message in the credential dialog and nothing is written to the vault.
2. At execution time. Before any request leaves the gateway the connector decrypts the credential
   and checks the prefix again. A key that reached the vault by another path is refused with the
   same message, the receipt is `failed`, and no HTTP call is made. The connection test applies the
   same check and additionally refuses a response that says `livemode: true`.

Credentials live in the AEGIS vault (encrypted with the organization master key), never in source
control or environment files. The sandbox check script reads the key from an environment variable
only to store it in the vault.

## Tool contract

Tool key `refund-payment`, action `execute`, bound to the `stripe-test` integration.

| Parameter | Type | Notes |
| --- | --- | --- |
| `paymentIntentId` | string | Stripe PaymentIntent id, `pi_...` |
| `amount` | number | Major units, for example `12.50`. Must be positive. |
| `currency` | string | ISO 4217 code. The demo tool schema allows `AED`, `USD`, `EUR`, `GBP`; the demo policy allows AED only. |
| `orderId` | string, optional | Carried to Stripe as `metadata.aegis_order_id`; also the duplicate-reference key for policies. |
| `customerId` | string, optional | Internal reference. Not sent to Stripe. |
| `reason` | enum, optional | `duplicate`, `fraudulent` or `requested_by_customer` (Stripe's values). |

Amounts are converted to Stripe minor units per currency: two decimals for most currencies, whole
units for zero-decimal currencies (JPY, KRW and the others Stripe lists), three decimals for BHD, JOD,
KWD, OMR and TND with the multiple-of-ten rule. Amounts with more precision than the currency allows
are rejected before anything is sent.

The request to Stripe is `POST /v1/refunds`, form encoded, with headers `Authorization: Bearer <key>`,
`Idempotency-Key: aegis:<actionRequestId>` and `Stripe-Version: 2024-06-20` (pinned), and metadata
`aegis_request_id`, `aegis_org_id`, `aegis_correlation_id` and `aegis_order_id`. The base URL is
`integration.settings.baseUrl`, else the `STRIPE_API_BASE` environment variable, else
`https://api.stripe.com`; the tests point it at a local fake. Every call has a 10 second timeout.

The connector also verifies that the consumed execution grant binds exactly the parameters it was
handed (hash check), as the simulators do. A mismatch is a `failed` receipt with no HTTP call.

## Outcome semantics

The gateway records one of three outcomes per attempt:

| Outcome | When the connector returns it | What the gateway does |
| --- | --- | --- |
| `failed` | Nothing happened downstream: parameter validation failed, the key was refused, the grant did not bind the parameters, or Stripe answered with a definitive 4xx (`charge_already_refunded`, `resource_missing`, `idempotency_error`, authentication errors) | Request `failed`, final receipt, evidence `gateway.execution_failed` |
| `unknown` | The request may have reached Stripe but no definitive answer came back: timeout, connection reset, malformed body, HTTP 5xx, HTTP 429 | Request stays `executing`, receipt `unknown`, a reconcile job is scheduled; nothing is retried blindly |
| `succeeded` | Stripe returned the refund object | Request `executed`; the receipt reference is the Stripe refund id `re_...`, the summary carries `amountMinor`, `currency`, `refundStatus`, `paymentIntent`, `livemode` |

The connector never throws after sending; a throw would be treated as `unknown` by the gateway anyway.
It never holds a tenant transaction open across an HTTP call: settings and the credential are read in
a short transaction before the call.

## Idempotency and reconciliation

The gateway's downstream idempotency key is `aegis:<actionRequestId>`, stable for the life of the
request across every attempt. Stripe enforces one result per key, so the gateway and Stripe agree on
"one request, at most one refund".

`reconcile` runs when an attempt ended `unknown` (and from the sweep for requests left `executing`):

1. List the payment intent's refunds (`GET /v1/refunds?payment_intent=...&limit=100`, paginated) and
   look for `metadata.aegis_request_id == actionRequestId`. Found: `succeeded` with that refund's id,
   status and amount. Payment intent missing: `failed` (no refund can exist). Lookup failed
   (transport, 5xx, auth): `unknown`, try again later.
2. Not found and Stripe had answered the original attempt (the `unknown` receipt records
   `stripe.responded: true`, for example a 500): Stripe's answer plus the empty list are definitive.
   `failed`, nothing was created.
3. Not found and no answer was ever received (timeout, reset, or a crash between phases) and the
   key is still fresh (less than 24 hours since the grant was consumed): replay the original
   `POST /v1/refunds` with the same `Idempotency-Key` and the same body. This is safe because Stripe
   returns the saved result for a reused key and refuses a reused key with a different body, so at
   most one refund can exist for the request whichever side the original got to. A 2xx is
   `succeeded` (the original refund if it existed, otherwise a single new one, never both), a
   definitive 4xx is `failed`, an `idempotency_error` on replay is `unknown` for a human to look at,
   transport or 5xx is `unknown`.
4. Not found, no answer, key older than 24 hours: the list is the authority; `failed`.

Receipts are reconciled with Stripe's records in the test suite: for every succeeded receipt the
reference equals a refund Stripe holds, the minor-unit amount matches, and the refund's metadata
names the request; and every refund with AEGIS metadata has a receipt.

## Connection test

`testIntegrationConnection` (core) runs the system's `testConnection`, records `lastHealthOk` on the
integration and writes evidence `integration.connection_tested`. For Stripe it calls
`GET /v1/balance`; ok means "Stripe test mode reachable, livemode=false". It refuses a non-test key
before calling and refuses a `livemode: true` answer. The console exposes it as "Test connection"
on the integration page; the network call runs outside any tenant transaction.

## Verified locally against a fake Stripe

`packages/core/tests/fixtures/fake-stripe.ts` is a small Node HTTP server with Stripe-shaped JSON:
balance, refunds create/list/get, idempotency (same key returns the saved result, same key with a
different body returns `400 idempotency_error`), `charge_already_refunded` when a refund would exceed
the payment intent, `404 resource_missing` for unknown payment intents, and failure injection (lost
response after creating the refund, connection dropped before processing, HTTP 500).

`packages/core/tests/stripe-connector.test.ts` drives the real gateway, approvals service and
connector against it (20 tests):

- small refund executes once; Stripe holds exactly one refund with the right minor units and metadata;
  the receipt reference equals the refund id; headers and form body are as specified
- zero-decimal currency sent as whole units
- larger refund waits for a named approver and executes exactly once on approval; a second approval is refused
- prohibited amount denied with no HTTP call
- duplicate refund for the same payment intent denied before Stripe
- expired approval refused
- modified parameters rejected at the gateway (same idempotency key, different amount), at the grant
  binding (no HTTP call), and by Stripe's `idempotency_error`; a true replay returns the original refund
- emergency pause blocks approval of an outstanding request; resuming lets it execute exactly once
- lost response: receipt `unknown`, request `executing`, reconciled to `executed` with the Stripe
  refund id while Stripe still holds exactly one refund
- connection dropped before processing: reconciled through the idempotent replay, exactly one refund
- HTTP 500: `unknown`, then reconciled to `failed` with no refund in Stripe
- definitive 4xx answers (`charge_already_refunded`, `resource_missing`) are `failed`, not `unknown`
- live and malformed keys refused at store time; a test restricted key accepted
- a live key planted in the vault is refused at execution time with no HTTP call
- connection test passes against the fake, records health and evidence, fails when the fake is
  stopped, and is refused without `integrations:write`
- a disabled integration denies at the gateway before any Stripe call
- every succeeded receipt matches a refund Stripe holds, amount for amount, and the evidence chain verifies

Run them with:

```
cd packages/core && npx vitest run tests/stripe-connector.test.ts
```

## Not yet verified against real Stripe

AEGIS has not been run against Stripe's real test-mode API. The build environment for this
repository cannot reach `api.stripe.com`. What the fake cannot prove: Stripe's exact error codes and
messages for every edge, pagination of real lists, API version behaviour, latency, and that a
PaymentIntent confirmed with `pm_card_visa` refunds as expected.

`scripts/stripe-sandbox-check.mts` performs the same journey against real Stripe test mode and
shares the connector's HTTP and amount code. When a test key is available, from the repository root
with the database seeded (`pnpm db:seed`):

```
STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/stripe-sandbox-check.mts
```

It refuses to run with anything but an `sk_test_` or `rk_test_` key, creates and confirms a
PaymentIntent with `pm_card_visa`, stores the key in the demo tenant's vault for `stripe-test`,
enables the integration, submits a small autonomous refund, a tier-two refund approved by the demo
approver, a duplicate (same idempotency key, must not refund twice) and an over-limit attempt (must
be denied before any Stripe call), then lists the refunds from Stripe and reconciles them against
AEGIS receipts, printing a table and exiting non-zero on any mismatch. Without the variable it prints
what it would do and exits 0.

## Demo tenant

The seed registers `stripe-test` ("Stripe (test mode)", type `payments`, `settings.kind: sandbox`)
disabled with the reason "No credential connected" and no credential, the `refund-payment` tool
bound to it and granted to `support-refund-agent`, and adds `refund-payment` to the
`refund-authority` policy. The five simulated integrations carry `settings.kind: simulated`. An
operator connects a test key on the integration page, runs "Test connection", then enables the
integration.
