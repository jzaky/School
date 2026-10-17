# Commercial platform

What AEGIS provides to sell, onboard, bill and support customers, and what it deliberately does not do.

## Plans and entitlements

`packages/core/src/commercial/plans.ts`.

| Plan | For | Illustrative default limits (agents, members, decisions per month) |
|---|---|---|
| Trial | A time-limited pilot with every available feature | 10, 15, 10,000 |
| Core | Governing and controlling agent actions | 25, 50, 250,000 |
| Secure | Core plus the AI security controls | 100, 200, 2,000,000 |
| Enterprise | Secure plus SSO and SCIM, deployment choice and agreed terms | set by contract |

- **No prices in code.** There has been no pricing analysis, so every plan is priced by quote and the amounts live in the customer's contract.
- **Features show their build status.** The AI model gateway with data loss prevention and Shadow AI discovery are listed as "planned, not built" and are never presented as included.
- **Limits are reported, not enforced.** The Billing page shows usage against limits (ok, 80% or more, over). Nothing is blocked when a limit is passed, so a customer's agents never stop because of a commercial number.
- **Trials.** A trial has an end date. When it ends nothing is switched off; the Billing page says so and the platform team follows up.

## Usage metering

`measureUsage` counts from the organization's own records for a calendar month (UTC): registered agents, active members, gateway decisions, approvals decided and evidence events. Attack Simulation Lab traffic is never counted. The worker job `usage.snapshot` runs every six hours and writes one row per organization, month and metric; it is idempotent (an upsert on that key), and in the first three days of a month it also finalizes the previous month.

## Contracts and invoices

- A platform administrator records the contract from the signed agreement: plan, term, billing period, currency, fee per period, included decisions, price per extra decision (four decimals), tax rate, payment terms, purchase order and limit overrides. Recording a new contract replaces the active one; old ones stay for history.
- Invoices are drafted from the contract and the period's measured usage. All arithmetic is in integers (minor units, and ten-thousandths for unit prices); tax is applied in basis points with half-up rounding.
- Lifecycle: draft, issued (due date from the payment terms), paid (with the reference of a payment received elsewhere) or void (with a reason). Amounts never change after drafting; a mistake is voided and redrafted. Every step is an evidence event.
- The customer sees issued and paid invoices; drafts stay with the provider.
- **AEGIS is not connected to a payment provider.** It never charges a card, collects money or sends invoices by itself. Connecting a billing provider (for example Stripe Billing) would need the owner's approval and credentials, and is not built.

## Customer onboarding

- A platform administrator creates the organization (Tenants page) with a plan and trial length. It starts with no members; the first administrator joins as owner through a one-time invitation link that is shown once and expires in 7 days. This deployment does not send email by itself.
- The Getting started page shows two checklists computed from records: the seven-step pilot checklist, and the enterprise rollout (organization, first administrator, single sign-on, first agent, first integration, first active policy, first gateway decision, first audit or governance report).

## Customer success

The platform Customers page computes, for each organization over the last 30 days: plan and trial, setup progress, integration health, policies enforced, agents acting versus active, decisions and refusals, incidents against the previous 30 days, and open or urgent support requests. Opening it is recorded as a platform event.

## Support

Any member can open a support request (subject, details, severity) from Support in the console. The platform administrator answers and resolves it from the customer page; the answer shows in the customer's console. Requests are evidence events and platform events. The form asks people not to paste personal data or secrets.

## Sales demonstration environment

`packages/core/src/demos/sales.ts`. From a demo organization (or as a platform administrator), a person can create their own "Sales Demonstration (synthetic)" organization. It holds six agents, six tools, six policies (written by AEGIS as a system author and activated by the person, so the four-eyes rule holds), an uncertainty policy and a reasoning policy. Each scenario runs through the real engines in "agent" execution mode, so an allowed action only returns a one-time permission slip and no external system is called.

| Scenario | What AEGIS does |
|---|---|
| Finance | AED 8,400 payment allowed; AED 186,000 waits for an approver; AED 740,000 refused with a security event |
| Healthcare | Records without an open claim refused; full history refused; a claim's request narrowed from five fields to three |
| Enterprise IT | Staging change allowed; the helpdesk bot (no permission) refused; production change without a ticket asked for one; with a ticket, approval required; dropping the production database refused |
| Uncertainty | Two sources disagree on the account: held for a person, who asks for more evidence; the agent reports what it could not confirm and AEGIS asks for it; agreeing trusted sources allowed |
| Managed autonomy | An opted-in agent at level 3 is refused five times in an hour, three times: lowered to 2, then 1, then suspended; a normal request after that is refused |
| Reasoning governance | Reasons that cite nothing: more information requested; a citation to evidence never supplied: held for a person; fully cited reasons: allowed |

Every step reports whether AEGIS did what the scenario expects and links to the record. The page and every card say "Simulated"; none of these is a verified live integration.

The managed autonomy scenario uses a per-agent opt-in (`agent.metadata.autonomyAutomation`) added in this phase: it turns the automatic downgrade rules on for one agent even when they are off for the organization, and can suspend that agent when it is refused in another burst while already at level 1.

## Tests

- Core: `tests/commercial.test.ts` (8), `tests/sales-demo.test.ts` (9, all six scenarios through the real engines).
- Browser: `tests/e2e/commercial.spec.ts` (5).
