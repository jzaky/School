# AEGIS Trading

AEGIS Trading is governance of a trading agent, not a trading strategy. The agent decides what it
wants to order; AEGIS decides what may reach the broker, what waits for a person and what is refused,
and records every decision as evidence. Nothing in this module reads market data or holds a view on
any instrument.

What ships (added 2026-10-13):

- A guided trading policy template, `trading-v1` (`packages/core/src/policy/trading.ts`), with the
  owner's own limits: instrument allowlist, allowed sides and order types, a per-order unit cap,
  notional bands (automatic, approval, refused), market hours, a duplicate-reference block, a daily
  loss cap and a daily request cap. It compiles to an ordinary policy document with embedded tests
  and reopens in a guided "Mandate" tab in the console; the New policy dialog offers it beside the
  refund and score-band templates with a live dry run per band.
- A simulated brokerage (`brokerage-sim`, tool `submit-order`) for the demonstration, with
  synthetic fills in a visible ledger.
- An Alpaca paper-trading connector (`alpaca-paper`, tool `place-order`,
  `packages/core/src/gateway/connectors/alpaca.ts`) that refuses live keys and the live host. See
  `docs/CONNECTORS.md` for the money-safety gates and outcome semantics.
- A demo scenario ("AEGIS Trading: a portfolio agent under a mandate") on the Demo scenarios page,
  and a seeded Portfolio Trading Agent with months of order history under the seeded mandate.
- Posture and boundary sentences understand the template: the agent shows as Supervised with the
  mandate's own wording, and every approval says how far the order sat from the automatic limit and
  the ceiling.

## What an order looks like

The agent sends one request per order through the Action Gateway:

```json
{
  "tool": "place-order",
  "action": "execute",
  "resource": "trading-book",
  "params": {
    "symbol": "AAPL",
    "side": "buy",
    "type": "limit",
    "qty": 60,
    "limitPrice": 230,
    "notional": 13800,
    "reference": "SIG-2041",
    "reason": "Momentum signal above threshold"
  },
  "context": { "dayPnl": -420 }
}
```

- `notional` is the order's value in the account currency as the agent declares it. The policy
  bands read it. The Alpaca connector refuses a limit order whose notional is not `qty` times
  `limitPrice` (within 0.5 percent) and submits market orders by notional, so the declared value is
  what the broker fills.
- `reference` is the agent's own order reference. The gateway's duplicate detection keys on it, so a
  repeat of a reference inside 30 days is refused by the template's duplicate rule.
- `context.dayPnl` is the day's result as the agent reports it. The daily loss cap reads it. AEGIS
  does not compute profit and loss; the approver instructions tell the person to check exposure in
  the broker before approving, and the Alpaca connection test reads the paper account.

## Stated limits

- Paper trading only. The connector cannot reach a live Alpaca account: paper keys (`PK...`) are
  required at store time and again at execution time, and the live host is refused whatever the
  integration settings say.
- Market hours are a UTC window to the hour, not an exchange calendar. Holidays and half days are
  not known to the policy; an order outside the window waits for a person (or is refused, per the
  setting).
- The daily loss cap trusts the figure the agent sends. A dishonest agent can under-report it. The
  cap is a guard against a runaway strategy, not against a hostile one; the instrument list, the
  per-order cap and the notional ceiling do not depend on anything the agent reports.
- No position awareness. The template does not know the account's open exposure, so "long only"
  cannot be enforced from the gateway alone; sells can be disallowed outright with the sides setting.

## Verifying against a real paper account

With an Alpaca paper key, `scripts/alpaca-paper-check.mts` stores the key for the demo tenant,
enables the integration, runs a small automatic order, an order that needs the demo approver, a
refused oversize order and a replayed request, then lists the orders from Alpaca and reconciles them
against the AEGIS receipts:

```
ALPACA_PAPER_KEY=PK...:secret npx tsx scripts/alpaca-paper-check.mts
```

Without the key the script prints its plan and exits. No such run has been made yet; the connector
is verified against a fake Alpaca server in `packages/core/tests/trading.test.ts`.
