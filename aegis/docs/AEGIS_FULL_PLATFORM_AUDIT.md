# AEGIS full platform audit

Audited at commit 7d8fb11 on branch `claude/aegis-ai-governance-bgmcnk`, 13 October 2026. Every
statement below was checked against the code on that commit (file paths and line numbers are given
as they were on that commit). PROGRESS_REPORT_2026-10-13.md was used as a starting point and
corrected where the code disagreed with it.

Status words used throughout: **Implemented** (works and is tested), **Partial** (some of it
exists), **Missing**, **Broken** (exists but does not do what it says), **Duplicated**. Tags:
**[security]** security-sensitive, **[credentials]** needs external credentials to verify,
**[infra]** needs third-party infrastructure.

## 1. What exists today (verified)

### 1.1 Shape of the system
- pnpm monorepo: `packages/db` (Prisma 6.19, 50 models, RLS in `prisma/rls.sql`), `packages/core`
  (all domain logic), `packages/sdk` (one TypeScript client), `apps/api` (Fastify 5, about 105
  route handlers under `/v1`), `apps/web` (Next.js 15.5 console and public site; it imports core
  directly and never calls the API over HTTP), `apps/worker` (Postgres-backed job loop; Redis is
  declared but never used by any code).
- Tests: 205 core (real Postgres), 11 tenant isolation, 6 API, 76 Playwright in 15 files, a manual
  layout scan. Worker and SDK have no tests. CI runs typecheck, lint, the em-dash rule, the Proof
  figure check, all three test suites, `pnpm audit` (non-blocking) and the browser suite against a
  production build of the console. Docker and Kubernetes manifests are never built in CI.
- Deployment: Compose, one multi-stage Dockerfile (runs TypeScript through tsx with full dev
  dependencies), Kubernetes manifests with placeholder images, systemd units, Caddy. Owner database
  credentials reach only the migrate and seed containers; app processes refuse to start in
  production with the owner role (`packages/core/src/process-guard.ts`).

### 1.2 Tenant isolation (Implemented, with gaps) [security]
- Every table with a NOT NULL `org_id` has a `tenant_isolation` RLS policy on the GUC
  `app.current_org` (`rls.sql:23-36`). Frameworks are tenant-or-shared, controls follow the
  framework. The app role `aegis_app` is NOBYPASSRLS. `withTenant` (`packages/db/src/tenant-db.ts:46`)
  validates the UUID, sets the GUC inside the transaction, takes a per-org advisory lock and retries
  deadlocks. About 290 call sites.
- Gaps: `users` (with password and MFA secret hashes), `sessions`, `organizations`, `jobs`,
  `platform_events`, `deployment_versions` have no RLS and are readable across tenants by the app
  role. No `org_id` has a foreign key to `organizations`. Child rows are not checked for org
  consistency (a child in org A may reference a parent id from org B if the id is known). The
  worker trusts `payload.orgId` from the unprotected jobs table. `Job.idempotencyKey` is unique
  globally, not per org. The SECURITY DEFINER function `aegis_user_memberships(uuid)` accepts any
  user id. Schema drift: the partial unique index on grants and the GIN index on chunks live only in
  SQL, so `prisma migrate dev` would propose dropping them.

### 1.3 Action Gateway (Implemented)
Lifecycle in `packages/core/src/gateway/gateway.ts`: idempotency lookup, request row and evidence,
structural checks (`baseline.ts:386`: paused, agent active, tool enabled, integration active, tool
granted, AJV parameter validation, resource, permission and expiry, action, data classification,
destination rules and domains), Shield inspection (block, mask or force approval), policy
evaluation with deny > require_approval > allow > default deny, an append-only decision record with
the full comparison trace, approval routing, a single-use grant bound to the parameter hash with a
5-minute TTL and one live grant per request (code plus partial unique index), three-phase execution
with unknown-outcome reconciliation (30 s, 6 attempts), receipts, and every step in a hash-chained
evidence ledger. Fail-closed on database and evaluator errors. Tested in `gateway.test.ts` (21),
`execution-safety.test.ts` (13), `stripe-connector.test.ts` (20), `trading.test.ts` (13).

