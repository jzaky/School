# Nexus AI agent roadmap

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. No agent described here has been built or deployed. Implementation waits for the founder's approval and for the dependencies in section 3.

## 1. Feasibility summary

| Agent | Directive priority | Recommendation | Build now? |
|---|---|---|---|
| 1 Engineering | High | **Do not build a new agent.** It exists in practice as Claude Code working in this repository with CI. Formalize its controls instead. | Controls only |
| 2 Enterprise prospecting | High | **Build first, narrowly.** It produces account briefs and outreach drafts. A person checks every fact and sends every message. | Yes, after dependencies D1 to D3 |
| 3 Sales operations | High | **Build second, on an off-the-shelf CRM.** It updates records, drafts follow-ups and prepares meeting briefs. It never sends or commits. | Yes, after the first 10 discovery interviews |
| 4 Security operations | Future | **Wait.** Start with off-the-shelf scanners in CI. Add an agent only for triage once findings volume justifies it. | No, and not before month 6 |
| 5 Customer success | Future | **Wait for customers.** There is nothing to support until a pilot is signed. | No, and not before the first pilot |
| 6 Finance and investor operations | Future | **Defer beyond year 1.** An accountant plus the spreadsheet model is cheaper and safer at this volume. | No |

## 2. Agent specifications

### Agent 1: engineering (controls, not a new agent)
- **What exists.** Claude Code commits to a feature branch, runs typecheck, lint, the em dash check and the test suites, and pushes. CI runs the same checks plus the browser suite.
- **Controls to add:**
  - Branch protection on the default branch.
  - Required CI.
  - Required human review (the fractional CTO) on identity, grants, row-level security, evidence, approvals and gateway paths.
  - No production credentials in the development environment.
  - Releases are tagged by a human.
- **Metrics:**
  - Accepted changes.
  - Changes reverted.
  - CI first-pass rate.
  - Review findings per change on security paths.
  - Lead time from request to merged change.
  - Defects found after release.

### Agent 2: enterprise prospecting
- **Inputs.** Public company information, such as annual reports, regulator registers, press releases and job postings that mention AI agents. Plus the segment criteria in `AEGIS_ENTERPRISE_GO_TO_MARKET.md`.
- **Outputs:**
  - Account briefs: the company, why it is relevant, public evidence of AI agent use, the regulatory pressure it faces, the likely buyer roles and the source links.
  - A qualification score against the published criteria.
  - Outreach drafts.
- **Personal data.**
  - Role-level research by default ("Head of Customer Operations").
  - Named individuals only from sources they published professionally themselves.
  - No automated collection from platforms whose terms forbid it.
  - No purchased contact lists without a lawful basis and the founder's approval.
  - Counsel confirms the approach under the UAE PDPL and, for any EU contacts, GDPR.
- **Restrictions, enforced by AEGIS policy:**
  - It cannot send anything.
  - Outbound actions do not exist for this agent. Drafts go to a review queue.
  - Every claim about AEGIS in a draft must come from an approved claims list taken from the Proof page.
- **Metrics:**
  - Briefs accepted without correction.
  - Factual errors found per brief.
  - Qualified accounts.
  - Meetings that came from agent-researched accounts.
  - Cost per accepted brief.

### Agent 3: sales operations
- **Tooling.** An off-the-shelf CRM chosen by the founder. The agent works through the CRM's API with a key that can only edit records, never delete them or export everything.
- **Outputs:**
  - Pipeline updates after meetings, from the founder's notes.
  - Follow-up drafts.
  - A weekly pipeline report with stalled deals flagged.
  - Meeting briefs.
  - Proposal first drafts from approved templates.
- **Restrictions, enforced by AEGIS policy:**
  - No external sends, no price or discount fields, no contract status changes.
  - Every CRM write goes through the AEGIS gateway with a generic connector, and bulk changes need approval.
- **Metrics:**
  - Founder hours saved per week, which the founder estimates.
  - Follow-ups sent on time.
  - CRM accuracy on a monthly spot check.
  - Forecast against actual.

### Agent 4: security operations (later)
- **Start with tools, not an agent.** Dependency and container scanning in CI, plus a secret scanner.
- **An agent is added only if needed.** It triages scanner output into a weekly report with proposed fixes. A person decides, and the agent has no write access to infrastructure.
- **Gate.** Findings volume that costs the CTO more than 2 hours a week.

### Agent 5: customer success (later)
- **Gate.** The first signed pilot.
- **Start.** A knowledge base built from `docs/` and approved answers, and ticket classification.
- **No access to customer production data.** Sensitive cases go to a person.

### Agent 6: finance and investor operations (deferred)
- **Gate.** More than 50 transactions a month, or a finance person to supervise it.
- **Until then.** The accountant keeps the books. The financial model script and a monthly spreadsheet cover runway. The founder writes investor updates, and Claude may draft them from the model.

## 3. Dependencies before any agent runs

| ID | Dependency | Where it is tracked |
|---|---|---|
| D1 | AEGIS deployed in a production configuration approved by the founder, with backups, and with a separate internal tenant that is not a demo tenant | Technical roadmap Phase 13 and 14 items |
| D2 | Security findings S8, S9 and S10 fixed. A regression test proves agent keys cannot change policies, agents, approvals or keys. | `docs/AEGIS_FULL_PLATFORM_AUDIT.md` |
| D3 | A generic outbound connector, such as an HTTPS webhook with a destination allowlist, so internal actions can be governed through the gateway | Technical roadmap Phase 8, cut down to what is needed |
| D4 | A second human approver with rights in the internal tenant | Fractional CTO engagement |
| D5 | Counsel's view on prospect research under the UAE PDPL | Legal workstream |

## 4. Order

1. Engineering controls. No new build: settings and a review rule.
2. Prospecting agent pilot for 30 days, on 20 accounts, with every brief checked by the founder. Measure the error rate.
3. Sales operations agent after the first 10 discovery interviews and once a CRM is chosen.
4. Review at 60 days (gate G4). Keep, change or stop each agent.
5. Security, customer success and finance agents only after their gates.
