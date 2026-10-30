# AEGIS master business plan

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Nexus AI Assurance FZCO. Prepared 2026-10-13 from the founder's strategic planning directive and an inspection of this repository. Nothing here is a claim of customers, revenue, investment, certification, partnership or deployment. None of those exist in the repository.

## 1. The company

**Nexus AI Assurance FZCO** builds **AEGIS**, the control and accountability layer between AI agents and consequential real-world actions. That positioning is the strategic objective. Section 3 records what exists today.

AEGIS answers eight questions for every agent action:
1. Which agent is acting?
2. What is it attempting to do?
3. Is it authorized?
4. What risk does the action introduce?
5. How certain is the system about the decision?
6. What evidence supports it?
7. Should it proceed, be restricted or wait for approval?
8. Can the enterprise prove afterwards what happened?

The repository answers questions 1 to 4, 6, 7 and 8 with working code today, within the limits in section 3. Question 5 is the unbuilt uncertainty engine, Phase 4 of the technical roadmap.

**Operating model:** a founder and CEO, Claude as the primary implementation resource, a small number of internal AI agents, and a few fractional human specialists. Human specialists are bought for independent judgment, professional qualification, trust and accountability.

## 2. Strategy in one page

1. **Sell one painful workflow first.** The first workflow is agents with money-movement authority: refunds, credits, payouts and transfers. It is AEGIS's most complete workflow. Its damage is measured in money, so buyers understand it without a framework discussion. See `AEGIS_ENTERPRISE_GO_TO_MARKET.md`.
2. **First buyers.** Start with digital-first regulated businesses (fintechs, payments, digital insurers, large e-commerce and customer operations teams). Reach them directly and through the AI implementation partners that build agents for them. Treat tier-1 banks as the second wave, once an independent security test, insurance and a reference exist. This departs from the directive, which leads with banks. The reason is time to first revenue: bank vendor onboarding commonly takes longer than the 12-month plan allows.
3. **Paid pilots of 8 to 10 weeks** at a hypothesis of AED 25,000 to 40,000. Success criteria are agreed in writing, and the pilot fee is credited against an annual licence.
4. **Annual licence per deployment, tiered by registered agents.** This matches the existing pricing page. AED 150,000 a year for a regulated buyer is a hypothesis to test in discovery.
5. **Raise only what the gates need.** Release spending by milestone (see `AEGIS_INVESTMENT_USE_OF_FUNDS.md` section 4). Settle the legal and IP position before closing.
6. **Use AEGIS on ourselves**, in a separate internal tenant, for the three agents worth running now. Do not build a custom company dashboard in year 1. See `NEXUS_AI_AGENT_ROADMAP.md`.

## 3. Repository audit (directive Part 21)

Each item gives the evidence and its location.

### 3.1 What AEGIS already supports (implemented and tested in this repository)
- **Action Gateway.** Agents submit actions through `packages/core/src/gateway/gateway.ts`.
  - **Six outcomes:** allow, deny, require approval, restrict, quarantine and request more information. The default is deny.
  - **Signed execution grants**, bound to the request, the parameters and the integration (`gateway/grants.ts`).
  - **One live grant per request**, three-phase execution and reconciliation of ambiguous outcomes.
- **Policy engine.** Deterministic evaluation with a decision trace, versioning, four-eyes activation, rollback and replay of the last 30 days against a draft (`packages/core/src/policy`).
- **Approvals.** Eligibility rules and separation of duties. Requesters and agent owners cannot approve. The approval is bound to a hash of the parameters, and requests expire and escalate (`approvals/service.ts`).
- **Evidence.** An append-only ledger with a hash chain, Ed25519-signed checkpoints, verification and export (`evidence/ledger.ts`).
- **Agent identity.** Registry, purpose, allowed destinations, expiring credentials and tools, delegation between agents, temporary access requests, least-privilege suggestions, discovery of unregistered agents, and one-step emergency revocation (`packages/core/src/agents`).
- **People identity.**
  - Password login with argon2id hashing.
  - TOTP multi-factor authentication with replay protection and a lockout.
  - OIDC and SAML single sign-on bound to the organization, and SCIM provisioning.
  - API keys with scopes. An agent key cannot carry the provisioning or grant-verification scopes.
- **Tenant isolation.** PostgreSQL row-level security on tenant tables, with an isolation test suite (`packages/db/tests/isolation.test.ts`).
- **Shield.** Sensitive data detection on parameters, destination allowlists, injection heuristics, security events and incidents.
- **Assurance and Audit.** Twelve deterministic monitoring rules, optional automatic containment responses, and 21 framework catalogs holding 487 original control summaries. Includes document assessment, remediation tracking and reports.
- **Developer surface.**
  - TypeScript SDK with guards for the OpenAI Agents SDK, LangChain, LangGraph and Anthropic tool use.
  - A Python SDK.
  - An MCP gateway proxy.
- **Deployment artifacts.** Dockerfile, Compose, Kubernetes manifests, systemd units and step-by-step deployment docs (`deploy/`, `docs/DEPLOYMENT.md`).
- **Automated tests:**

