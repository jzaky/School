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