Limits found:
- Outcomes are only allow, deny, require_approval (plus error, treated as deny). RESTRICT,
  QUARANTINE and REQUEST_MORE_INFORMATION do not exist as decisions; "more info" exists only as an
  approver action.
- Grants are opaque random tokens whose HMAC is stored. They are not signed tokens, the HMAC key is
  the session secret (`grants.ts:24`), and a grant is not bound to the tool's integration, so any
  integration key can verify and consume any grant in the org (`POST /v1/gateway/grants/verify`).
  [security]
- `listActionRequests` and `getActionRequest` have no permission check; integration keys and any
  org member can read every request, parameters and evidence (`gateway.ts:562-595`,
  `apps/api/src/routes/gateway.ts:21-31`). [security]
- The approval hash check compares two stored hashes and never re-hashes the stored parameters
  (`approvals/service.ts:93`); parameters are rewritten by Shield at `gateway.ts:230`. [security]
- The `separationOfDuties` and `escalateToRoles` template settings are never stored or acted on
  (`gateway.ts:220`). Separation of duties is nevertheless always enforced by
  `approverEligibility`. Expired-status updates at `approvals/service.ts:140-149` are rolled back by
  the throw that follows them.
- `provideApprovalInfo` has no permission check (`approvals/service.ts:187`). [security]
- Unknown data classifications pass the classification check (`baseline.ts:422` uses indexOf).
  Permission expiry uses wall-clock time rather than the request clock.
- Agent self-reporting: in agent execution mode the agent reports its own outcome; the trading
  daily-loss cap and the score-band score are agent-supplied context.
- No framework adapters beyond the TypeScript SDK (`packages/sdk/src/index.ts`), no MCP code, no
  enterprise connectors. Connectors: six simulators, Stripe test mode, Alpaca paper.
- No detection of agents or tools acting outside the gateway. Health checks are on demand only.

### 1.4 Policy engine (Implemented)
JSON policy v1 (`policy/schema.ts`): rules with 22 operators, effects allow, deny,
require_approval; approval settings; embedded tests. Lifecycle draft, review, active, retired with
a database trigger that freezes versions. Three guided templates (refund, score band, trading),
replay against up to 2,000 historical requests, boundary sentences, posture derivation. OPA adapter
exists but is wired nowhere.

Limits: `activateVersion` accepts a draft without review or tests and `rollbackToVersion` activates
any version without a four-eyes check (`policy/service.ts:114-141`); the API route ignores the
org's four-eyes setting (`apps/api/src/routes/policies.ts:44`) while the web action honours it.
[security] Assignment priority has no effect (union, deny-overrides). No conflict detection, no
inheritance override, no exceptions, no recommendations. The `matches` operator allows regexes up
to 200 characters on 10 KB inputs, so ReDoS remains possible. `contextFromTrace`
(`boundary.ts:210`) accepts `__proto__` in attribute paths (needs policies:write to exploit).

