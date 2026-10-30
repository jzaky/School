# AEGIS commercial risk register

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13.

- **Likelihood (L) and impact (I):** each scored 1 (low) to 5 (high).
- **Score:** L times I.
- **Owners:** named roles. Every owner is a human.

| ID | Category | Risk | L | I | Score | Owner | Mitigation | Trigger to act |
|---|---|---|---|---|---|---|---|---|
| R1 | Legal | The DNRS NDA restricts work on autonomy, uncertainty or reasoning governance, or creates a claim against AEGIS | 2 | 5 | 10 | CEO, counsel | Counsel review in month 1, before more work on Phases 3 to 5. Clean-room record. Avoid DNRS-like terms in marketing. | Any NDA clause on similar products or on use of disclosed information |
| R2 | Legal | IP not owned by the company. The repository is in a personal account and shared with another product. | 4 | 5 | 20 | CEO, counsel | IP assignment, company-owned repository, licence decision before closing | Before any term sheet |
| R3 | Legal | AI-generated code ownership is unclear under the provider terms or UAE law | 3 | 4 | 12 | Counsel | Counsel's memo. Provenance statement. Confirm the account type and terms used. | Before closing |
| R4 | Legal | Trademark conflict on "AEGIS" | 3 | 3 | 9 | Counsel | Clearance search before spending on brand. Keep "Nexus" as the company brand. | Search result |
| R5 | Security | An undiscovered flaw in the gateway, grants or tenant isolation reaches a customer | 3 | 5 | 15 | CTO | Fix known findings, independent test, retest, gate G3 before real data | Any critical finding |
| R6 | Security | The AI writes the code and the AI writes the tests that check it, so blind spots repeat | 4 | 4 | 16 | CTO | Human review on security paths. Independent test. Adversarial test cases written by a person. | Review findings rate |
| R7 | Security | An internal agent is manipulated by prompt injection from web content | 3 | 3 | 9 | CTO | No send capability. Drafts only. Destination allowlist. Shield inspection. | Any unexpected draft content |
| R8 | Technical | Roadmap breadth (15 phases, 17 integrations) dilutes pilot readiness | 4 | 4 | 16 | CEO | Roadmap changes proposed in the master plan section 5 | Pilot slips because of an unbuilt basic item |
| R9 | Technical | Single-person dependency on the founder for review and approvals | 5 | 4 | 20 | CEO | Fractional CTO as second approver. Batch approvals. Narrow agents. | Approval queue older than 2 days |
| R10 | Technical | Dependency on one AI provider for development | 3 | 3 | 9 | CEO | Conventional, documented codebase. Human-readable docs. Any engineer can continue. | Provider price or terms change |
| R11 | Commercial | Buyers do not prioritize action authorization in year 1 | 3 | 5 | 15 | CEO | Discovery before spend (gate G2). Pivot workflow or segment on evidence. | Fewer than 3 qualified opportunities by month 6 |
| R12 | Commercial | Bank procurement exceeds 12 months | 4 | 3 | 12 | CEO | Digital-first segment first. Banks as a second wave. Partners. | No bank past security review by month 9 |
| R13 | Commercial | Platform vendors bundle agent governance for free | 4 | 4 | 16 | CEO | Cross-platform position, execution grants, private deployment. Test the message in discovery. | Buyers cite bundled controls as sufficient |
| R14 | Commercial | Pilots do not convert to annual contracts | 3 | 4 | 12 | CEO | Annual terms agreed before the pilot. Success criteria in writing. Pilot fee credited. | Mid-pilot review shows no budget |
| R15 | Commercial | Overstated public claims damage trust. The current "Sandbox tested" label overstates the evidence for Stripe and Alpaca. | 3 | 4 | 12 | CEO | Correct the label. Proof page as the only claims source. Review all materials. | Any claim without evidence |
| R16 | Financial | The valuation is not accepted, delaying the raise | 4 | 3 | 12 | CEO | Options B and C in the fundraising strategy. Comparable rounds. | Two investors decline on price |
| R17 | Financial | Conservative case: runway ends about 6.6 months after month 12, reserve excluded | 3 | 5 | 15 | CEO | Gates. Start the next raise by month 9 if no pilot has paid. Cut sales spend. | Month 9 with no paid pilot |
| R18 | Financial | Insurance, certification or customer hosting costs exceed the budget | 3 | 3 | 9 | CEO | Quotations in Q1. Hosting funded from contracts. No certification without a signed requirement. | First contract naming insurance minimums |
| R19 | Financial | Agent usage costs exceed the expected band | 2 | 2 | 4 | CEO | Monthly usage report. Hard spending limits at the provider. | Usage above AED 4,000 a month |
| R20 | Regulatory | Prospect research breaches the UAE PDPL, platform terms or marketing rules | 2 | 4 | 8 | CEO, counsel | Role-level research. Counsel's advice. No scraping or bought lists without approval. | Any complaint |
| R21 | Regulatory | Customers need regulator notification for outsourcing and pilots stall | 3 | 3 | 9 | CEO | Self-hosted deployment option. Early question in discovery. | A customer flags the requirement |
| R22 | Execution | The founder spends time building internal tools instead of selling | 4 | 4 | 16 | CEO | No custom operations dashboard in year 1. Weekly time review. | Internal tooling takes more than 20% of founder time |
| R23 | Execution | The hosted demo is unstable during a sales meeting | 3 | 3 | 9 | CTO | Stable demo environment (gate G1). Recorded demo video as a fallback. | Any failed demo |
| R24 | Reputation | A competitor or former counterparty disputes AEGIS's originality | 2 | 4 | 8 | CEO, counsel | R1 and R2 mitigations. Documented provenance. | Any letter or public claim |

## Top five by score

| Rank | Risk | Score |
|---|---|---|
| 1 | R2 IP ownership | 20 |
| 2 | R9 founder dependency | 20 |
| 3 | R6 AI checking its own work | 16 |
| 4 | R8 roadmap breadth | 16 |
| 5 | R13 platform bundling | 16 |

R22 (founder building internal tools instead of selling) ties at 16.
