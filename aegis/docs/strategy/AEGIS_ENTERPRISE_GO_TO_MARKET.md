# AEGIS enterprise go-to-market (UAE)

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. Every segment score, price and cycle time below is a hypothesis to test in discovery. No customer, prospect, partner or government body has expressed interest in AEGIS as far as the repository records. No outreach has been started.

## 1. Segment selection

Scores run from 1 to 5, where 5 favours AEGIS. They are judgments from the criteria in the directive, not market data.

**Columns:**
- **Sev:** severity of an unauthorized agent action.
- **Bud:** budget for security or AI infrastructure.
- **Int:** ease of integration with AEGIS's current connectors.
- **Proc:** speed of procurement.
- **Reg:** regulatory pressure.
- **Comp:** room left by competitors.
- **TTR:** time to first revenue.

| Segment | Sev | Bud | Int | Proc | Reg | Comp | TTR | Total |
|---|---|---|---|---|---|---|---|---|
| Digital-first financial services: digital banks, payments, lending, wallets | 5 | 3 | 4 | 3 | 4 | 3 | 3 | **25** |
| AI implementation partners and system integrators, as a channel | 3 | 2 | 4 | 4 | 3 | 4 | 4 | **24** |
| Large e-commerce and customer operations teams with refund and credit agents | 3 | 3 | 5 | 4 | 2 | 3 | 4 | **24** |
| Tier-1 banks | 5 | 5 | 2 | 1 | 5 | 3 | 1 | 22 |
| Insurers | 4 | 4 | 3 | 2 | 4 | 3 | 2 | 22 |
| Telecoms digital channels | 3 | 4 | 2 | 2 | 3 | 3 | 2 | 19 |
| Government entities | 4 | 4 | 2 | 1 | 5 | 2 | 1 | 19 |
| Enterprise IT and HR agents | 2 | 3 | 3 | 3 | 2 | 2 | 3 | 18 |

**Recommendation:**
- **Primary segment:** digital-first financial services.
- **Primary channel:** AI implementation partners that build agents for those companies.
- **Fastest proof point:** large customer operations teams whose agents issue refunds and credits. This is AEGIS's most complete workflow.
- **Second wave:** tier-1 banks and insurers, once an independent security test, insurance cover and a reference customer exist.
- **Government:** only through legitimate procurement and established partners, and only when an opportunity is published. Never on an assumption of access.

**Why not banks first?**
- Banks score highest on severity and budget, but lowest on procurement speed and time to first revenue.
- Vendor onboarding at a regulated bank commonly includes outsourcing and third-party risk assessments, information security due diligence and sometimes regulator notification. These can take longer than the 12-month plan.
- A bank will also ask for evidence AEGIS does not yet have: an independent penetration test, insurance certificates, financial statements and reference customers.
- Start conversations with banks in quarter 2 for learning and relationships, but do not plan year-1 revenue on them.

## 2. Competition to understand before pricing

Verify the current offerings before using any of this in sales material.
- **Platform vendors** are adding agent governance inside their own ecosystems: identity providers, CRM platforms, IT service management platforms and cloud AI platforms. Their controls tend to stop at their own platform boundary.
- **AI security vendors** focus on prompt and model-level protection, such as input and output filtering and model scanning, more than on action authorization with approvals and evidence.
- **API gateways and policy engines** can enforce rules on calls but do not provide agent identity, approvals, execution grants and an evidence ledger designed for agents.
- **Consulting-led frameworks** sell governance as an engagement rather than as installable software.

**The AEGIS position to test:**
- It works across agent frameworks and platforms.
- It enforces at the moment of action, with a signed one-time grant.
- It holds a person's approval bound to the exact parameters.
- It keeps evidence an auditor can verify.
- It can be deployed privately inside the customer's own UAE infrastructure. That last point is a capability of the deployment artifacts, not a residency certification.

## 3. Buyer personas

