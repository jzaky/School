# AEGIS investment use of funds

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. All amounts are in AED. Every allocation below is a proposed planning figure, not an expense, a vendor quotation or a commitment. Monthly and scenario figures come from `docs/strategy/model/build-model.mjs`. The narrative and the scenario results are in `AEGIS_12_MONTH_FINANCIAL_MODEL.md`.

## 1. Proposed allocation (founder's directive)

| Category | Amount | Share |
|---|---|---|
| Founder compensation | 150,000 | 15% |
| Fractional CTO and specialist engineering | 160,000 | 16% |
| Enterprise sales and partnerships | 200,000 | 20% |
| Independent security validation | 140,000 | 14% |
| Legal and intellectual property | 100,000 | 10% |
| AI agents and infrastructure | 80,000 | 8% |
| Customer pilots and onboarding | 70,000 | 7% |
| Operations and reserves (AED 50,000 of it protected) | 100,000 | 10% |
| **Total** | **1,000,000** | **100%** |

Every sub-table in the directive sums correctly to its category total. The four quarterly allocations of 210,000, 230,000, 270,000 and 240,000 sum to 950,000, plus the 50,000 reserve.

## 2. Category review

Each category gets a verdict and the reason for it.

### Founder compensation: 150,000. Keep it.
AED 12,500 a month is modest for the UAE and investors will expect a founder salary. It must be disclosed in the investment documents, set by a board or shareholder resolution, and paid through payroll with visa and any wage protection requirements met.

### Fractional CTO and specialist engineering: 160,000. Keep the total and change the shape.
- **Change 1: buy reviews against deliverables, not hours.** AED 8,000 a month buys roughly one day a week of a senior person. That is enough for review, not for ownership. Write the engagement around fixed deliverables: an architecture review report, a sign-off on the authorization gateway, release-readiness checklists, and a review of every change to identity, grants, row-level security and evidence code.
- **Change 2: make the CTO the second approver.** AEGIS enforces four-eyes on policy activation and separation of duties on approvals. A one-person company cannot satisfy its own controls. The fractional CTO, or another qualified person, must hold approval rights in the internal AEGIS tenant. Without that, Nexus AI Operations cannot be governed honestly.
- **Change 3: pin down the emergency line.** "Emergency engineering support" is only useful with a retainer that names a response time. Without one, fold it into the CTO budget.

### Enterprise sales and partnerships: 200,000. Reduce it to about 150,000 and gate the rest.
- **This is the largest category, and it is spent before demand is validated.** The base model spends 150,500, because the adviser starts in quarter 2 only after the sales gate is passed.
- **Commissions should come out of revenue, not the raise.** At 15% of collected cash, the base case pays about AED 13,500 within 12 months, not AED 45,000. Unused commission budget should stay in cash.
- **Events.** AED 25,000 can disappear into exhibition fees. Prefer small, targeted executive roundtables and partner-hosted sessions, each with a stated pipeline goal.
- **The better alternative.** Recruit one or two AI implementation partners or system integrators that already sell into UAE banks and enterprises. They bring procurement access that a part-time adviser cannot. Pay them a referral or resale margin on closed revenue.

### Independent security validation: 140,000. Keep it, re-sequence it, and hold a buffer.
- **Test only what is pilot-ready.** Scope covers the authorization gateway, grants, approvals, tenant isolation, identity and SSO, and the deployment you will actually run.
- **Fix known issues first.** Findings S8, S9, S10 and S14 in `docs/AEGIS_FULL_PLATFORM_AUDIT.md` are known and unfixed. Paying a tester to rediscover them wastes money.
- **Keep a buffer.** The conservative case assumes a second retest at AED 15,000. If the first test returns serious findings, budget for that.
- **No certification in year 1** unless a signed opportunity requires it.

