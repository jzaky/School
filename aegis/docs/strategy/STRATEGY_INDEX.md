# Nexus AI Assurance strategy index

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13 in response to the founder's strategic planning directive of October 2026. These documents supplement the AEGIS technical documentation in `docs/`. They do not replace it, and they do not change the technical roadmap. Proposed roadmap changes are listed separately and need approval.

The directive's status line uses an em dash. The repository forbids em dashes (`scripts/check-no-em-dash.sh` runs in CI), so every document uses a hyphen in the status line.

## Documents

| Document | Purpose |
|---|---|
| `AEGIS_MASTER_BUSINESS_PLAN.md` | Company, strategy, repository audit (directive Part 21), where this plan disagrees with the directive, proposed roadmap changes |
| `AEGIS_AI_FIRST_OPERATING_PLAN.md` | How the company runs with a founder, Claude, agents and fractional specialists |
| `AEGIS_INVESTMENT_USE_OF_FUNDS.md` | Review of the AED 1,000,000 allocation, revised allocation, release gates G0 to G5 |
| `AEGIS_12_MONTH_FINANCIAL_MODEL.md` | Conservative, base and upside scenarios: burn, cash, runway, revenue, margin, headcount, agent cost, acquisition cost |
| `model/build-model.mjs`, `model/model.json`, `model/monthly.csv` | Machine-readable model. Rerun the script after changing an input. |
| `AEGIS_FUNDRAISING_STRATEGY.md` | Entity and IP questions, valuation review, structure options, process |
| `AEGIS_ENTERPRISE_GO_TO_MARKET.md` | Segment scoring, personas, discovery, pilot template, demo scripts, security questionnaire, pricing, procurement, partners, conversion |
| `NEXUS_AI_AGENT_ROADMAP.md` | Feasibility and specification of the six internal agents, dependencies, order |
| `NEXUS_AI_OPERATIONS_ARCHITECTURE.md` | Separation between the agent runtime and the AEGIS control plane, and the dashboard capabilities mapped to existing tools |
| `AEGIS_HUMAN_VS_AI_RESPONSIBILITIES.md` | RACI model, with a named human always accountable |
| `AEGIS_12_MONTH_EXECUTION_PLAN.md` | Pre-close and quarterly plan with gates |
| `AEGIS_INVESTOR_DUE_DILIGENCE_CHECKLIST.md` | Data room checklist with available, partial, missing and unknown items |
| `AEGIS_COMMERCIAL_RISK_REGISTER.md` | 24 risks with scores, owners, mitigations and triggers |

## Existing documents these build on
- `docs/AEGIS_FULL_PLATFORM_AUDIT.md`: technical audit and security findings.
- `docs/IMPLEMENTATION_REPORT.md`: implemented versus simulated.
- `docs/PROVENANCE.md`: development provenance record, independent foundations and work flagged for review.
- `docs/DEMO_TO_PRODUCTION.md`: path from demo to pilot.
- `docs/THIRD_PARTY.md`: open source inventory.
- `apps/web/src/content/proof.ts`: approved public claims.

## Main disagreements with the directive

1. **Lead segment.** Start with digital-first financial services and implementation partners. Banks come later.
2. **Valuation.** AED 9,000,000 pre-money is optimistic for the evidence available. Prefer milestone tranches or a capped convertible.
3. **Sales spend.** Commissions come from revenue, and adviser and event spend waits for validated demand.
4. **Agents.**
   - Do not build a custom operations dashboard or a new engineering agent.
   - Build the prospecting and sales operations agents narrowly, on off-the-shelf tools.
   - Defer the finance agent.
5. **Legal first.** The DNRS NDA, IP assignment and repository ownership are settled before closing and before more work on autonomy-related phases.
6. **Budget gaps.** Trademark, insurance and customer hosting are missing or underfunded.

## Founder decisions recorded

**2026-10-13:**
- The complete technical roadmap continues, including Phases 3 to 5. It is not held for the NDA review.
- DNRS is not used as a technical, product, research or commercial reference for any part of AEGIS.
- The six known security findings are fixed first.
- Counsel's review of the existing NDA is still recommended, because independent development does not remove obligations under an agreement already signed.

This supersedes the proposal to hold Phases 3 to 5 in `AEGIS_MASTER_BUSINESS_PLAN.md` section 5. The proposal is kept there as written.

## Approval

None of these documents is approved. No business-agent implementation has begun. No hiring, purchasing, outreach, deployment or roadmap change has been made.
