# Nexus AI Operations architecture

STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION

Prepared 2026-10-13. A target architecture for running Nexus's internal agents under AEGIS governance. Nothing here is built.

## 1. Separation of planes

```
+------------------------------+        +-------------------------------------+
| Agent runtime (business)     |        | AEGIS control plane (enforcement)   |
| - scheduler                  | submit | - gateway, policies, approvals      |
| - agent workers              +------->+ - evidence ledger, monitoring       |
| - prompt and tool config     |        | - agent registry, keys, revocation  |
| - no policy write access     |<-------+ - decisions, grants                 |
+------------------------------+ grant  +------------------+------------------+
                                                           | execute via connector
                                                           v
                                        +-------------------------------------+
                                        | Tools: CRM, email drafts, GitHub,   |
                                        | research sources                    |
                                        +-------------------------------------+
```

**Rules:**
1. The agent runtime and the AEGIS control plane are separate deployments with separate credentials. The runtime holds only agent API keys with gateway scopes.
2. Tool credentials for consequential actions live in AEGIS integrations, not in the runtime. The runtime cannot call the CRM's write API or send email directly. It submits an action, and AEGIS executes through a connector after policy and approval.
3. Read-only research tools, such as web search and public documents, can run in the runtime directly. They are logged by the runtime, and their outputs are drafts.
4. Internal agents live in their own AEGIS organization, `nexus-internal`. It is not a demo tenant, so demo reset can never touch it.
5. Policy, agent, key and integration changes require a person with permission in that organization, with four-eyes activation. No agent key has a scope that reaches them.
6. Every decision, approval and execution lands in the append-only evidence ledger with signed checkpoints.

## 2. Components

| Component | Build or buy | Notes |
|---|---|---|
| Agent runtime | Buy or use a framework | The Claude Agent SDK or a comparable framework, run as a scheduled job. Not part of the AEGIS codebase. |
| Scheduler | Use what exists | A cron job or the hosting platform's scheduler |
| Governance | Reuse AEGIS | Registry, keys, gateway, policies, approvals, evidence, monitoring, revocation, posture |
| Generic outbound connector | Build in AEGIS | Also a customer feature: HTTPS calls to allowlisted destinations with the AEGIS grant attached |
| CRM | Buy | Off-the-shelf |
| Accounting | Buy | The accountant's system |
| CEO dashboard | Defer | Use the AEGIS console for agents and approvals, the CRM for pipeline, and a monthly model for cash. Build a dashboard only after gate G4. |

## 3. The 25 dashboard capabilities mapped to what exists

| Capability | Where it lives in year 1 |
|---|---|
| Agent registry, identities, permissions, autonomy posture | AEGIS console, Agents |
| Approval queues, human escalation | AEGIS console, Approvals |
| Execution logs, failure monitoring, operational alerts | AEGIS console, Activity and Alerts |
| Emergency suspension, credential revocation | AEGIS console, Agents, emergency revoke |
| Security findings | AEGIS Shield, plus CI scanners |
| Task scheduling, workflow orchestration | Agent runtime scheduler |
| Agent operating costs, task performance | Monthly report from provider billing, drafted by Claude |
| Sales pipeline, prospects, meetings, onboarding | CRM |
| Infrastructure spend, operating expenses, cash runway, revenue, subscriptions | Accountant's records plus the financial model |

**Data labels.** Any view must label data as one of:
- Live.
- Verified historical.
- Simulated demonstration.
- Estimate or forecast.

The AEGIS console already labels demo organizations ("Demo mode: made-up demo data"). The internal tenant must have demo mode off.

## 4. Threats specific to self-governance

| Threat | Control |
|---|---|
| An agent edits its own policy | No API key scope reaches policy routes. Core services require a person's permission. A regression test should be added (dependency D2). |
| An agent approves its own action | Approval rules exclude the requester, and agents have no approval permission |
| An agent hides its actions | Append-only evidence with a hash chain and signed checkpoints. Demo reset excluded (S10 fix). |
| Prompt injection from prospect web pages makes the agent leak data or send messages | No send capability. Shield inspection on parameters. Destination allowlist. Drafts reviewed by a person. |
| A runtime compromise exposes tool credentials | Consequential tool credentials sit in AEGIS integrations, not in the runtime |
| The founder is the only approver | A second approver (the fractional CTO) is required, and policy changes need four-eyes |
