# AEGIS human and AI responsibilities

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. A RACI model expanded from the directive's starting matrix.

**Letters:**
- **R (Responsible):** does the work.
- **A (Accountable):** owns the outcome and approves.
- **C (Consulted):** gives input before.
- **I (Informed):** told after.

**Rule:** A is always a named human. Claude and agents can be R, C or I, never A.

**Parties:** CEO = founder. CTO = fractional CTO. Claude = Claude Code. Agents = internal AI agents. Spec = an independent specialist (security firm, lawyer, accountant). Sales = fractional sales adviser or partner.

## 1. Product and engineering

| Activity | CEO | CTO | Claude | Agents | Spec |
|---|---|---|---|---|---|
| Product priorities and roadmap | A | C | C | I | |
| Feature implementation | I | C | R | | |
| Automated testing | I | C | R | | |
| Acceptance of a release | A | R | C | | |
| Architecture proposals | I | A | R | | |
| Critical architecture decisions (identity, grants, tenancy, evidence) | I | A | R | | C |
| Security-path code review | I | A, R | C | | |
| Dependency and licence inventory | I | C | R | | A (lawyer, for clearance) |
| Production deployment | A | R | C | | |
| Production credentials and keys | A | R | | | |
| Incident response, technical | I | A | R | C (security agent, later) | C |
| Documentation | I | C | R | | |

## 2. Security assurance

| Activity | CEO | CTO | Claude | Agents | Spec |
|---|---|---|---|---|---|
| Security tooling and monitoring | I | A | R | | |
| Vulnerability triage | I | A | C | R (security agent, later) | |
| Penetration test scoping | A | R | C | | C |
| Penetration test execution | I | C | | | R, A (firm, for the report) |
| Remediation | I | A | R | | C (retest) |
| Customer security questionnaires | A | R | R (draft) | | |
| Security representations in contracts | A | C | | | C (lawyer) |
| Certification decisions | A | C | | | C |

## 3. Commercial

| Activity | CEO | Sales | Claude | Agents | Spec |
|---|---|---|---|---|---|
| Segment and pricing strategy | A | C | C | C (research) | |
| Prospect research | I | C | | R (prospecting agent) | |
| Prospect validation (is the account real and relevant) | A | R | | C | |
| Outreach drafting | A (sends) | C | | R (draft) | |
| Sending any external message | A, R | R | | | |
| CRM administration | I | C | | R (sales operations agent) | |
| Meeting preparation | A | C | | R | |
| Demonstrations | A, R | R | R (environment) | | |
| Proposals and pilot terms | A | R | C | R (draft) | C (lawyer) |
| Pricing commitments | A | C | | | |
| Contract negotiation and signature | A, R | R | | | C (lawyer) |
| Customer support, first line (future) | I | | R (tooling) | R (customer success agent, later) | |
| Customer escalations | A | | C | | |

## 4. Company, finance and legal

| Activity | CEO | Claude | Agents | Spec |
|---|---|---|---|---|
| Fundraising strategy and decisions | A, R | C (materials) | | C (lawyer) |
| Investor research | A | C | R | |
| Investor communications | A, R | C (drafts) | | |
| Legal documents | A | C (first drafts for counsel) | R (organize the data room) | R (lawyer) |
| Bookkeeping and tax filings | A | | | R (accountant) |
| Financial model and runway | A | R | C (finance agent, later) | C (accountant) |
| Payments and transfers | A, R | | | |
| Payroll and visas | A | | | R (provider) |
| Hiring decisions | A, R | | | |
| Insurance | A | | | R (broker) |

## 5. AI agent governance

| Activity | CEO | CTO | Claude | Agents |
|---|---|---|---|---|
| Agent registration in the internal AEGIS tenant | A | R | C | |
| Agent permissions and policies | A | R (second approver) | C | Never |
| Approving an agent's held action | A, R | R (within delegated limits) | | Never its own |
| Suspension and credential revocation | A, R | R | | |
| Agent performance and cost review | A | C | R (report) | |
| Changes to AEGIS enforcement policies | A | R | | Never |