| Suite | Tests |
|---|---|
| Core | 253 |
| Database isolation | 11 |
| API | 13 |
| SDK | 15 |
| MCP gateway | 6 |
| Python SDK | 8 |
| Browser specs | 85 tests in 17 files |

### 3.2 What is incomplete or missing
- **Technical roadmap phases 3 to 15 are not started.** That covers managed autonomy levels 0 to 4, the uncertainty engine, reasoning governance and the Decision Inspector, the attack simulation lab, model lifecycle and data governance, the integration marketplace, policy conflict detection and inheritance, the new control center navigation, UAE deployment options, metering and billing, failure injection, distributed tracing, dead-letter queues and benchmarks.
- **Open security findings** from `docs/AEGIS_FULL_PLATFORM_AUDIT.md` section 4:
  - **S8:** users, sessions, jobs and organizations are outside row-level security, and the worker trusts the organization named in a job payload.
  - **S9:** evidence signing is optional and its keys cannot be rotated.
  - **S10:** demo reset disables append-only triggers for all tenants, and the demo uses a shared password.
  - **S13:** reports are generated on read permission.
  - **S14:** rate limits are per process.
  - **S15:** the public form is unthrottled, and the readiness endpoint exposes database errors.
- **Operations:** no dead-letter queue, no backup automation, no data residency configuration, and notifications are in-app only.
- **Commercial:** no billing, metering, CRM or payment code. The billing page shows plan and counts only, and its portal button is disabled.

### 3.3 Does an agent orchestration system exist?
**No.** No code in the repository calls an AI model, runs agents or schedules agent tasks. The worker runs AEGIS's own maintenance jobs: approval and request expiry, execution reconciliation, evidence checkpoints, enforcement audits, retention and monitoring. AEGIS governs agents that other systems run. Nexus AI Operations would need a runtime that does not exist here, and it should not live in this codebase (see `NEXUS_AI_OPERATIONS_ARCHITECTURE.md`).

### 3.4 Can AEGIS govern Nexus's own agents safely?
**Partly, today. Fully, after five dependencies are met.**

**Already true:**
- An agent's API key carries no permissions. Policy, agent, approval and key changes all require a person's permission in core services (`orgs/orgs.ts` assertPermission).
- Requesters cannot approve their own requests.
- Evidence is append-only.
- Revocation is one step.

**Five gaps:**
1. **No explicit test** proves that an agent key cannot write policies, and the policy routes rely on the permission check rather than a scope check.
2. **Demo reset can disable the append-only triggers** (S10). The internal tenant must never be a demo tenant, and S10 should be fixed.
3. **The only real connectors are Stripe test mode and Alpaca paper.** Internal actions such as sending email, updating a CRM or opening a pull request have no real connector. Governing them needs a generic outbound connector (an HTTPS webhook or email connector with a destination allowlist).
4. **A one-person company cannot satisfy four-eyes rules.** A second qualified human approver is required.
5. **AEGIS is not yet deployed** in a production configuration that the founder has approved.

### 3.5 Reusable components for Nexus AI Operations
Everything an internal tenant needs for governance already exists:
- Agent registry, scoped API keys, the gateway and policies.
- Approvals with separation of duties, the Approval Center, evidence and monitoring.
- Emergency revocation, autonomy posture per agent and the SDK guards.

The missing pieces are a runtime that executes agent tasks, real connectors for internal tools, and business data such as CRM and finance. That data should come from off-the-shelf tools, not new code.

### 3.6 Integrations: functional versus simulated

| Integration | Status | Evidence |
|---|---|---|
| Stripe refunds (test mode) | Real code, run only against a fake Stripe server | `gateway/connectors/stripe.ts`, `scripts/stripe-sandbox-check.mts` not yet run |
| Alpaca paper trading | Real code, run only against a fake server | `gateway/connectors/alpaca.ts`, waiting for a paper key |
| Core banking, support platform, email, CRM, data warehouse, brokerage | In-process simulators | `gateway/simulators.ts` |
| OIDC and SAML single sign-on, SCIM | Real protocol code, tested against local providers, not against Entra ID or Okta tenants | `identity/oidc.ts`, `identity/saml.ts`, `identity/scim.ts` |
| Zendesk, Intercom, PayPal, Adyen, Slack and Teams approvals | Listed as planned on the site only | `apps/web/src/components/marketing/home.tsx` |
| OpenAI Agents SDK, LangChain, LangGraph, Anthropic tool use, MCP | SDK wrappers and a proxy, tested with fakes, not against live providers | `packages/sdk`, `packages/mcp-gateway` |

**Correction needed.** The public site labels Stripe and Alpaca "Sandbox tested". The detail text says they were verified against fake servers. The label overstates the evidence and should read "Tested against a local fake; sandbox run pending" until the real sandbox scripts run. This is a one-line change to the marketing component, held for the founder's approval.

### 3.7 Security controls: verified versus needing independent assessment

