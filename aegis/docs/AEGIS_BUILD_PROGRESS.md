# AEGIS build progress

Updated after every phase. Figures come from test runs on this branch; "not run" means exactly
that.

## Phase 0: full platform audit (done, 13 October 2026)
- Output: `docs/AEGIS_FULL_PLATFORM_AUDIT.md`.
- Method: five parallel read-only inspections (database, gateway and policy, assurance and
  operations, API and console, tests and deployment) consolidated and cross-checked against the
  code at commit 7d8fb11.
- Files changed: this file and the audit.
- Database migrations: none. API endpoints: none. Tests added: none.
- Test results at the audited commit: core 205 pass, db 11 pass, api 6 pass, browser 76 pass (73 in
  the full run, 3 load-affected tests pass on rerun), CI green on 7d8fb11.
- Known limitations recorded: 15 ranked security findings, 14 broken items, open-source decisions.
- Remaining work: Phases 1 to 15 in the order given in the audit.

## Phase 1: universal action gateway (13 October 2026)

Completed
- Six outcomes: allow, deny, require_approval, restrict, quarantine, request_more_information,
  decided strictest-first. Restrict narrows parameters and the grant binds the narrowed request.
  Quarantine raises a security event through Shield (critical opens an incident) and needs a security
  reviewer to refuse it or release it to a human approval. Request-more-information accepts the
  agent's resubmission under the same idempotency key. Held requests expire (job plus sweep).
- Signed, integration-bound execution grants (HMAC-SHA256 v2 tokens under a derived key).
- Agent-to-agent delegation with person-only creation, intersection of both agents' grants, caps,
  both agents' policies, immediate revocation.
- Enforcement-path audit and coverage report (bypass detection) with an hourly worker job, API
  routes and a console panel on each integration.
- Framework adapters: TypeScript (`guardedCall`, OpenAI Agents SDK, LangChain, LangGraph, Anthropic
  tool use, plain functions) and Python (`guard`, CrewAI, AutoGen, Semantic Kernel), all fail-closed.
- MCP gateway package and CLI (tools only; refuses resources, prompts and server-initiated requests).
- Audit fixes: gateway reads need `gateway:read`; integrations see only their tools' requests;
  approvals re-hash stored parameters; approval answers limited to the agent, owners and approvers;
  unknown classifications fail closed; permission expiry uses the request clock; gateway security
  events go through Shield escalation; SDK `waitForApproval` can stop at approval for agent mode.
- Console: quarantine review controls, restriction and missing-information notes on the request
  page, enforcement panel on integrations, new demo scenario "Between allow and deny".

Files (main): `packages/core/src/gateway/{gateway,grants,restrictions,enforcement,simulators}.ts`,
`packages/core/src/policy/{schema,evaluate,replay}.ts`, `packages/core/src/agents/delegation.ts`,
`packages/core/src/approvals/service.ts`, `packages/sdk/src/{guard,adapters}.ts`,
`packages/sdk-python/`, `packages/mcp-gateway/`, `apps/api/src/routes/gateway.ts`,
`apps/worker/src/index.ts`, `apps/web/src/components/control/{held-request,enforcement-panel}.tsx`.

Database migration: `20261013150000_gateway_outcomes` (three decision values, two request statuses,
`agent_delegations`, request delegation columns, grant integration id, integration enforcement
summary).

API endpoints added: `POST /v1/gateway/actions/:id/quarantine`, `GET /v1/gateway/enforcement/coverage`,
`POST /v1/gateway/enforcement/:integrationId/audit`. Changed: `POST /v1/gateway/actions` returns 202
for quarantine and more-information; `POST /v1/gateway/grants/verify` checks the integration.

Tests added: core 26 (`gateway-outcomes` 19, `enforcement` 6, Stripe audit 1), SDK 15, MCP gateway 6,
Python 8, browser 4 (`gateway-outcomes.spec.ts`).

Test results: core 231 pass; db 11 pass; api 6 pass; sdk 15 pass; mcp-gateway 6 pass; python 8 pass;
new browser spec 4 pass.

Known limitations
- Framework adapters are tested against each framework's public tool shape, not against installed
  frameworks. Live verification with OpenAI Agents SDK, LangChain, LangGraph, CrewAI, AutoGen,
  Semantic Kernel and Microsoft Agent Framework is pending.