| Persona | Typical title | What they care about | Role in the deal |
|---|---|---|---|
| Economic buyer | COO, Head of Customer Operations, Head of Payments Operations | Losses from wrong refunds or payouts, operating cost, speed of rolling out agents | Signs the budget |
| Technical owner | Head of AI, engineering lead for the agent platform | Integration effort, latency, frameworks supported, deployment model | Champion or blocker |
| Risk approver | CISO, Chief Risk Officer, Head of Compliance, DPO | Authorization, audit evidence, data handling, regulatory exposure | Must approve |
| Daily user | Operations supervisors, finance approvers | Clear approval requests, fast decisions on mobile | Adoption |
| Procurement | Vendor management | Company documents, security questionnaire, insurance, contract terms | Gatekeeper |
| Partner | Practice lead at an AI implementation firm | A safe way to put agents in production for their clients, and a margin | Channel |

## 4. Customer discovery process

1. **Target list.** 30 accounts in the primary segment and 10 partners, researched by the founder, later with help from the prospecting agent. Each account needs public evidence of AI agent or automation use.
2. **Interviews.** 30 to 45 minutes, a problem interview with no demo. Aim for 10 in the first 6 weeks and 20 by the end of quarter 2.
3. **Logging.** Record every interview in the CRM with answers to the questions below and a qualification score.
4. **Qualification criteria.** All five must be met:
   - Agents in production or planned within 6 months.
   - A consequential action the agent takes or will take.
   - A named sponsor.
   - A budget owner identified.
   - A procurement path that could reach a paid pilot within 4 months.
5. **Synthesis.** A monthly synthesis covering segment fit, pain ranking, price signals and objections. Change the plan when the evidence says so.

### Discovery questions
1. Which AI agents or automations do you run today, and which will you run in the next 12 months?
2. Which of them can take an action with consequences: moving money, changing records, contacting customers or granting access?
3. What stops an agent from doing something it should not do today? Who checks?
4. Tell me about the last time an automated action went wrong. What did it cost, and how long did it take to find?
5. Who has to approve putting an agent into production? What evidence do they ask for?
6. How do you prove afterwards which agent did what, and who allowed it?
7. Which regulations or internal policies apply to these agents? Who interprets them for you?
8. Where must the system run: your cloud, on-premises, or a UAE region?
9. Which agent frameworks and platforms do you use?
10. What tools do you use for this today: platform controls, an API gateway, internal code?
11. If an agent could only act with a signed permission for that exact action, what would that change for you?
12. Who owns the budget for this, and from which line: security, operations or AI?
13. What would a successful 8-week pilot have to show for you to buy?
14. What does your vendor onboarding involve, and how long does it usually take?
15. What would you expect a tool like this to cost per year? At what price would you question its quality? At what price would it be too expensive?

## 5. Pilot proposal (template)

**Scope.** One workflow, such as refunds and credits, payouts or transfers. One to three agents. One downstream system.

**Duration.** 8 to 10 weeks, in three stages:
1. **Observe (weeks 1 to 3).** Export recent agent actions and replay them against a draft policy with AEGIS's replay feature. This shows how many actions would have been allowed, held or refused, and the approver workload. Nothing is enforced, and no production credentials are shared. This stage needs only historical exports.
2. **Enforce in a sandbox (weeks 4 to 6).** The agent goes through the AEGIS gateway in the customer's test environment. Approvals run through the Approval Center. Evidence is exported.
3. **Limited production (weeks 7 to 10).** This stage is optional and requires gate G3. One agent runs with low thresholds and every action above the threshold approved by a person.

**Deployment.** Inside the customer's environment, using the Kubernetes or Compose artifacts, or a dedicated environment hosted by Nexus in a UAE cloud region. Hosting location is a deployment choice. Do not describe it as a residency certification.

**Success criteria, agreed in writing before the start, for example:**
- 100% of the workflow's actions decided by policy.
- No action executed without a valid grant in the evidence export.
- Approver decision time below an agreed median.
- Integration completed within an agreed effort.

**Price hypothesis.**
- AED 25,000 to 40,000, depending on scope.
- Integration work beyond one connector quoted separately.
- 100% of the pilot fee credited to an annual licence signed within 60 days of pilot end.

**Exit.** The customer keeps the evidence export. Nexus deletes customer data within an agreed period.

## 6. Demonstration scripts

All three use the synthetic Meridian Gulf Bank demo tenant. It must be presented as made-up demo data.
1. **Refund authority (8 minutes).**
   - The support agent's AED 180 refund executes on its own.
   - The AED 1,450 refund waits for a supervisor, who approves from the Approval Center. The decision shows which rule applied and how close the amount was to the limit.
   - An AED 6,200 refund is refused.
   - A tampered resubmission with a changed amount is rejected.
   - Close on the evidence record and the replay of the policy over 30 days.