| Control | Verified by automated tests here | Needs independent assessment |
|---|---|---|
| Tenant isolation (row-level security) | Yes, 11 isolation tests | Yes. Tables outside row-level security (S8) need fixing first. |
| Gateway default deny and the six outcomes | Yes | Yes. Bypass and policy evasion attempts. |
| Signed grants bound to request and integration | Yes | Yes. Token forgery, replay and confusion between integrations. |
| Approval binding and separation of duties | Yes | Yes |
| SSO, MFA and SCIM | Yes, against local test providers | Yes, against a real Entra ID or Okta tenant |
| Evidence integrity | Yes, chain verification | Yes. Signing is optional (S9) and needs fixing first. |
| Prompt injection heuristics | Yes, heuristic tests only | Yes. These are heuristics, not a guarantee. |
| Production configuration | No production deployment verified | Yes |

**No independent penetration test or security audit has been performed.** `docs/OVERVIEW.md` and `docs/IMPLEMENTATION_REPORT.md` both say so. Passing automated tests written by the same AI that wrote the code is not evidence of enterprise readiness.

### 3.8 Does the existing roadmap conflict with the business-agent roadmap?
**Yes, on capacity, sequence and legal risk.**
- **Capacity.** The 15-phase technical program is large. Phase 8 alone names 17 integrations. Building Nexus AI Operations alongside it would split Claude's capacity and the founder's review time.
- **Sequence.** The penetration test in month 4 should test hardened code. Phase 13, security hardening, is scheduled near the end of the roadmap.
- **Legal risk.** Phases 3 to 5 (managed autonomy, uncertainty and reasoning governance) are conceptually close to publicly described DNRS ideas. The directive budgets an NDA review with DNRS. That review should come before further work on those phases.

The proposed changes are in section 5. They need the founder's approval.

### 3.9 Would the agent system distract from product readiness?
**A custom Nexus AI Operations platform would.** The dashboard specification has 25 capabilities. Much of it, including CRM, pipeline, expenses, runway, subscriptions and scheduling, already exists in inexpensive off-the-shelf tools. Three narrow agents using existing tools, governed by an internal AEGIS tenant, would not distract. That setup also produces the best demo: AEGIS governing its own company.

### 3.10 Financial assumptions that need external validation
See `AEGIS_12_MONTH_FINANCIAL_MODEL.md` section 6. Every price, salary, fee, cycle time and premium needs validation. So do the valuation and the investor's appetite.

## 4. Where this plan disagrees with the directive

1. **First segment.** Lead with digital-first regulated businesses and implementation partners, not banks. Banks follow once trust evidence exists.
2. **Valuation.** AED 9,000,000 pre-money, for a pre-revenue company with one founder, no human engineering team, AI-authored code and unassigned IP, is at the optimistic end of what a pre-seed investor is likely to accept. Consider a convertible instrument with a valuation cap, or a tranche tied to milestones. See `AEGIS_FUNDRAISING_STRATEGY.md`.
3. **Sales spend.** Fund commissions from revenue and release adviser and event spend after demand is validated.
4. **Nexus AI Operations dashboard.** Do not build it in year 1. Govern three agents in an internal AEGIS tenant and use off-the-shelf CRM and accounting tools.
5. **Engineering agent.** Do not build one. It already exists in practice: Claude Code working in this repository with CI. Formalize its controls instead (branch protection, required human review on security paths, no production credentials).
6. **Finance agent.** Defer it past year 1. Bookkeeping by an accountant plus a spreadsheet model is cheaper and safer at this transaction volume.
7. **Legal first.** Settle the NDA, IP assignment, repository ownership and trademark in month 1, before closing and before more autonomy-related work.
8. **Revenue targets.** Two annual contracts in 12 months is possible but not the planning base for investor conversations. Present the conservative case as the plan the money must survive.

## 5. Proposed changes to the technical roadmap (need approval)

| Proposal | Reason |
|---|---|
| Finish Phase 2 (agent identity), which is in progress, then do the pilot-blocking parts of Phase 13 (S8, S9, S10, S13, S15) and Phase 14 (S14, dead-letter queue, backups) before Phases 3 to 5 | The penetration test should test hardened code, and pilots need these fixes |
| Hold Phases 3 to 5 until counsel has reviewed the DNRS NDA, then resume with a written clean-room record | Protects the IP position that investors will examine |
| Cut Phase 8 from 17 integrations to the ones a named pilot needs. Likely candidates: Slack or Teams approvals, one ticketing system, OpenTelemetry export, and a generic HTTPS connector. | Integrations without a customer are inventory, not progress |
| Defer automated metering and billing in Phase 12. Invoice manually until there are more than five customers. | No customer needs automated billing in year 1 |
| Add an explicit regression test that agent keys cannot change policies, agents, approvals or keys, and add scope checks on every mutating route | Prerequisite for governing internal agents |
| Run the real Stripe and Alpaca sandbox checks once keys are provided, and correct the "Sandbox tested" label until then | Public claims must match evidence |

## 6. Related documents
See `STRATEGY_INDEX.md`.
