# Integration validation

This document separates three kinds of evidence:

- **External, verified:** a run of AEGIS code against the provider's real API, recorded in `docs/validation/results/`.
- **Local stand-in:** automated tests against a local server that imitates the provider. This proves AEGIS's own logic, not the provider's behaviour.
- **Not run:** the check exists but has not been run, usually because it needs a credential that only you can create.

## Matrix (14 October 2026)

| Integration | Needs a credential | External, verified | Local stand-in | Record |
|---|---|---|---|---|
| OSV.dev (vulnerabilities) | No, public API | **Yes**, 5 of 5 checks | Yes (`software-security.test.ts`) | `docs/validation/results/osv-2026-10-14-12-03-27.json` |
| Stripe (refunds, test mode) | Yes, a test-mode secret key | Not run | Yes (`stripe-connector.test.ts`, fake Stripe server) | none yet |
| Alpaca (paper trading) | Yes, a paper-account key pair | Not run | Yes (`trading.test.ts`, fake Alpaca server) | none yet |
| AI provider through the AI gateway | Yes, a provider API key | Not run | Yes (`ai-gateway.test.ts`, a recording stand-in) | none yet |
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

## What a pass does and does not show

- **A Stripe pass shows** that AEGIS's refund connector, approvals and reconciliation agree with Stripe's real test-mode API. It does not show anything about live mode, which AEGIS refuses.
- **An Alpaca pass shows** the same for paper orders.
- **An AI provider pass shows** that the gateway forwards, masks and blocks correctly against that provider. It is not a review of the provider's own data handling.
- **An OSV.dev pass shows** that AEGIS queries and reads the public vulnerability database correctly. A package with no advisory is not proven safe.