- The MCP gateway is tested against a stdio MCP server written for the tests; it has not been run
  against a third-party MCP server or client. Streamable HTTP transport is not implemented.
- Enforcement-path audit covers the simulated systems and Stripe test mode. Alpaca paper cannot be
  observed yet.
- Enterprise application connectors (Salesforce, ServiceNow, Microsoft 365, Slack, Teams, GitHub, AWS,
  Azure, Google Cloud) are moved to Phase 8, where the connector framework, credential flows and
  contract tests are built together. Live verification needs customer credentials.
- Agent mode remains self-reported unless the downstream system verifies the grant.

External dependencies: none added. Credentials needed for live verification: framework API keys,
each enterprise system's sandbox credentials.

## Phase 2: agent identity and access management (13 October 2026)

Completed
- The three high identity findings from the audit are closed: SSO cross-organization takeover,
  administrator self-escalation, and policy activation without review. Also: MFA codes accepted once,
  five wrong codes close the session, MFA re-enrolment needs MFA off first, the return path survives
  the MFA step, sign-in errors reach the login page as codes.
- Registry: purpose, allowed destinations and re-certification date per agent, enforced by the
  gateway; workload identity shown per agent.
- Temporary access with second-person approval, automatic end and early revocation.
- One-step emergency revocation with a report of what was stopped and what was already running.
- Least-privilege suggestions; agent discovery with security events for unregistered agents.
- SAML 2.0 next to OIDC, an SSO configuration dialog replacing the dead button, a single sign-in
  link per organization, SCIM 2.0 provisioning, enforced API key scopes, an organization switch that
  requires MFA for every member.
- Console: Access tab on each agent, Agent Discovery page, SSO dialog, login-page SSO entry.

Database migrations: `20261013200000_identity_hardening`, `20261013210000_agent_identity`,
`20261013220000_saml`.

API endpoints added: `/v1/identity/discovery/agents` (POST report, GET list, POST resolve),
`/v1/identity/access-requests` (GET, POST, decide, revoke), `/v1/identity/delegations` (GET, POST,
revoke), `/v1/identity/agents/:id/least-privilege`, `/v1/identity/agents/:id/emergency-revoke`,
`/scim/v2/ServiceProviderConfig`, `/scim/v2/Users` (GET, POST, GET/PUT/PATCH/DELETE by id),
`/scim/v2/Groups` (GET, PATCH by role key). Web routes: `/sso/start`, `/sso/saml/[slug]/login`,
`/sso/saml/[slug]/metadata`, `/sso/saml/acs`.

Tests added: core 22 (identity hardening 9, agent identity 9, SAML 4), API 7, browser 5.

External dependencies: `@node-saml/node-saml` 5.1.0 (MIT; xml-crypto, xmldom, xml2js, xpath, all
MIT); `xml-crypto` 6.1.2 as a test-only dependency. Logged in `docs/THIRD_PARTY.md`.

Known limitations: see the end of `docs/AGENT_IDENTITY.md`. Live verification with Entra ID, Okta
and a production SAML provider needs real tenants.

## Founder direction and security fixes (14 October 2026)

Founder's direction of 13 October 2026:
- The full roadmap continues.
- DNRS is not used as a reference for any part of AEGIS.
- The six open security findings are fixed first.

Recorded in `docs/PROVENANCE.md`, which lists the earlier work flagged for counsel's review and the public foundations for Phases 3 to 5.

**The six findings, each with regression tests (details in `docs/AEGIS_FULL_PLATFORM_AUDIT.md` section 4):**
- **S8:** row-level security on users, sessions, organizations, jobs, platform events and deployment versions. Job keys are scoped per organization, and the worker refuses a job whose payload names another organization.
- **S9:** an evidence signing key ring with rotation. Unknown keys fail verification, and production refuses to start without a key.
- **S10:** the demo reset no longer disables append-only triggers. The platform administrator has its own password.
- **S13:** report generation needs `audit:write`, and no server paths are returned.
- **S14:** shared rate limits in PostgreSQL across replicas, with credentials bucketed by hash.
- **S15:** the public form uses the shared limiter, and the readiness endpoint no longer exposes database errors.

**Also fixed:** the demo reset failed after Phase 2 because it did not clean the agent delegation, access request and discovery tables.

**Database migration:** `20261014090000_platform_rls_rate_limits`.

