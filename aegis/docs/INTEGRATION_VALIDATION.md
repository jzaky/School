# Integration validation

This document separates three kinds of evidence:

- **External, verified:** a run of AEGIS code against the provider's real API, recorded in `docs/validation/results/`.
- **Local stand-in:** automated tests against a local server that imitates the provider. This proves AEGIS's own logic, not the provider's behaviour.
- **Not run:** the check exists but has not been run, usually because it needs a credential that only you can create.

## Matrix (16 October 2026)

| Integration | Needs a credential | External, verified | Local stand-in | Record |
|---|---|---|---|---|
| OSV.dev (vulnerabilities) | No, public API | **Yes**, 5 of 5 checks | Yes (`software-security.test.ts`) | `docs/validation/results/osv-2026-10-14-12-03-27.json` |
| Stripe (refunds, test mode) | Yes, a test-mode secret key | Not run | Yes (`stripe-connector.test.ts`, fake Stripe server) | none yet |
| Alpaca (paper trading) | Yes, a paper-account key pair | Not run | Yes (`trading.test.ts`, fake Alpaca server) | none yet |
| AI provider through the AI gateway | Yes, a provider API key | Not run | Yes (`ai-gateway.test.ts`, a recording stand-in) | none yet |
| Resend (email copies of notifications) | Yes, a Resend API key and a sender it accepts | Not run | Yes (`notification-email.test.ts`, stand-in Resend API; the validator was also run against a local stand-in) | none yet; run `npx tsx scripts/validate/run.mts resend` |
| Slack (event destination) | Yes, an incoming webhook URL | Not run | Yes (`destinations.test.ts`; the validator was also run against a local stand-in) | none yet; run `npx tsx scripts/validate/run.mts slack` |
| Microsoft Entra ID (sign-ins and app consents) | Yes, an app registration in a test tenant, admin consent | Not run | Yes (`entra-connector.test.ts`, stand-in Microsoft identity platform and Graph) | none yet; run `npx tsx scripts/validate/run.mts entra` (docs/ENTRA_CONNECTOR.md) |

All four providers answered from the build environment: OSV.dev with 200, and Stripe, Alpaca and OpenAI with 401 because no key was sent. So the remaining runs are blocked only by credentials, not by network access.

### How the OSV.dev run was carried

The build environment has no direct internet access from Node. The OSV.dev request therefore travelled through `fetch` and the environment's HTTPS proxy, not through AEGIS's own sender, which pins DNS. Everything after the HTTP response is the production code path:
- parsing;
- severity;
- fixed versions;
- the guarantee that internal package names are never sent, which was checked by recording every request.

On a normal server (for example the staging VM) the same script uses AEGIS's own sender. Run `AEGIS_VALIDATE_DIRECT=1 npx tsx scripts/validate/osv.mts` there to record that path too.

**Results:**

| Package | Advisories found |
|---|---|
| lodash 4.17.20 | 5, including GHSA-35jh-r3h4-6jhm (high, fixed in 4.17.21) |
| minimist 1.2.5 | GHSA-xvch-5gv4-984h |
| Django 3.2.0 (PyPI) | 66 |
| `@aegis-internal/secret-lib` | Never sent |

## Running a check

Run the checks on a machine you control, such as your laptop or the staging VM, not in a chat. They need:
- the monorepo installed (`pnpm install`);
- the `.env` file;
- the local database migrated and seeded.

Type each key into the shell so it stays out of your shell history and out of any conversation:

```
read -rs STRIPE_TEST_SECRET_KEY && export STRIPE_TEST_SECRET_KEY
npx tsx scripts/validate/run.mts stripe
```

Each run writes one JSON record under `docs/validation/results/`. The runner refuses to write a record that looks like it contains a key. A run without the key records "not run", never a pass. A run against a localhost or private address records "local simulation", never "verified". Commit the records you want to keep as evidence.

To clear a key afterwards: `unset STRIPE_TEST_SECRET_KEY`.

## Getting each test credential

Never paste a key into a chat, a ticket or a commit. Every key below works only in a test, sandbox or paper environment.

### Stripe, test mode (free)

1. Sign in at dashboard.stripe.com. A new account is in test mode by default; otherwise turn on the **Test mode** switch.
2. Go to **Developers**, then **API keys**.
   - **Simplest:** reveal the **Secret key**. It starts with `sk_test_`.
   - **Better:** choose **Create restricted key** with:
     - PaymentIntents: Write;
     - Refunds: Write;
     - everything else: None.

     It starts with `rk_test_`.
3. On your machine: `read -rs STRIPE_TEST_SECRET_KEY && export STRIPE_TEST_SECRET_KEY`, then `npx tsx scripts/validate/run.mts stripe`.

AEGIS refuses `sk_live_` and `rk_live_` keys before making any call. The script then:
1. creates a test payment with Stripe's documented test card method;
2. runs four refunds through the gateway (one automatic, one approved, one duplicate and one over the limit);
3. reconciles Stripe's refund list against AEGIS's receipts.

No real money moves.

### Alpaca, paper trading (free)

1. Create an account at alpaca.markets and open the **Paper Trading** dashboard. Paper accounts are free and start with simulated funds.
2. In the paper dashboard, generate an API key. You get a **Key ID** (paper keys start with `PK`) and a **Secret Key**, which is shown once.
3. On your machine: `read -rs ALPACA_PAPER_KEY && export ALPACA_PAPER_KEY`. Type it as `KEYID:SECRET`. Then run `npx tsx scripts/validate/run.mts alpaca`.

