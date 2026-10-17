# AEGIS 12-month execution plan

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. Month 1 is the first month after the investment closes. Activities before closing are marked "pre-close". Gates G0 to G5 are defined in `AEGIS_INVESTMENT_USE_OF_FUNDS.md` section 4. Spend figures are the base scenario from `docs/strategy/model/`.

## Pre-close (weeks 1 to 8 from approval of this plan)

Cost: founder time plus legal fees, which are paid from the raise at closing or advanced by the founder.

**Legal and IP:**
- Counsel reviews the DNRS NDA.
- IP assignment from the founder to the company.
- AEGIS moved to a company-owned repository, keeping its history.
- Licence file decision.
- Trademark clearance search.
- Entity and investment structure advice.

**Product, continuing the technical roadmap:**
- Finish Phase 2 (agent identity).
- Pilot-blocking security fixes: S8, S9, S10, S13, S14 and S15.
- Regression test that agent keys cannot change policies, agents, approvals or keys.
- Run the real Stripe and Alpaca sandbox checks once keys are provided.
- Correct the "Sandbox tested" label until those checks have run.

**Fundraising:**
- Data room started.
- Comparable rounds collected.
- Pitch materials prepared.

**Commercial:**
- Target list of 30 accounts and 10 partners, researched by the founder.
- First discovery interviews, with no selling.

## Quarter 1 (months 1 to 3): enterprise readiness

Base spend AED 223,000. Proposed allocation AED 210,000.

| Workstream | Deliverables | Owner |
|---|---|---|
| Legal | Investment documents. Open source and AI-code review with counsel's memo. Customer contract templates (subscription agreement, order form, data processing terms). Privacy advice on prospect research. | CEO, counsel |
| Technical oversight | Fractional CTO engaged on deliverables. Architecture review report. Security-path review rule in force. | CEO, CTO |
| Product | Staging and production-grade deployment approved by the founder in a UAE cloud region, with backups and monitoring. Hosted demo environment stable. Three demo scripts rehearsed. Generic outbound connector, the minimum Phase 8 item. | Claude, CTO |
| Security | Penetration test scope and firm chosen from 2 or 3 quotations. Security documentation pack. Incident response plan drafted. | CTO, Claude |
| Commercial | 10 discovery interviews logged. Security questionnaire answers. Pilot proposal template. Partner outreach to 5 firms. | CEO |
| Agents | Engineering controls (branch protection, required review). The prospecting agent is planned, not built. | CEO, Claude |

**Gates in Q1:**
- G0 (legal and IP clear) must pass before closing.
- G1 (demonstration ready) is targeted for the end of month 3.

**Technical roadmap in Q1.** Resume Phases 3 to 5 only after G0, and with the clean-room record counsel recommends. Continue Phase 13 and 14 hardening.

## Quarter 2 (months 4 to 6): market entry

Base spend AED 306,250. Proposed allocation AED 230,000. This quarter is higher because the security tests fall here.

| Workstream | Deliverables |
|---|---|
| Security | Application penetration test and gateway assessment in month 4. Tenant isolation and API review in month 5. Cloud review in month 6. Critical and high findings fixed. |
| Commercial | Sales adviser engaged if G1 passed. 20 discovery interviews in total. 3 or more qualified opportunities (gate G2). First proposals. First paid pilot targeted for month 6. |
| Legal | Customer contract negotiation support. Insurance placed to the cover a contract requires. |
| Agents | Prospecting agent pilot for 30 days on 20 accounts, after dependencies D1 to D5 |
| Product | Pilot-specific integration only for a signed pilot. Managed autonomy (Phase 3) if G0 allowed it. |

## Quarter 3 (months 7 to 9): pilot execution

Base spend AED 221,750. Proposed allocation AED 270,000.

| Workstream | Deliverables |
|---|---|
| Pilots | Pilots 2 and 3 signed and delivered through the observe, sandbox and limited-production stages. Limited production only after G3. Mid-pilot reviews. |
| Security | Retest of fixed findings. Remediation evidence in the data room. |
| Commercial | Annual contract proposals to pilot customers. Partner pilot. |
| Agents | Gate G4 review of the prospecting agent at 60 days. Sales operations agent if the CRM is in place. |
| Finance | If no pilot has paid by month 9, start the next raise or cut to the conservative budget |

## Quarter 4 (months 10 to 12): commercial conversion

Base spend AED 171,500. Proposed allocation AED 240,000.

| Workstream | Deliverables |
|---|---|
| Commercial | Two annual contracts targeted, in months 10 and 12. Pilot close-out reports. Expansion workflows named. |
| Delivery | Deployment runbook made repeatable. Customer success knowledge base. |
| Hiring | Gate G5 review: a customer delivery engineer if two annual contracts are signed |
| Finance | Re-forecast. Decide on the next round with real pipeline data. |

## Protected reserve

AED 50,000 is held throughout and released only by a recorded founder decision with the investor informed. The base scenario does not spend AED 77,500 of the proposed budget (1,000,000 less 922,500 spent). That amount stays in cash.

## What this plan does not do

- It does not start building Nexus AI Operations, hire anyone, buy services, contact customers or deploy agents. Each of those needs the founder's approval after this plan is accepted.
- It does not change the technical roadmap. The proposed changes are listed in `AEGIS_MASTER_BUSINESS_PLAN.md` section 5 and need approval.