### 1.5 Approvals, evidence, monitoring, continuous governance (Implemented)
- Approvals: eligibility by permission and role, assigned or escalated user, separation of duties
  (not the agent's owners, not the requesting principal, not a prior responder), expiry, multiple
  approvers, append-only responses, evidence.
- Evidence: SHA-256 chain per organization over canonical JSON, Ed25519-signed checkpoints when a
  key is configured, append-only triggers, offline-verifiable exports. Limits: signing is optional
  and untested, the stored `keyId` is ignored on verify (key rotation invalidates old checkpoints),
  and with no key a database-level attacker can rewrite the chain consistently. `verifyChain` loads
  every row into memory.
- Monitoring: 12 built-in rules evaluated every minute; deduplicated alerts; in-app notifications.
  One tenant run is one transaction, so a SQL error in one rule aborts the remaining rules.
- Continuous governance: assisted or continuous mode; automatic suspend, pause, disable or notify;
  recorded and reversible by a person. Runs as a system actor with every permission.

### 1.6 Shield (Partial)
Data-class detectors with mask, redact, block or require approval; egress allowlists; prompt
injection heuristics on tool parameters only; a 38-case evaluation corpus in CI (at least 90 percent
detection, zero benign blocked); incidents with a four-state workflow. **Broken:** the gateway
inserts security events directly (`gateway.ts:203, 429`), so `createSecurityEvent`, which opens
incidents on critical or repeated high events, runs only in tests. Tool output is never inspected.
No credential-exposure, privilege-escalation or delegation event types. No MCP risk assessment.

### 1.7 Audit (Implemented)
20 shared catalogs (13 TypeScript, 7 JSON drop-ins validated by zod), 472 controls, custom
frameworks and CSV import, document ingestion (PDF, DOCX, TXT, MD; 25 MB; no OCR), a lexical
assessment engine (BM25 plus rules, no embeddings, no AI calls), findings with human validation,
remediation tasks (owner, due date, review step), JSON and PDF reports with SHA-256 hashes (not
signed), signed-checkpoint evidence exports, a public checker scored in the browser. Limits:
automated evidence is record counts only, refreshed only when an assessment runs; retention deletes
documents cited by completed assessments; report generation needs only read permission and returns
server file paths; the checker's per-framework scores omit three ISO catalogs that its questions
cite; unknown automated evidence types are silently ignored.

### 1.8 Identity (Partial) [security]
Password login with argon2id and lockout, TOTP MFA, sessions (12 h absolute, 2 h idle), invitations,
API keys (hashed; scopes stored but never enforced), flat RBAC with 22 permissions and 8 system
roles, OIDC SSO with PKCE (not reachable from the UI; configurable only through the API). Findings:
- **High:** `completeSsoLogin` (`identity/oidc.ts:182`) attaches an SSO login to any existing
  global user with the same email. Email domains are set by the org's own admin and never verified,
  so an attacker-controlled identity provider can log in as a user of another tenant.
  `email_verified` is not required. The issuer is admin-supplied and fetched server-side.
- **High:** a user with `users:write` can assign the owner role (`orgs/orgs.ts:70`), and
  `createRole` accepts `org:admin` and unknown permission strings (`:107`).
- Web login and MFA actions have no rate limit (the API has 10 per minute); TOTP has no replay
  protection; MFA enrolment resets `mfaEnabled` without the current code.
- No SAML, no SCIM, no service identities beyond API keys, no identity-change audit beyond
  evidence writes.

### 1.9 Console and site (Implemented)
Five primary navigation items plus a collapsible "More" with 26 secondary pages, all permission
locked; every control is live or disabled with a tooltip. Dark theme only, no toggle, no light
tokens for the console. Fonts declared but never loaded. Recharts on one page, React Flow in the
policy editor, framer-motion installed and unused. No i18n (English only, no `dir`, no Arabic);
logical CSS properties are used throughout (91 logical, 0 physical), which makes RTL feasible. Org
currency and timezone settings are stored but ignored by the formatters. Dead controls: "Configure
SSO" and "Manage billing portal" are permanently disabled; `/api/public` has no routes.

### 1.10 Operations (Partial)
Custom Postgres job queue (idempotent enqueue, SKIP LOCKED claims, backoff, 5 attempts; no
dead-letter queue, stale recovery only at worker start, table never purged). Notifications are
in-app only; email, Slack and webhooks are not sent. OpenTelemetry starts in api and worker but the
custom counter, histogram and span helper are never used. Worker health always reads "running"
once any job row exists (`assurance/dashboard.ts:123`). `DeploymentVersion` is never written.
`packages/core/src/platform` is empty. Secrets are environment variables only. No backup automation
(one manual restore on 2026-10-11). No data-residency configuration. The demo seed uses one
hard-coded password for every persona and the platform admin, and the demo reset disables the
append-only triggers on shared evidence tables for all tenants while it runs. [security]

## 2. Capability matrix against the brief

### Phase 1: universal gateway
| Capability | Status | Notes |
| --- | --- | --- |
| Tool-call interception | Partial | Only through the HTTP API and the TypeScript SDK. No framework hooks. |
| Action authorization, parameter validation, resource permissions | Implemented | `baseline.ts`, AJV schemas, Permission rows. |
| Sensitive-data classification | Implemented | Shield detectors on parameters. Not on tool output. |
| Destination restrictions | Implemented | Tool destination rules and domain allowlists. |
| Policy enforcement, human escalation | Implemented | |
| Signed authorization grants | Partial | Opaque HMAC-hashed tokens, short-lived, single use, hash-bound; not signed, not bound to the executing integration. |
| Execution verification, idempotency, reconciliation, failure handling | Implemented | Three phases, receipts, unknown-outcome sweep. Agent mode is self-reported. |
| Audit recording | Implemented | Hash chain, optional signatures. |
| Agent-to-agent authorization | Missing | No delegation model; `principal` is free text from the agent. |
| Decision explanations | Implemented | Full trace plus boundary sentence. |
| Outcomes RESTRICT, QUARANTINE, REQUEST_MORE_INFORMATION | Missing | Enum has allow, deny, require_approval, error. |
| Agents cannot raise their own permissions | Implemented (implicit) | Agent actors carry no permissions; every write path asserts a user permission. Not stated as an invariant test. |
| Bypass limitation documentation, enforcement-path health | Missing | No detection of out-of-path activity. |
| Framework adapters (OpenAI Agents, Anthropic, LangChain, LangGraph, Microsoft, CrewAI, AutoGen, MCP) | Missing | |
| Enterprise connectors (Salesforce, ServiceNow, M365, Slack, Teams, GitHub, AWS, Azure, GCP) | Missing [credentials] | Only simulators, Stripe test mode and Alpaca paper exist. |

### Phase 2: agent identity
| Capability | Status | Notes |
| --- | --- | --- |
| Registry fields | Partial | Present: identity, org, environment, model and provider, tools, versions, state, data classification ceiling. Weak or absent: human owner (no FK), business purpose (description only), allowed destinations (per tool), autonomy level, risk classification (free string), approval requirements (in policies), credential expiry on the agent. |
| Agent discovery, unregistered agents | Missing | |
| Delegation governance | Missing | |
| Least-privilege recommendations | Missing | Usage data exists in decisions and evidence. |
| Temporary permissions | Partial | `Permission.expiresAt`; tool grants have no expiry; no approval step. |
| Emergency revocation | Implemented | Suspend, revoke, pause, void grants, disable integration, revoke credential. No downstream cancel hook. |
| SSO | Partial [security] | OIDC only, unreachable from UI, cross-tenant takeover defect. |
| SCIM | Missing | |
| RBAC | Implemented, with escalation defects | |
| Service identities | Partial | API keys for agents and integrations; scopes unenforced. |
| MFA enforcement, session management | Implemented | Web MFA has no throttle. |
| Separation of duties | Implemented | Approvals, four-eyes on activation (web only). |
| Administrative audit trails | Partial | Evidence events for most changes; no identity-change table. |

### Phase 3: managed autonomy
| Capability | Status |
| --- | --- |
| Autonomy levels 0 to 4 | Missing (a four-value display posture exists in `agents/posture.ts`) |
| Dynamic transitions, history, downgrade, restoration, override, simulation, analytics | Missing |
| Emergency suspension | Implemented (agent status) |

### Phase 4: uncertainty
All missing. The score-band template consumes a customer-supplied score; `Finding.confidence` exists
for document assessments only.

### Phase 5: reasoning governance
Partial. `ActionRequest.justification`, `riskIndicators`, `context` and the append-only decision
explanation exist. No structured decision record (objective, evidence references, constraints,
expected outcome, risks, alternatives), no evidence verification, no contradiction detection, no
objective alignment, no Decision Inspector.

### Phase 6: security and attack simulation
| Capability | Status |
| --- | --- |
| Prompt injection detection | Partial (parameters only; corpus in CI) |
| Tool-output manipulation | Missing |
| Sensitive-data leakage controls | Implemented (parameters, egress) |
| Credential exposure detection | Partial (data classes only) |
| Unauthorized tool use | Implemented |
| Privilege escalation detection | Partial (monitoring rule RM-002) |
| MCP server risk assessment | Missing |
| Suspicious delegation | Missing |
| Data exfiltration controls | Partial |
| Integration trust assessment | Partial (health, rotation) |
| Incident response workflows | Implemented, but gateway events never auto-escalate (Broken) |
| Attack Simulation Lab and dashboard | Missing (detection corpus only) |

### Phase 7: governance and compliance
| Capability | Status |
| --- | --- |
| Continuous control monitoring | Partial (counts, on assessment only) |
| Gap analysis | Implemented (lexical) |
| Remediation workflows | Partial |
| Regulatory change management | Missing |
| AI system inventory | Partial (agents only) |
| Model lifecycle governance | Missing |
| Data governance (classification, retention, residency, deletion, access auditing, encryption) | Partial (classification, document retention, encrypted secrets, evidence trail; no residency, deletion workflow or dataset classification) |
| Regional catalogs | Implemented (UAE PDPL, DIFC, DESC ISR, ISO 42001, ISO 27001, NIST AI RMF, EU AI Act and 13 more) |

### Phase 8: integrations
Missing for every named system. The connector interface, encrypted credential store, webhook
verification and connection tests exist and are reusable. [credentials] for all live verification.

### Phase 9: advanced policy
Conflict detection Missing; inheritance Partial (union, no override); exceptions Missing; extended
simulation Partial (replay of outcomes only); recommendations Missing; sector templates Partial
(refund, score band, trading).

### Phase 10: control center
About 14 of the 27 target navigation items exist, 7 are partial, 6 are missing (Agent Discovery,
Delegation, Uncertainty, Reasoning Governance, Attack Simulation page, tenant-facing Organizations
and System Health). Light mode Missing. Visualizations: two charts and one flow diagram.
Restructuring the navigation will break `console.spec.ts:49-104`.

### Phase 11: deployment
Compose, Kubernetes and systemd exist for one topology. Missing: residency configuration, secrets
management beyond env files, backup automation, DR drill, worker health probe, i18n architecture,
regional formatting from org settings, image scanning, non-root migrate image, pruned production
images.

### Phase 12: commercial
Onboarding checklist Implemented (7 steps). Plans, metering, billing, invoices, trials,
subscriptions, customer-success metrics Missing (plan is a string; billing is an inquiry form).
Demo scenarios: banking, refund, sensitive data, trading exist and run through the real gateway;
healthcare, enterprise IT, uncertainty, autonomy and reasoning scenarios Missing.

### Phase 13: validation
See 1.1. Not tested: credential or key rotation, policy tampering beyond the freeze trigger, Redis,
database or API outage, SDK fail-closed (THREAT_MODEL T13 overstates this), concurrent gateway
calls, API-level cross-tenant attempts, backup restore, DR, load in CI, infrastructure failure
injection, a security regression suite.

### Phase 14: performance
Manual load script and results in PERFORMANCE.md. Missing: used OpenTelemetry instruments,
distributed tracing, shared rate limiting (per-process memory today, multiplied by replicas),
backpressure, circuit breakers, dead-letter handling, alerting beyond in-app.

### Phase 15: documentation
None of the eleven requested documents exist. Drift in OVERVIEW (186 tests), IMPLEMENTATION_REPORT
(166 core tests, 13 catalogs), STATUS (60 tables), API.md (23 of about 105 routes),
OPEN_SOURCE_RESEARCH (claims reserved interfaces that do not exist), THREAT_MODEL T12, T13, T20.

## 3. Broken, duplicated and dead items (full list)

Broken
1. Gateway security events bypass `createSecurityEvent`, so incidents never auto-open in production.
2. Worker health always "running" once any job exists.
3. `DeploymentVersion` never written; the versions page is always empty.
4. Email never sent despite env keys and a code comment.
5. OpenTelemetry instruments and span helper unused; OPA adapter unwired.
6. `separationOfDuties`, `escalateToRoles` never stored; rolled-back expiry evidence.
7. Retention deletes documents cited by completed assessments.
8. Checker omits three cited ISO catalogs from per-framework scores.
9. MFA redirect drops `next`, breaking invite acceptance for MFA users.
10. Login page ignores SSO `?error=`; SSO unreachable from the UI; settings copy claims SAML.
11. Middleware sets `x-request-id` on the response, not the request.
12. `/audit/reports` download requires `reports:read` while the page requires `audit:read`.
13. Missing scripts referenced by `packages/db/package.json` (`seed.ts`, `reset.ts`); root `db:reset` fails.
14. Seed suspension reason cites RM-004 instead of RM-001.

Duplicated
- `gatewayPaused` (grants.ts and gateway.ts), `domainMatches` (baseline.ts and evaluate.ts),
  connector helpers; two Reports pages; two health surfaces; compliance split across `/reports`
  and `/audit`; home page at `/` and `/site`; `tenantDb` and `withTenant` aliases.

Dead
- "Configure SSO", "Manage billing portal", `/api/public`, `void createSession` in session-check,
  `framer-motion`, `@tanstack/react-query`, `date-fns`, `ioredis`, `animate-in` classes without
  the plugin, declared fonts.

## 4. Security-sensitive findings, ranked

| # | Finding | Where | Fix phase |
| --- | --- | --- | --- |
| S1 | SSO cross-tenant account takeover (unverified domains, email match on global users) | `identity/oidc.ts:182` | 2 |
| S2 | Privilege escalation to owner by `users:write`; custom roles may carry `org:admin` | `orgs/orgs.ts:70,107` | 2 |
| S3 | Draft policy can be activated without review; rollback without four-eyes; API ignores four-eyes | `policy/service.ts:114-141`, `routes/policies.ts:44` | 9 (fixed early in 1) |
| S4 | Integration keys read every request and consume any grant | `gateway.ts:562-595`, `routes/gateway.ts:21-65` | 1 |
| S5 | `provideApprovalInfo` has no permission check | `approvals/service.ts:187` | 1 |
| S6 | Approval binds stored hashes, not re-hashed parameters | `approvals/service.ts:93` | 1 |
| S7 | Web login and MFA unthrottled; TOTP replay | `server/actions/auth.ts:27` | 2 |
| S8 | Users, sessions, jobs, organizations without RLS; worker trusts job payload org | schema, worker | 13 |
| S9 | Evidence signing optional and untested; key rotation unsupported | `evidence/ledger.ts:170` | 13 |
| S10 | Demo reset disables append-only triggers for all tenants; shared hard-coded demo password | `seed/demo-tenant.ts:19,49-63` | 12 |
| S11 | Grants hashed with the session secret; not bound to integration | `grants.ts:24` | 1 |
| S12 | Unknown classification passes; `__proto__` in trace paths | `baseline.ts:422`, `boundary.ts:210` | 1 |
| S13 | Report generation on read permission; server paths returned | `audit/reports.ts:85,370` | 7 |
| S14 | Rate limits per process (replicas multiply them); API key suffix as bucket key | `apps/api/src/app.ts:37` | 14 |
| S15 | Public marketing form unthrottled; `/ready` leaks DB errors | `marketing.ts:90`, `health.ts:14` | 13 |

**Status of the six findings left open after Phase 2 (fixed 2026-10-14, with regression tests):**
- **S8:** row-level security now covers users, sessions, organizations, jobs, platform events and deployment versions. Inside a tenant transaction each is confined to that organization; platform code outside a tenant context is unchanged. The cross-tenant membership lookup answers only outside a tenant transaction. Job keys are stored scoped to the organization, and the worker refuses a job whose payload names a different organization from the job row (`packages/db/tests/platform-isolation.test.ts`, `packages/core/tests/jobs.test.ts`).
- **S9:** evidence signing uses a key ring. The current key signs, retired public keys verify by key id, unknown key ids fail verification, and production refuses to start without a signing key (`packages/core/tests/evidence-signing.test.ts`).
- **S10:** the demo reset no longer disables append-only triggers. The trigger lets the table owner delete only the organization named in a transaction-local setting, never updates, and never for the application role. The platform administrator has its own password (`platform-isolation.test.ts`).
- **S13:** generating a report requires `audit:write`, and no result returns a server file path (`packages/core/tests/audit.test.ts`).
- **S14:** request limits are counted in PostgreSQL and shared by every replica. Credentials are bucketed by hash, never by a fragment (`jobs.test.ts`).
- **S15:** the public form uses the shared limiter, and the readiness endpoint no longer returns database error text.

**Still open from the audit:** org consistency of child rows (a child row referencing a parent id from another organization) has no database constraint. Row-level security prevents reading the other organization's parent, which limits the impact. Tracked for Phase 13.

## 5. External credentials and infrastructure
- [credentials] Stripe test key, Alpaca paper key (scripts exist, never run), every Phase 8
  system (Entra ID, Okta, Slack, Teams, Datadog, Splunk, AWS, Azure, GCP, Salesforce, ServiceNow,
  OpenAI, Anthropic). Contract tests against fakes can run without them; live verification cannot.
- [infra] Object storage for uploads and backups, an OTLP collector or vendor, an SMTP or email API,
  a Kubernetes cluster or VM for deployment, a KMS or sops for secrets, Trivy in CI.

## 6. Open-source foundations: decisions

Licence rule unchanged: MIT, Apache-2.0, BSD or ISC for anything vendored or imported; MPL-2.0
acceptable as a stand-alone tool; no AGPL or GPL source. Status verified on 13 October 2026.

| Project | Licence | Decision | Reason |
| --- | --- | --- | --- |
| open-policy-agent/opa | Apache-2.0 | Do not adopt as runtime. Remove the unwired adapter from the export surface or keep it clearly experimental. | The in-house evaluator is deterministic, tested and explains itself; a Rego sidecar adds an operational dependency and a second policy language. |
| cedar-policy/cedar | Apache-2.0 | Do not adopt. Borrow its schema-validated entity, action and resource model for the new delegation and permission checks. | Same reason as OPA; Cedar would duplicate the policy engine. |
| keycloak/keycloak | Apache-2.0 | Do not embed. Support it as an OIDC and SAML identity provider and test against it in Phase 2. | AEGIS needs to federate with the customer's IdP, not ship one. |
| open-telemetry/opentelemetry-js | Apache-2.0 | Already present; wire the instruments in Phase 14. | |
| langfuse/langfuse | MIT (except `ee/`) | Do not adopt. Emit OTLP traces that Langfuse or any backend can ingest. | Keeps AEGIS backend-neutral. |
| langchain-ai/langgraph (and LangChain) | MIT | Build thin adapters (tool wrapper and interrupt hook) in Phase 1 with contract tests. | |
| modelcontextprotocol TypeScript SDK | MIT | Adopt. Build an MCP gateway proxy (server-facing client plus client-facing server) so every MCP tool call is a gateway request. | The strongest enforcement boundary available for agent frameworks today. |
| promptfoo/promptfoo | MIT | Do not embed. Keep the Attack Simulation Lab in-process on synthetic data; export results in a format promptfoo or a reviewer can read. | |
| NVIDIA/garak | Apache-2.0 | Do not embed (Python). Reference its probe taxonomy for the lab's attack classes. | |
| NVIDIA/NeMo-Guardrails, guardrails-ai | Apache-2.0 | Patterns only (Python). | |
| microsoft/presidio | MIT | Patterns only; keep the in-house detector registry; add an optional external-detector provider interface. | |
| openfga/openfga | Apache-2.0 | Do not adopt. Relationship checks stay as tables and a resolver. | |
| spiffe/spiffe, spire | Apache-2.0 | Adopt the identity format (`spiffe://<org>/agent/<slug>`) and the short-lived credential pattern for agents in Phase 2; do not deploy SPIRE. | |
| temporalio/temporal | MIT | Defer (ADR-0003). Add a dead-letter table and scheduled stale recovery to the Postgres queue instead. | |
| getsops/sops | MPL-2.0 | Recommend as the tool for encrypted environment files; ship an example `.sops.yaml` in Phase 11. Not vendored. | |
| aquasecurity/trivy | Apache-2.0 | Adopt in CI (image and dependency scan) in Phase 13. | |

## 7. Order of work and the reason for it

1. Phase 1 (gateway outcomes, signed and integration-bound grants, read permissions, approval
   re-hashing, MCP proxy, framework adapters, bypass health) because every later phase builds on
   the decision model.
2. Phase 2 (identity defects S1, S2, S7 first, then registry fields, delegation, temporary
   permissions, SAML, SCIM, service identities).
3. Phase 3 (autonomy as an enforced level with deterministic transitions).
4. Phases 4 and 5 (uncertainty and reasoning inputs feed the gateway as deterministic signals).
5. Phase 6 (Shield fix for escalation, new detectors, the lab).
6. Phases 7, 8, 9 (compliance, integrations, policy engine extensions).
7. Phase 10 (navigation and visuals once the data exists).
8. Phases 11 to 15 (deployment, commercial, hardening, performance, documentation).

The existing architecture (modular monolith, Postgres queue, RLS, JSON policy v1, hash-chained
evidence) is kept. Nothing working is rewritten for consistency alone.