AEGIS refuses keys that are not paper keys, and the connector only talks to `paper-api.alpaca.markets`. Market orders fill only while the US market is open. Outside those hours the orders are accepted but stay open, and the record shows that.

### An AI provider (pay as you go; a run costs well under one US cent with a small model)

The gateway speaks the OpenAI chat completions format with a Bearer key. Any provider offering that works, as does a LiteLLM proxy. The simplest is OpenAI:

1. At platform.openai.com, create a **project** for AEGIS testing.
2. Under **Billing**, set a low monthly budget, for example USD 5.
3. Create a **project API key** restricted to that project.
4. On your machine:

   ```
   export AEGIS_VALIDATE_AI_BASE_URL=https://api.openai.com/v1
   export AEGIS_VALIDATE_AI_MODEL=gpt-4o-mini
   read -rs AEGIS_VALIDATE_AI_KEY && export AEGIS_VALIDATE_AI_KEY
   npx tsx scripts/validate/run.mts ai
   ```

The run creates a temporary organization and deletes it afterwards. It checks four things:
1. A clean prompt is answered.
2. An email address is masked before it reaches the provider.
3. A payment card is blocked and the provider is never contacted.
4. An unapproved model is refused.

It also checks that the records hold no prompt text. The prompts are synthetic.

### OSV.dev

No credential. Run `npx tsx scripts/validate/osv.mts`.

### Microsoft Entra ID

The steps are in `docs/ENTRA_CONNECTOR.md` under "Setting it up". You need:
- a test tenant you administer;
- an app registration with the application permissions AuditLog.Read.All and Directory.Read.All, and admin consent;
- a client secret.

Then run `npx tsx scripts/validate/run.mts entra` with `AEGIS_VALIDATE_ENTRA_TENANT_ID`, `AEGIS_VALIDATE_ENTRA_CLIENT_ID` and, typed with `read -rs`, `AEGIS_VALIDATE_ENTRA_CLIENT_SECRET`. Sign-in logs are personal data about employees: use a test tenant, or get the tenant owner's written agreement first.

### Resend, email (free tier)

AEGIS uses Resend for the email copies of approval requests, quarantines, raised alerts and new incidents (`packages/core/src/notify/email.ts`, off unless `AEGIS_EMAIL_NOTIFICATIONS=true`).

1. Create an account at resend.com.
2. Under **API Keys**, create a key with **Sending access** only, restricted to one domain if you have verified one. It starts with `re_`.
3. Pick the sender. Without a verified domain, Resend only accepts `onboarding@resend.dev` sending to your own account address. With a verified domain (**Domains**, then add the DNS records it lists), use an address on it, for example `AEGIS <alerts@yourdomain.com>`.
4. On your machine:

   ```
   export AEGIS_VALIDATE_EMAIL_TO=you@yourdomain.com
   export EMAIL_FROM="AEGIS <onboarding@resend.dev>"
   read -rs RESEND_API_KEY && export RESEND_API_KEY
   npx tsx scripts/validate/run.mts resend
   ```

The run sends one message, then sends it again with the same idempotency key and checks that Resend returns the same message id, so exactly one email arrives. The recipient address is not printed or recorded.

### Slack, incoming webhook (free)

1. At api.slack.com/apps, choose **Create New App**, then **From scratch**, in a test workspace or a test channel.
2. Under **Incoming Webhooks**, turn them on, choose **Add New Webhook to Workspace** and pick the channel. Copy the URL; it starts with `https://hooks.slack.com/services/`. Treat it as a secret: anyone holding it can post to that channel.
3. On your machine: `read -rs AEGIS_VALIDATE_SLACK_WEBHOOK_URL && export AEGIS_VALIDATE_SLACK_WEBHOOK_URL`, then `npx tsx scripts/validate/run.mts slack`.

The run creates a temporary organization, adds a Slack destination through the same code as the console (network safety checks, pinned DNS, the Slack message format), sends the test event, and deletes the organization. One message appears in the channel.

## Where each credential lives after the check

| Credential | Local check | Hosted demo (Fly) | Production |
|---|---|---|---|
| `STRIPE_TEST_SECRET_KEY` | shell only, `read -rs` | not set; stored per organization in the console vault (Integrations) | same, test mode only |
| `RESEND_API_KEY`, `EMAIL_FROM` | shell only | `fly secrets set` (with `AEGIS_EMAIL_NOTIFICATIONS=true`) | the platform's secret manager |
| Slack webhook URL | shell only | stored per organization in the console (Integrations, Event destinations) | same |
| Entra client secret | shell only | stored per organization in the console (Shadow AI, Entra) | same |

None of them belongs in `.env` files that are committed, in GitHub, in a ticket or in a chat. CI never needs them: every connector is tested there against a local stand-in.

## What a pass does and does not show

- **A Stripe pass shows** that AEGIS's refund connector, approvals and reconciliation agree with Stripe's real test-mode API. It does not show anything about live mode, which AEGIS refuses.
- **An Alpaca pass shows** the same for paper orders.
- **An AI provider pass shows** that the gateway forwards, masks and blocks correctly against that provider. It is not a review of the provider's own data handling.
- **A Resend pass shows** that the email provider code is accepted by Resend and that its idempotency key prevents a second delivery. It does not show inbox placement; check the inbox.
- **A Slack pass shows** that the destination code delivers to a real Slack webhook. The worker's batching and retries are tested separately against a stand-in.
- **An OSV.dev pass shows** that AEGIS queries and reads the public vulnerability database correctly. A package with no advisory is not proven safe.
