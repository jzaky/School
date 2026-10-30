# AEGIS 12-month financial model

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13 for Nexus AI Assurance FZCO. All amounts are in AED.

## 1. What is fact and what is assumption

**Confirmed facts (from the repository):**
- No revenue, customer, pilot, investor commitment or financial record exists in the repository or its documentation.
- AEGIS makes no calls to external AI providers at runtime. The pricing page says so, and a code search found none.
- AEGIS has no billing, metering, CRM or payment-provider code. The billing page shows plan and counts, and its billing portal button is disabled.

**Not known and needed from the founder:**
- Cash on hand today, existing liabilities, and monthly costs already committed (licence, visa, office, subscriptions).
- Whether any founder loans or prior spending should be recorded as a liability or as capital.

**Everything else is an assumption.** That covers every price, salary, vendor fee, revenue timing and usage level below. None of it is a quotation or a market price.

## 2. How the model works

The figures are produced by a script. Run this from the `aegis` directory:

```
node docs/strategy/model/build-model.mjs
```

It writes two files next to the script:
- `model.json` holds all scenarios with their inputs and totals.
- `monthly.csv` holds one row per scenario per month.

Change an input in the script and rerun it. Do not edit the numbers in this document by hand.

**Rules the model follows:**
- **Opening cash:** AED 1,000,000 arrives before month 1. The model holds no other cash because none is known.
- **Reserve:** the AED 50,000 protected reserve is never spent. Ending cash includes it, and runway figures exclude it.
- **Cash timing:** contracts are recorded when signed, and cash arrives 2 months later. Regulated buyers commonly pay on 30 to 60 day terms after invoice.
- **Commissions:** 15% of cash collected, paid the month after collection. Commissions are a variable cost here, not a fixed AED 45,000. This differs from the founder's plan on purpose.
- **Hosting per annual customer:** AED 2,500 a month from signature, for a managed environment. A customer that runs AEGIS inside its own systems costs less to host but more to support.
- **Annual contract gross margin:** 75%, an assumption to test.
- **Pilot gross margin:** computed as pilot revenue minus the pilot budget.

## 3. Scenarios

| | Conservative | Base | Upside |
|---|---|---|---|
| Story | No paid pilot within 12 months. Procurement runs past month 12. A second security retest is needed. No hiring. | The founder's targets: 3 paid pilots at AED 30,000 and 2 annual contracts at AED 150,000. | A partner brings deals early: 5 paid pilots at AED 40,000 and 4 annual contracts. A customer success contractor joins from month 9. |
| Total spend, 12 months | 750,000 | 922,500 | 1,186,500 |
| Cash collected in 12 months | 0 | 240,000 | 650,000 |
| Contract value signed in 12 months | 0 | 390,000 | 800,000 |
| Contracted ARR at month 12 | 0 | 300,000 | 600,000 |
| Ending cash, month 12 (includes reserve) | 250,000 | 317,500 | 463,500 |
| Lowest cash point | 250,000 (month 12) | 216,500 (month 11) | 223,500 (month 9) |
| Average monthly gross burn | 62,500 | 76,875 | 98,875 |
| Average monthly net burn | 62,500 | 56,875 | 44,708 |
| Monthly cost run rate after month 12 | 30,250 | 42,500 | 64,000 |
| Monthly recurring revenue after month 12 | 0 | 25,000 | 50,000 |
| Runway after month 12, reserve excluded | 6.6 months | 15.3 months | 29.5 months |
| Headcount, in full-time equivalents | Founder 1, fractional CTO 0.25 | Founder 1, CTO 0.25, sales adviser 0.25 | Founder 1, CTO 0.25, sales adviser 0.25, customer success 0.5 |
| Agent and AI usage cost, 12 months | 36,000 | 36,000 | 108,000 |
| Sales and partnership spend | 38,000 | 150,500 | 240,000 |
| Paying customers (a converted pilot counts once) | 0 | 3 | 5 |
| Customer acquisition cost per paying customer | n/a | 50,167 | 48,000 |
| Pilot gross margin | n/a | 22% | 50% |
| Extra capital needed in 12 months | None, but a raise must start by about month 9 | None | None. Working capital is tight in months 8 to 9. |

### Monthly cash balance

| Month | Conservative | Base | Upside |
|---|---|---|---|
| 1 | 903,000 | 903,000 | 897,000 |
| 2 | 842,000 | 842,000 | 830,000 |
| 3 | 777,000 | 777,000 | 745,000 |
| 4 | 667,000 | 639,000 | 596,500 |
| 5 | 616,750 | 563,000 | 500,500 |
| 6 | 525,500 | 470,750 | 407,000 |
| 7 | 485,250 | 408,000 | 358,000 |
| 8 | 422,000 | 357,250 | 298,000 |
| 9 | 375,750 | 279,000 | 223,500 |
| 10 | 330,500 | 247,000 | 326,000 |
| 11 | 280,250 | 216,500 | 413,000 |
| 12 | 250,000 | 317,500 | 463,500 |

### Spend by category against the proposed allocation

