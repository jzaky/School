# AEGIS AI-first operating plan

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. How Nexus AI Assurance FZCO runs with a founder, Claude, a few internal agents and fractional specialists.

## 1. Principles

1. **Automate work that is repeatable, checkable and reversible.** Research, drafting, testing, documentation, data entry and reporting qualify.
2. **Keep humans where judgment, qualification, trust or accountability are required.** Architecture sign-off, security testing, legal advice, contracts, pricing commitments, money movement, filings and investor commitments stay with people.
3. **Every consequential agent action goes through AEGIS.** Each agent has an identity, scoped permissions, a policy and an evidence trail. No agent may change its own permissions, approve its own privileged action or erase its history.
4. **Buy before build.** Use off-the-shelf tools for CRM, accounting, email and scheduling. Claude builds AEGIS, not a second internal product.
5. **Measure before expanding.** An agent stays only if its measured output beats its measured cost and risk.

## 2. Who does what

| Party | Role | Time | Cost basis |
|---|---|---|---|
| Founder and CEO | Strategy, product priorities, sales, fundraising, partnerships, every external commitment, final approvals | Full time | AED 12,500 a month, proposed |
| Claude (Claude Code in this repository) | Implementation, tests, documentation, research, internal tooling, demo environments, progress reports | On demand | AI usage line |
| Fractional CTO | Independent architecture and security review, release readiness, second approver for security-relevant changes | About 1 day a week | AED 8,000 a month, assumption |
| Independent security firm | Penetration testing and gateway assessment | Fixed engagements | Quotations needed |
| Legal counsel | NDA, IP, investment documents, customer contracts, privacy | Engagements | Engagement letters needed |
| Accountant | Bookkeeping, tax registration and returns, financial statements | Monthly | Assumption: AED 1,000 a month |
| Fractional sales adviser | Introductions, sales strategy, negotiation support | From quarter 2, if gate G1 passes | AED 6,000 a month plus commission, assumption |
| Implementation partners | Channel into enterprises; integration delivery | Per deal | Margin on closed revenue |
| Internal agents | Prospect research, sales administration; later security triage | Scheduled | Agent execution line |

## 3. The founder bottleneck

The directive gives the founder strategy, sales, fundraising, partnerships, supervision of Claude and all approvals. Internal agents add approval work rather than removing it, because every external action they draft waits for the founder.

Ways to protect founder time:
- **Batch approvals.** Twice a day, through the AEGIS Approval Center.
- **Narrow agents.** Agents produce drafts and research, not decisions.
- **Weekly review.** One 60-minute review of agent output quality, cost and incidents.
- **Delegate technical approvals** to the fractional CTO, within written limits.
- **Defer anything** that needs daily founder attention without generating revenue.

## 4. Operating cadence

| Cadence | What happens |
|---|---|
| Daily | Approval queue. Claude's progress log in `docs/AEGIS_BUILD_PROGRESS.md`. CI status. |
| Weekly | Pipeline review: qualified opportunities, next steps, stalled deals. Agent output and cost. Security findings. |
| Monthly | Cash, burn and runway against the model. Gate review. Investor update draft, which the founder sends. |
| Quarterly | Strategy and budget review against the 12-month plan. Re-forecast all three scenarios. |

## 5. Controls on Claude's own work

Claude produces most of the code. Claude's output is not independently validated by Claude.
- **Human review on security paths.** Changes to identity, grants, row-level security, evidence, approvals or the gateway need a human review by the fractional CTO before release.
- **No production credentials.** Claude does not hold production credentials. Deployments are approved and run by an authorized person.
- **Repository protection.** The default branch needs branch protection, required CI, and a required review on the security paths above.
- **Provenance.** Commit trailers already record Claude's involvement. The founder should keep a written record of direction and review for IP provenance (see `AEGIS_INVESTOR_DUE_DILIGENCE_CHECKLIST.md`).

## 6. Expansion rules

- **New agent:** only after gate G4, with 60 days of measured cost and output and a comparison with a person or a SaaS tool.
- **Permanent hire:** only after gate G5, with a recurring need for 3 months and a comparison with contractors and automation.
- **First likely hire:** a customer delivery engineer once two annual contracts exist. Not a salesperson, and not a second engineer before then.
