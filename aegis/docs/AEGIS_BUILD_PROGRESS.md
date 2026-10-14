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

Full description: `docs/UNCERTAINTY_ENGINE.md`.

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

## Phase 8: integration marketplace and event destinations (15 October 2026)

**Built:**
- **Event destinations.** Signed webhooks, Slack, Microsoft Teams, Splunk HEC, Datadog Logs and ServiceNow incidents.
  - Fed from the evidence ledger through a per-destination cursor, with one delivery per event and destination.
  - Retries with backoff; permanent failures can be retried by hand.
  - Category and severity filters.
  - Lab traffic excluded.
  - A test event marks a destination verified against the customer's real endpoint.
  - The worker job `events.dispatch` runs every minute.
- **Network safety.** HTTPS only, no credentials in URLs, public addresses only (checked on save and before every delivery), no redirects. The local-test override is refused in production.
- **Secrets.** Encrypted per organization and kind, never returned, rotatable.
- **Marketplace.** Every integration with an honest status (stand-in tested, tested in the repository, or simulator), what the customer must supply, and "verified in your organization" when the customer's own test succeeded.
- **Console:** Marketplace, Event Destinations, and the destination detail page with the delivery log, test, pause and credential rotation. Nested nav items now highlight correctly.

Full description: `docs/ENTERPRISE_INTEGRATIONS.md`.

**Database migration:** `20261015090000_event_destinations`.

**API:** `/v1/integrations/catalog`, `/destinations`, `/destinations/:id` (GET, PATCH), `/destinations/:id/secret`, `/destinations/:id/test` and `/deliveries/:id/retry`. All need a person.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 8 |
| API | 1 |
| Browser | 3 |

**Status:** implemented and tested against local stand-ins. **Not verified against any real vendor service;** each needs the customer's own credential and a test event.

**Known limitations:**
- No DNS pinning.
- No interactive Slack or Teams approvals.
- No cloud, CRM or ticketing connectors beyond ServiceNow incidents.

## Phase 9: advanced policy management (15 October 2026)

**Built:**
- **Enforcement status for every policy.** Enforced, or not enforced and why.
- **Conflict detection.** Witness-confirmed overlaps with the winning rule, rules that can never match, and an honest count of pairs not analyzed. It runs across the policy sets that apply to each active agent.
- **Expiring exceptions for one rule, one agent and optionally one tool.**
  - Two-person approval, at most 90 days, never under a delegation.
  - Recorded on every decision they touch.
  - Honoured by replay and recheck.
- **Recommendations from 30 days of decisions:** dead rules, habitual approvals, default denials, unenforced policies, conflicts, lab gaps.
- **Five sector templates** with built-in tests, previewed before a draft is created.
- **Console:** the Policies page has tabs for Policies (with an enforcement column), Conflicts, Exceptions, Recommendations and Sector templates. The policy detail page shows its enforcement status.

**Database migration:** `20261015120000_policy_exceptions`.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 8 |
| API | 2 |
| Browser | 3 |

**Status:** implemented and tested locally.

**Known limitations:** conflict analysis cannot decide regular expressions or negated text tests; it counts those pairs instead of passing them.

## Phase 10: enterprise control center (15 October 2026)

**Built:**
- **Control Center** (`/control-center`). One tile per module: decisions, approvals, autonomy, policy coverage, exceptions, security events, incidents, Attack Simulation Lab, models, data, regulatory changes, evidence and event destinations. Every tile names the records it is computed from and links to them. Tiles the viewer cannot read are left out rather than shown as zero.
- **System Health** (`/org/health`). Database, background worker (evidence not covered by a signed checkpoint), organization jobs, integrations, event delivery and the Action Gateway, each judged from records the organization owns.
- **Light, dark and system themes.** Set before first paint so the page does not flash; charts and the policy flow diagram read the active theme.
- **Keyboard shortcuts.** `?` lists them; `g` then a letter moves between the main areas.
- **Navigation.** A new "Command" group, and the most specific matching item is highlighted.

**Tests added:** Browser, 5.

**Status:** implemented and tested locally.

**Known limitations:** System Health covers what one organization can see. Host and cross-tenant queue health stays on the platform administration view. Locally the worker check reads "failing" when the worker is not running, which is the intended behaviour.

## Phase 11: UAE enterprise deployment options (15 October 2026)

**Built:**
- **Four deployment models** (multi-tenant SaaS, single-tenant managed, customer-controlled private cloud, on-premises), described on a new Deployment page with the installation files each uses.
- **Deployment manifest** (`AEGIS_DEPLOYMENT_MANIFEST`) with four example profiles in `deploy/profiles`. Every fact from it is labelled "declared".
- **Data residency assessment.** A claim is allowed only when every component and subprocessor holding customer data, and the backups, are declared in the country and attested by a named person within a year. Otherwise the page says AEGIS makes no claim and lists why.
- **Readiness checks** for encryption in transit and at rest, secrets, tenant isolation, audit retention, backup and recovery, monitoring and administrator access. Live checks read the database itself: TLS on the connection, the application role, row-level security on every organization table, append-only triggers and sealed secrets.
- **Regional settings.** Time zone (validated), currency, default language, residency country and audit retention in Settings. Dates across the console now use the organization's time zone.
- **Arabic and English.** Typed message catalogue, per-person language switch, right-to-left layout including menus and dialogs. Translated: shell, navigation, Control Center, System Health and Deployment.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 11 (one runs against the live database) |
| Browser | 2 |