| Category | Proposed | Conservative | Base | Upside |
|---|---|---|---|---|
| Founder compensation | 150,000 | 150,000 | 150,000 | 150,000 |
| Fractional CTO and specialist engineering | 160,000 | 160,000 | 160,000 | 160,000 |
| Enterprise sales and partnerships | 200,000 | 38,000 | 150,500 | 240,000 |
| Independent security validation | 140,000 | 155,000 | 140,000 | 140,000 |
| Legal and IP | 100,000 | 102,000 | 112,000 | 122,000 |
| AI agents and infrastructure | 80,000 | 80,004 | 80,004 | 152,004 |
| Customer pilots and onboarding | 70,000 | 15,000 | 70,000 | 100,000 |
| Operations, reserve excluded | 50,000 | 49,996 | 49,996 | 49,996 |
| Customer delivery beyond the plan | 0 | 0 | 10,000 | 72,500 |
| Protected reserve, held | 50,000 | 50,000 | 50,000 | 50,000 |

Legal includes an AED 12,000 trademark clearance and filing line that the proposed allocation does not have. See section 5.

### Spend by quarter against the proposed allocation

| Quarter | Proposed | Conservative | Base | Upside |
|---|---|---|---|---|
| Q1 | 210,000 | 223,000 | 223,000 | 255,000 |
| Q2 | 230,000 | 251,500 | 306,250 | 338,000 |
| Q3 | 270,000 | 149,750 | 221,750 | 303,500 |
| Q4 | 240,000 | 125,750 | 171,500 | 290,000 |

The model front-loads spending compared with the proposed quarters. Independent security testing has to finish before any customer deployment, so it lands in month 4 to 6, not across the year. Legal work on IP, the NDA and the investment documents has to happen in month 1 to 2. Before approval, the founder should either accept this profile or move pilots later.

## 4. Agent and AI operating cost

There is no measured workload yet, so these are three bands. They should be replaced by measured usage after 60 days of operation.

| Band | AI model use per month | Agent execution per month | 12 months | When it applies |
|---|---|---|---|---|
| Low | 1,000 | 500 | 18,000 | Development on subscription plans only. Agents run a few research tasks a week. |
| Expected | 2,000 | 1,000 | 36,000 | Development plus three internal agents on light daily schedules. |
| High | 6,000 | 3,000 | 108,000 | Heavy API use by agents, such as long research runs, repository-wide analysis and pilot support. |

**Costs that grow with customer activity:**
- Hosting per managed customer environment.
- Database storage, because evidence and audit records are append-only by design.
- Log volume, backup storage and pilot support hours.
- The AI usage of a customer success agent, if one is built.

**Costs that do not grow with customers:**
- The core AEGIS gateway itself. AEGIS calls no AI provider, so its cost per decision is database and compute only.

The proposed AED 80,000 covers the expected band. It does not cover the high band, which comes to AED 152,004 for the whole category. The upside scenario therefore overruns this category.

## 5. Gaps in the proposed budget

1. **Trademark.** "AEGIS" is a crowded name in software and security. Clearance and filing are not budgeted. The model adds AED 12,000 as an assumption; get counsel's estimate.
2. **Insurance.** Enterprise and bank contracts often require professional indemnity and cyber cover at stated minimums. AED 10,000 is unlikely to be enough once a contract names those minimums. Get a broker quotation before quarter 2.
3. **Certification.** SOC 2 or ISO/IEC 27001 is not budgeted, and that is the right call for year 1. Bank procurement may still ask for it. Plan to answer with the independent penetration test report, the security documentation and a dated certification roadmap. Price certification only when a signed opportunity requires it.
4. **Tax and registration.** UAE corporate tax registration applies to free zone companies. VAT registration becomes mandatory above a turnover threshold, and the upside scenario approaches it. A tax adviser must confirm both. The accounting line of AED 12,000 a year assumes simple bookkeeping.
5. **Customer delivery.** The base and upside scenarios need hosting and support after contracts are signed. The proposed plan has no line for this: AED 10,000 in the base case and AED 72,500 in the upside.
6. **Founder time.** The plan has the founder running strategy, sales, fundraising, partnerships, supervision of Claude and all approvals. That is the binding constraint, not money.

## 6. What must be validated externally before the model is used with investors

| Assumption | Who validates it |
|---|---|
| Pilot price of AED 20,000 to 50,000, and annual price of AED 150,000 | 10 or more discovery interviews with buyers |
| Sales cycle of 4 to 8 months to a paid pilot, and 6 to 12 months to an annual contract | Interviews, plus the sales adviser's experience with regulated buyers |
| Penetration test and assessment fees | Two or three written quotations from independent firms |
| Fractional CTO at AED 8,000 a month for about 0.25 of full time | Two or three candidate proposals |
| Fractional sales adviser at AED 6,000 a month | Candidate proposals, with commission terms in writing |
| Legal fees per workstream | Engagement letters with fee estimates |
| Company administration, visa and licence costs | The free zone authority's current fee schedule and the existing licence |
| Insurance premiums | Broker quotation |
| Hosting per environment | A priced deployment on the chosen UAE cloud region |
| AI usage | Billing data after 60 days |