**Tests added:**

| Suite | Tests |
|---|---|
| Database | 11 |
| Core | 12 (job queue and rate limits 7, evidence signing 5) |
| Core, changed | The audit report test now asserts the permission and the absence of a path |

## Phase 3: managed autonomy (14 October 2026)

**Built:** autonomy levels 0 to 4 per agent, enforced by the gateway after policy and data protection.
- **Monotonic.** A level can only make a decision stricter, and a property test checks this over 2,000 random inputs.
- **Lowering** is immediate and voids unused grants.
- **Raising** needs a second person.
- **Automatic downgrades** run on severe security events, bursts of refusals and unconfirmed executions. They are off by default.
- **Records.** Transitions are append-only rows with evidence.
- **Measurement.** Readiness measures for a raise, a 30-day simulation at another level, and organization analytics.
- **Lockout of API keys.** Every governance-changing API route now refuses API keys before reading the request, so no agent can change its own autonomy, policies, approvals, access, delegations or revocation.
- **Console.** An Autonomy page (levels, agents, changes, open raises, downgrade rules), an Autonomy tab on each agent, and an Autonomy column on the agents list.

Full description: `docs/MANAGED_AUTONOMY.md`.

**Database migration:** `20261014100000_managed_autonomy`. It adds agent columns with a range check, plus `autonomy_transitions` (append-only) and `autonomy_change_requests`.

**API endpoints added:**
- `/v1/autonomy/analytics`
- `/v1/autonomy/settings` (PUT)
- `/v1/autonomy/agents/:id`, with `/lower`, `/raise-requests` and `/simulate`
- `/v1/autonomy/raise-requests/:id/decision` and `/cancel`

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 14 |
| API | 13 |
| Browser | 4 |

**External dependency:** `fast-check` 3.23.2 (MIT), a test-only dependency of core that was already in the lockfile.

**Known limitations:** no per-tool levels, and no time-boxed raises. The demo keeps automatic downgrades off.

## Phase 4: uncertainty governance (14 October 2026)

**Built:**
- **Per-request assessment.** Checks for malformed evidence, contradictions, gaps the agent reports, required fields, evidence backing, freshness, trusted sources, confidence against a minimum, policy ambiguity and recent changes. Each check is labelled as a measured fact, a heuristic, the agent's own figure or a calibrated estimate.
- **Levels.** Low, elevated, high or unknown, where unknown is never treated as safe.
- **Monotonic escalation**, property-tested:
  - Contradictions always go to a person.
  - Reported gaps ask the agent for the missing fields.
  - Under a tool's requirements, high or unknown follows the tool's choice.
- **Policy references.** Policies can refer to `uncertainty.*`.
- **Calibration of self-reported confidence** against outcome labels from approvers, reviewers and customer systems, using reliability bins, expected calibration error and the Brier score. A figure is called calibrated only with 50 or more outcomes, and the worker recomputes hourly.
- **Replay fix.** Policy replay now compares a draft with what the policies alone decided, not with the final outcome after data protection, uncertainty and autonomy.
- **SDK.** The TypeScript SDK types the uncertainty fields.

Full description: `docs/UNCERTAINTY_GOVERNANCE.md`.

**Database migration:** `20261014120000_uncertainty`.

**API endpoints added:** `/v1/uncertainty/overview`, `/agents/:id/calibration`, `/labels`, `/tools/:id/policy` and `/calibration/recompute`. There is a new API key scope, `outcomes:report`, which agents can never hold.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 16 |
| API | 3 (including outcomes by scope) |
| Browser | 3 |

**Known limitations:** binning is the only calibration method, labels are binary, and evidence is not re-fetched from source systems.

## Phase 5: reasoning governance and the Decision Inspector (14 October 2026)

**Built:**
- **Stated reasons.** An optional structured rationale per request (summary, stated action, steps with citations, assumptions, policies relied on), checked against the request, the supplied evidence and the policies that applied.
- **Integrity failures always go to a person:** a stated action that differs from the request, citations to evidence that was not supplied, and assumptions the request or evidence contradicts.
- **Tool requirements** for a rationale and citations, with the tool's chosen response.
- **Precedent heuristic.** Flags similar requests decided differently by the same policy versions; it never changes a decision.
- **Decision Inspector:**
  - Stage-by-stage reconstruction.
  - Counterfactuals from recorded numeric comparisons only.
  - Recheck against today's policies.
  - A W3C PROV-structured decision record with a SHA-256 hash, written to the evidence record on export.
