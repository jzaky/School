# AEGIS in plain language: what it is, why it exists, what we built

This is the one document to read first. It explains the product without assuming you have read the specification or the code. Every claim in it is backed by a test, a screenshot or a document elsewhere in `docs/`, and where something is a plan rather than a built thing, it says so.

## The problem

Companies are starting to let AI agents do real work: move money, issue refunds, send emails to customers, pull reports from data warehouses, merge code. Each of those actions can cause damage if the agent is wrong, manipulated, or simply operating outside what anyone agreed to. Today most organisations have no answer to five questions:

1. Which AI agents do we have, and what is each one allowed to do?
2. When an agent acts, who or what decided it was allowed, and can we prove it later?
3. When an action is risky, how does a human get pulled in before it happens, not after?
4. How do we stop an agent right now if something goes wrong?
5. When a regulator or auditor asks how we govern AI, what do we show them?

AEGIS is a control layer that sits between AI agents and the systems they act on. Agents do not call the bank, the CRM or the email system directly. They ask AEGIS, AEGIS decides, and only an action AEGIS approved can execute. Every step is recorded in a ledger that cannot be quietly edited.

The design principle behind the whole thing is "autonomous when certain, accountable when uncertain". Policy, written by the organisation, says which actions are routine enough to run on their own, which must wait for a named human, and which are never allowed. The agent does not get to choose.

## The four products

AEGIS is one platform with four products that share one database, one identity system and one evidence ledger.

### 1. AEGIS Control: decide and enforce