### Legal and IP: 100,000. Increase it to about 112,000 and do it first.
- **Add trademark clearance and filing**, AED 12,000 as an assumption. The "AEGIS" name is widely used in software and security.
- **Two items block fundraising and must happen in month 1:**
  - The DNRS NDA review. It is listed in the budget, which suggests an NDA exists.
  - The IP review: code ownership, assignment from the founder to the company, the AI-generated code position and the open source inventory.
- **Do this before more effort goes into managed autonomy, uncertainty and reasoning governance.** Those concepts sit close to the publicly described DNRS SMARt states. See the risk register.

### AI agents and infrastructure: 80,000. Keep it for the expected case.
It covers the expected usage band. It does not cover heavy agent use or several managed customer environments. Add a variable line for customer hosting of about AED 2,500 per managed environment per month, funded from contract revenue.

### Customer pilots and onboarding: 70,000. Keep it, and charge for integration work.
- **Pilot margin is thin.** At AED 30,000 per pilot the base case makes about 22%.
- **Charge integration separately.** Customer-specific integration work (AED 25,000 of this budget) should be quoted as a separate line or credited against the annual contract, not absorbed.
- **Release the budget per pilot.** Spend it only after a pilot is signed.

### Operations and reserves: 100,000. Keep it, and treat insurance as underfunded.
- **Insurance.** AED 10,000 is likely low once an enterprise contract states cover minimums. Get a broker quotation.
- **Fees.** Company administration, licence and visa figures must match the free zone authority's current fee schedule.
- **Reserve.** The protected AED 50,000 reserve should only be released by a recorded founder decision, with the investor informed.

## 3. Revised allocation recommended for discussion

| Category | Proposed | Recommended | Change and reason |
|---|---|---|---|
| Founder compensation | 150,000 | 150,000 | None |
| Fractional CTO and specialist engineering | 160,000 | 160,000 | Same total. Deliverable-based, and the CTO becomes the second approver. |
| Enterprise sales and partnerships | 200,000 | 150,000 | Commissions paid from revenue. Adviser from quarter 2 after the sales gate. Partner-led channel. |
| Independent security validation | 140,000 | 140,000 | Same. Fix known findings before testing. |
| Legal and IP | 100,000 | 115,000 | Add trademark. IP and NDA work in month 1. |
| AI agents and infrastructure | 80,000 | 80,000 | Same. Customer hosting is funded from contracts. |
| Customer pilots and onboarding | 70,000 | 70,000 | Same. Released per signed pilot. |
| Operations (insurance raised by 5,000) | 50,000 | 55,000 | Insurance likely underfunded |
| Protected reserve | 50,000 | 50,000 | Same |
| Unallocated, held as cash | 0 | 30,000 | Released for sales or delivery only when a gate is passed |
| **Total** | **1,000,000** | **1,000,000** | |

## 4. Release gates

Money in a category is released only when its gate is recorded as passed by the founder and, for security gates, by the fractional CTO.

| Gate | Releases | Evidence required |
|---|---|---|
| G0 Legal and IP clear | All product marketing that uses autonomy or uncertainty language; the investment closing | Counsel's written view on the NDA and on IP ownership; IP assignment signed; open source inventory reviewed |
| G1 Demonstration ready | Sales adviser engagement, events, partner enablement | Hosted demo environment stable for 30 days; three demonstration scripts rehearsed; security questionnaire draft complete |
| G2 Demand validated | Procurement support, travel beyond the founder | At least 10 discovery interviews logged; at least 3 qualified opportunities with a named sponsor and a budget owner |
| G3 Deployment safe | Any customer pilot that touches real data or real systems | Independent test of the gateway and tenant isolation done, critical and high findings fixed and retested, incident response plan, data processing terms signed |
| G4 Agent value proven | Any internal agent beyond the first three, or the custom operations dashboard | 60 days of measured cost and output per agent, compared with the cost of a person or a SaaS tool |
| G5 Hiring | Any permanent hire | A recurring need shown for 3 months, cost compared with contractors and automation |