- **No claims about model internals,** in code, API or console.

Full description: `docs/REASONING_GOVERNANCE.md`.

**Database migration:** `20261014140000_reasoning` (`tools.reasoning_policy`).

**API endpoints added:** `/v1/decisions/:id`, `/:id/recheck`, `/:id/record` and `/tools/:id/reasoning-policy`.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 12 |
| API | 3 |
| Browser | 2 |

**Known limitations:** checks are structural, not semantic, and counterfactuals cover single comparisons only.

## Phase 6: AI security and the Attack Simulation Lab (14 October 2026)

**Built:**
- **Attack Simulation Lab.** Clones an active agent (grants, permissions, team, limits, autonomy, agent policies) into a temporary lab agent. It then sends a control request and 18 attack scenarios through the real gateway, decision-only, and tears the clone down.
  - Outcomes: defended, gap (with what closes it), inconclusive or error.
  - Each scenario carries OWASP Top 10 for LLM Applications 2025 and MITRE ATLAS references.
- **Lab isolation.** Lab agents are kept out of agent lists and counts, monitoring alerts, automatic incidents, autonomy downgrades and notifications. Their traffic stays on the evidence record.
- **Injection response.** A new organization setting turns Shield's heuristic injection signals into an approval, a quarantine or a refusal.
  - Off by default and monotonic (property-tested).
  - Raises `injection.detected` security events.
  - Added because the lab found that no policy acted on the signals.
- **Console:** Security, Attack Simulation Lab (runs, scenarios, run detail with links to each request), and the injection response on Data Protection.

Full description: `docs/ATTACK_SIMULATION_LAB.md`.

**Database migration:** `20261014160000_attack_simulation_lab`:
- `agents.is_lab`;
- `attack_simulation_runs`;
- `attack_simulation_results`, which is append-only.

**API endpoints added:** `/v1/lab/scenarios`, `/v1/lab/runs` (GET and POST) and `/v1/lab/runs/:id`. All need a signed-in person, reads included.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 10 |
| API | 2 |
| Browser | 2 |

**Demo:** the seeded lab runs show the refund agent going from 5 gaps to 3 after the injection response is set to hold for review. The 3 remaining gaps are real configuration gaps, left visible.

**Status:** implemented and tested locally. Not a penetration test, not independently reviewed, and not verified in a customer deployment.

**Known limitations:**
- Scenarios are fixed and runs are manual.
- Injection detection is heuristic and has not been evaluated against an independent adversarial corpus.

## Phase 7: model governance, data governance and regulatory change (14 October 2026)

**Built:**
- **Model registry and lifecycle.**
  - Stages: proposed, evaluating, approved, deprecated, retired.
  - Evaluations are append-only.
  - Approval needs evaluations with no failing latest result and a second person with `policies:activate`.
  - Periodic review dates; agents linked to their model.
- **Model enforcement in the gateway.** An off-by-default organization setting holds or refuses agents whose model is unregistered, unapproved or retired. It is monotonic (property-tested) and recorded on every decision.
- **Data inventory.**
  - Owner, classification, categories, declared region, retention and lawful basis, with findings for the gaps.
  - Access audit from real agent permissions and gateway requests.
- **Deletion requests.** Keyed hash of the subject only, a two-person decision, and the completion reference from the customer's system.
- **Regulatory change register.** People record a change, assess it (with a labelled lexical suggestion) and turn it into remediation tasks. It can close only when every task is resolved.
- **Console:** Models (Control), Data Inventory (Security) and Regulatory Changes (Audit), each with a detail page.

Full description: `docs/MODEL_DATA_GOVERNANCE.md`.

**Database migration:** `20261014180000_model_data_governance`. It adds six tables, two of them append-only, and `agents.model_record_id`.

**API:** `/v1/governance/*`. Writes need a person.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 9 |
| API | 5 |
| Browser | 4 |

**Status:** implemented and tested locally. Records are entered by people. Regions are declared, not verified. AEGIS records deletions; it does not perform them.

**Known limitations:**
- No imports from model hubs or data catalogs.
- Impact suggestions are lexical.
- No scheduled reminders.