- Agent registry. Every agent is registered with an owner, a purpose, a risk tier, a lifecycle state (draft, active, suspended, revoked) and explicit grants to specific tools and resources. An unknown agent gets nothing.
- Policy engine. Policies are written in a documented JSON language (20 operators, nested all/any/not conditions, effects allow, deny, require approval). Evaluation is deterministic, meaning the same input always gives the same answer, with a full trace of which rule fired and why. Policies have versions (draft, review, active, retired), need a second person to activate (four-eyes), and can be rolled back.
- Action gateway. The single door every action goes through. It checks the agent, the tool grant, the parameters against a schema, the data classification, the destination, and the Shield data protection rules, then evaluates policy. The outcome is one of three: allow, require approval, deny. Allowed actions receive a single-use execution grant valid for five minutes and bound to the exact parameters. The downstream system verifies that grant before acting, so a tampered or replayed request fails.
- Human approval center. When policy says a human must decide, a request appears for eligible approvers. Eligibility checks role, permission, and separation of duties (the agent's owner cannot approve their own agent). Approvers see what the agent wants to do and why, and can approve, reject, ask for more information, escalate or reassign. Requests expire. A decision is bound to a hash of the request, so nothing can change under the approver's feet.
- Emergency controls. Suspend or revoke an agent (revocation kills its API keys, pending grants and pending approvals in one step), revoke a tool grant, disable a tool or integration, revoke a credential, or pause the whole gateway for the organisation.

### 2. AEGIS Assurance: prove it

- Evidence ledger. Every decision, approval, execution, policy change and administrative action is written as an event in a per-organisation hash chain. Each event's hash includes the previous event's hash, so deleting or editing one breaks the chain at a visible point. Signed checkpoints (Ed25519) let anyone with the public key verify an exported ledger independently. Database triggers make the evidence tables append-only even for the application role.
- Governance dashboard. Live metrics computed from the records, not from a separate counter: decisions by outcome, approval turnaround, agents by state, open alerts, chain status.
- Risk monitoring. Eleven deterministic rules (for example, repeated denials for one agent, approvals expiring unanswered, credentials near expiry, unusual volume) that raise alerts with a dedupe key so the same condition does not spam.
- Policy history. Who changed what, when, and which version was live at any moment.
- Compliance evidence mapping. AEGIS records are mapped to controls in ISO/IEC 42001, ISO/IEC 27001:2022, NIST AI RMF and ten further catalogs (EU AI Act, GDPR, UAE PDPL, Dubai DESC ISR, ISO/IEC 23894, 27701, 27017, 27018, 42005, 38507), so an auditor can be shown the control and the evidence behind it. Governance reports can be exported as JSON with a verification stamp.

### 3. AEGIS Shield: protect data and resist manipulation

- Sensitive data detection. Detectors for emails, phone numbers, IBANs (with checksum), card numbers (Luhn), Emirates ID, API keys and high-entropy secrets, JWTs, private keys, passwords, IPs and URLs, plus safe custom patterns. Each data class has an action: allow, mask, redact, block, or require approval. Detection runs inside the gateway before policy, and the gateway fails closed if the inspector errors.
- Prompt-injection signals. Heuristic detection of instructions smuggled into content an agent reads. Labelled heuristic on purpose: enforcement never depends on it alone.
- Tool security. A report over every tool an agent can reach, showing grants, schemas, classification limits and destination allowlists, with the same checks the gateway uses.
- Security events and incidents. Blocked exfiltration attempts and other security events are recorded, triaged and can be escalated to incidents with an owner, a timeline and a resolution.

### 4. AEGIS Audit: assess the paperwork

- Upload policies and procedures (PDF, DOCX, TXT, Markdown).
- Assess them against ISO/IEC 42001 (65 controls), ISO/IEC 27001:2022 (93), NIST AI RMF (72 subcategories), the EU AI Act (28 articles), GDPR (25), the UAE PDPL (17 principles), Dubai DESC ISR (15 domains), ISO/IEC 23894, 27701, 27017, 27018, 42005 and 38507, or a custom framework. The engine retrieves relevant passages, checks for normative language, and where possible confirms the control automatically from live AEGIS records (for example, "is there an approval workflow" is answered from the approvals table, not from the document).
- Each control is rated covered, partial, ambiguous or missing with cited excerpts and a confidence figure. Humans validate findings. Gaps become remediation tasks with owners and due dates. Reports export as JSON and PDF with a disclaimer that this is a static document assessment, not certification.

## Continuous governance (optional mode)

By default AEGIS tells people when a monitoring rule fires and leaves the response to them. With continuous governance switched on in Settings, the organization picks a response per rule in advance (suspend the agent, pause the gateway, disable the integration) and AEGIS applies it the moment the alert is raised, records it in the evidence ledger and notifies the administrators. Responses only reduce what agents may do and a person can reverse each one. Details in docs/CONTINUOUS_GOVERNANCE.md.

## What the demonstrations show

Three scenarios run end to end through the real gateway against a synthetic bank, Meridian Gulf Bank. All people and data are fictional and the console says so.

1. Banking transfer. An agent requests an AED 250,000 transfer. Policy requires approval above a threshold. A named approver reviews, approves with a comment, the agent receives a grant, the simulated core banking system verifies the grant and executes, a receipt is written. A viewer who tries to approve is refused. A 1.5 million transfer is denied outright.
2. Refunds. Small refunds execute autonomously, larger ones need approval, duplicates are caught by idempotency, expired approvals cannot be used, and a request whose parameters changed after approval is rejected.
3. Data exfiltration. An agent attempts to export customer records containing card numbers to an external destination. Shield detects the data class, policy denies, a security event is recorded and escalated to an incident. Nothing leaves.

Screenshots of every screen are in `docs/screens/`.

## How it is built

- One monorepo under `aegis/` with shared code (`packages/core`), the database layer (`packages/db`), a developer SDK (`packages/sdk`), an HTTP API (`apps/api`), the web console and public website (`apps/web`) and a background worker (`apps/worker`).
- PostgreSQL with row-level security. Every tenant table carries the organisation id and the database itself refuses to show one tenant's rows to another, even if application code has a bug. The application connects as a restricted role that cannot bypass this. Eleven dedicated tests prove isolation, including with raw SQL.
- Fail closed everywhere. Any error in checks, policy, Shield or grants results in a denial, never an execution.
- Identity: password with argon2id and lockout, server-side sessions, TOTP two-factor, OpenID Connect single sign-on, API keys for agents, eight roles over twenty-two permissions.
- Operations: Docker images, Compose, Kubernetes manifests, GitHub Actions CI running every suite, OpenTelemetry hooks, a backup and restore drill that verified the ledger after restore, and a load test (around 13 gateway decisions per second per tenant in the development container, p95 under one second).

## Numbers that are real

| What | Count |
|---|---|
| Database models | 50 |
| Automated tests passing | 186 (120 core, 11 isolation, 6 API, 49 browser) |
| Console screens | 31 navigation items, all functional |
| Compliance controls encoded | 472 across 20 frameworks |
| Shield evaluation corpus | 38 cases, 18/18 injections caught, 0/10 benign blocked |
| Evidence events verified in the demo tenant | about 1,900, chain valid |

## What is not real yet

Said plainly because buyers and auditors will ask.

- The five downstream systems (core banking, support platform, email, CRM, warehouse) are simulators. They behave like real systems (they verify the grant and need a credential) but they are in-process. Live connectors to real sandboxes are planned in `docs/REAL_WORLD_VALIDATION.md`.
- Secrets live in environment variables, not a hardware or cloud key manager.
- Single sign-on is OpenID Connect only, no SAML.
- Prompt-injection detection is heuristic and the test corpus is small and self-written.
- No independent penetration test or security audit has been done.
- No customers, no deployments, no certifications. The website does not claim any.
- Two open-source licence items are flagged for legal review in `docs/THIRD_PARTY.md`.

## Where to go next

- To see it: `docs/screens/` for pictures, `docs/DEPLOYMENT.md` to run it locally in about fifteen minutes.
- To take it to buyers: `docs/DEMO_TO_PRODUCTION.md` (hosted demo, staging, pilot, production gates).
- To prove it in real life: `docs/REAL_WORLD_VALIDATION.md` (live sandbox connectors, the one-week autonomy experiment, adversarial tests).
- For the honest per-module ledger of implemented, tested, simulated and missing: `docs/IMPLEMENTATION_REPORT.md`.
- For the technical design: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/THREAT_MODEL.md`, `docs/POLICY_LANGUAGE.md`, `docs/API.md`, `docs/SECURITY.md`.