**Status:** implemented and tested locally. No deployment was made.

**Known limitations:** Arabic covers the shell and three pages; the rest of the console is English inside the Arabic layout, and the Arabic text has not had a professional review. Declared facts cannot be verified from inside AEGIS.

## Phase 12: commercial platform (15 October 2026)

**Built:**
- **Plans and entitlements:** Trial, Core, Secure and Enterprise. Prices are left to the contract (no pricing analysis has been done). Planned features are labelled "planned, not built". Limits are reported, not enforced.
- **Usage metering** from each organization's records, with an idempotent six-hourly snapshot job.
- **Contracts and invoices:** recorded by platform administrators. Integer arithmetic, a draft, issued, paid or void lifecycle, and evidence events. AEGIS never collects payment.
- **Customer onboarding:** a platform administrator creates an organization with a one-time owner invitation for its first administrator. A new enterprise rollout checklist runs from organization creation to the first audit report.
- **Customer success:** a platform Customers page with health measures per organization.
- **Support requests:** customers open them, the provider answers them.
- **Sales demonstration environment:** a separate synthetic organization with six scenarios (finance, healthcare, enterprise IT, uncertainty, managed autonomy, reasoning governance) run through the real engines and labelled simulated.
- **Per-agent autonomy automation,** including suspension at the lowest burst level.

**Database migration:** `20261015150000_commercial`.

**Tests added:**

| Suite | Tests |
|---|---|
| Core | 17 |
| Browser | 5 |

**Status:** implemented and tested locally. No billing provider is connected, and no live transactions are possible.

**Known limitations:**
- Limits are not enforced.
- Invoices are not emailed or rendered as PDF.
- The sales demonstration cannot be deleted from the console, because audit records are append-only. Each run of the autonomy scenario adds a new agent.

## Phase 13: security hardening and validation (15 October 2026)

**Built:**
- **Cross-tenant reference guard.** 67 triggers refuse a row that points at another organization's row, covering foreign keys (which PostgreSQL checks without row-level security) and 31 plain reference columns.
- **Policy tampering detection.** Before every decision the active versions are re-hashed. A mismatch refuses the request and raises a critical security event.
- **Concurrent action limits per agent,** serialized with an advisory lock so simultaneous requests cannot exceed the limit.
- **DNS pinning for event destinations.** The checked address is the connected address, which closes DNS rebinding.
- **A repeatable backup restore drill.** Run and recorded: 53,177 evidence events across 1,202 chains, every chain giving the source's result.
- **docs/SECURITY_VALIDATION.md:** a requirement matrix with proofs, the fail-closed design and its operational consequences.

**Tests added:**

| Suite | Tests |
|---|---|
| Core security regression | 8 |
| SDK | 1 |

**Status:** implemented and tested locally. The restore drill was run on the development database.

**Known limitations:**
- No independent penetration test.
- No production point-in-time recovery drill.

## Phase 14: performance and reliability (15 October 2026)

**Built:**
- **Metrics** for every listed measure, recorded to OpenTelemetry and served in Prometheus format (API `/metrics`, worker on localhost).
- **Spans** for decisions, executions and jobs.
- **Backpressure** on the gateway.
- **Circuit breakers** for downstream executions and event destinations.
- **A dead-letter queue** with requeue, and poison-job protection.
- **Operational alerts** with an optional webhook.
- **Benchmarks** with targets.
- **Four query optimizations** on the decision path, cutting queries per decision from 62 to 47.

**Measured:**

| Measure | Result | Target |
|---|---|---|
| Policy evaluation p95, 50 rules | 156 microseconds | met |
| Evidence ingestion | 144 events per second | met |
| Single-decision p95 | 220 to 234 ms | met |
| Throughput for one organization | 5 to 6.5 per second | target 20, missed |

The missed throughput target is explained in docs/PERFORMANCE.md, with the next steps.

**Tests added:**

| Suite | Tests |
|---|---|
| Core reliability | 7 |
| API | 2 |

**Status:** implemented and tested locally. No production measurement has been made.

## Phase 15: documentation and release (14 October 2026)

**Built:**
- **Documentation set renamed and rewritten** to match the platform as built: AEGIS_ARCHITECTURE, UNCERTAINTY_ENGINE, ENTERPRISE_INTEGRATIONS and COMMERCIAL_READINESS, with every reference updated.
- **docs/AEGIS_MASTER_ROADMAP.md:** answers to the ten audit questions, the architecture, a dependency graph, the master feature matrix (phases 0 to 15, Secure S0 to S8 and the ten platform capabilities), prioritization and the completeness criteria.
- **Open-source research re-verified** for the Secure track: licenses, latest releases and maintenance for 33 projects, with the copyleft and source-available parts flagged.
- **Proof page:** verified rows for the backup restore drill and the benchmarks; the rows for production deployment and the Secure features say they are not yet done.
- **Language switch fix:** switching between English and Arabic now reloads the page, so the direction and every server-rendered string change together (a production build showed a stale direction intermittently).

**Verified:** the full browser suite, 118 tests, passed against a production build with a fresh seed.

**Status:** documentation only, apart from the language switch fix. Nothing was deployed.