2. **Treasury transfer, AED 250,000 (6 minutes).**
   - AED 12,500 goes through.
   - AED 250,000 needs a manager, and nothing executes until approval.
   - AED 1,500,000 is denied and raises a security event.
   - Then show the emergency revoke: one action suspends the agent, revokes its keys and delegations, and closes its pending approvals.
3. **Agent identity and containment (6 minutes).**
   - Agent discovery shows an unregistered agent.
   - A temporary access request is approved by someone other than the requester.
   - The least-privilege suggestions appear.
   - Continuous governance suspends an agent on an alert, and a person reverses it.

## 7. Security questionnaire: honest starting answers

| Question | Answer today |
|---|---|
| Independent penetration test | Not yet performed. Planned before any production pilot. |
| SOC 2 or ISO/IEC 27001 certification | No. Not certified. |
| Encryption at rest | Credentials, SSO secrets and MFA secrets are encrypted with a master key. Database and disk encryption depend on the deployment. |
| Encryption in transit | TLS at the edge in the provided deployment configuration |
| Tenant isolation | PostgreSQL row-level security on tenant tables, with automated isolation tests. Some platform tables are outside row-level security (being fixed). |
| Authentication | Passwords hashed with argon2id, TOTP MFA, OIDC and SAML single sign-on, SCIM provisioning, organization-enforced MFA |
| Audit logging | Append-only evidence ledger with a hash chain and signed checkpoints, exportable |
| Data residency | Can be deployed in the customer's chosen environment, including UAE cloud regions or on-premises. Not certified for residency. |
| Use of AI providers | AEGIS itself calls no external AI provider |
| Subprocessors | None for self-hosted deployments. For hosted pilots, the cloud provider chosen. |
| Incident response plan | To be written and tested before gate G3 |
| Business continuity and backups | Backup and restore procedure documented. One manual restore was performed. Automation is pending. |
| Insurance | To be confirmed |
| Personnel security | Founder plus contractors. Background checks per contract. |

## 8. Pricing hypotheses

| Item | Hypothesis | How to test it |
|---|---|---|
| Paid pilot | AED 25,000 to 40,000 | Discovery question 15, then proposals to the first five qualified accounts |
| Annual licence, up to 10 agents | AED 120,000 to 180,000 | Discovery, partner feedback, the first proposals |
| Annual licence, up to 50 agents | 1.8 to 2.5 times the 10-agent price | Later, with more data |
| Integration services | Day rate, quoted per connector | Partner benchmarks |
| Continuous governance and AEGIS Trading | Options priced as a percentage uplift | Later |

Prices stay off the public site until at least five proposals have been tested. This matches the current pricing page.

## 9. Procurement checklist

Prepare before the first proposal:
- Trade licence and commercial registration documents.
- Tax registration certificates.
- Company profile and ownership.
- Bank letter.
- Insurance certificates.
- Security questionnaire answers (section 7).
- Architecture and data-flow document (`docs/AEGIS_ARCHITECTURE.md`, adapted).
- Data processing terms.
- Master subscription agreement and order form.
- Service level terms for hosted pilots.
- Incident response plan.
- Business continuity summary.
- The open source licence inventory (`docs/THIRD_PARTY.md`).
- References, when available.

## 10. Partnership proposal (outline)

**Partner profile.** An AI implementation firm or systems integrator building agents for UAE financial services or customer operations.

**Offer to the partner:**
- A safe production path for their clients' agents.
- Demo environment access.
- Joint discovery.
- A referral or resale margin on closed revenue.
- Training on policy templates.

**Nexus asks:**
- Introductions to qualified accounts.
- Joint pilots.
- Feedback on integration effort.

**Agreement.** A short referral agreement drafted by counsel. No exclusivity in year 1.

## 11. Converting pilots to annual contracts

- **Agree the annual price and terms before the pilot starts.** Use a pilot order form with an annual option at a stated price.
- **Credit the pilot fee** against the annual licence within 60 days of pilot end.
- **Mid-pilot review in week 5.** Check the success criteria and confirm the sponsor still has budget.
- **Close-out report.** Results against the criteria, the evidence export, approver statistics and the policy replay.
- **Name the next workflow** in the close-out to grow the agent count and the tier.
