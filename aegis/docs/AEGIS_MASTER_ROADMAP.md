# AEGIS master roadmap

One roadmap for everything AEGIS has built and plans to build, reconciled on 15 October 2026 from the
repository itself. It combines:

- the original technical roadmap (Phases 0 to 15);
- the AEGIS Secure track (Phases S0 to S8);
- the ten capability expansions of the final platform directive.

The original numbering is kept. Status words have fixed meanings:

| Status | Meaning |
|---|---|
| Implemented | Built, with automated tests that exercise the real behaviour |
| Partial | Some of the capability is built and tested; the gap is named |
| Not implemented | Nothing beyond a design |
| Needs external | Cannot be completed without a credential, paid service or customer system that this environment does not have |

"Verified deployed" is **No** for everything: no production deployment has been approved, so nothing
has been verified in a deployed environment. No completion percentages are given.

## 1. Answers to the ten audit questions

**1. What is already built?**
- **Gateway.** A universal action gateway with six outcomes, used through the TypeScript and Python SDKs, five framework adapters and an MCP proxy.
- **Agent identity and access.** API keys, expiry, temporary access, delegation, discovery, posture and emergency revocation.
- **Policies.** A deterministic policy engine with replay, conflict analysis, exceptions, templates and integrity checking.
- **Approvals** bound to exact parameters.
- **Decision engines.** Managed autonomy, uncertainty with calibration, and reasoning governance with the Decision Inspector.
- **Shield.** Data classes, tool security, injection signals and responses, incidents, and the Attack Simulation Lab.
- **Governance registers.** Model, data and regulatory registers.
- **Evidence.** A signed, hash-chained evidence ledger.
- **Audit workspace** with 20 framework catalogs.
- **Integrations.** An integration marketplace and event destinations.
- **Console.** Control Center, System Health, deployment readiness and residency assessment, and an Arabic right-to-left console.
- **Commercial records,** and the sales demonstration.
- **Platform reliability.** Security hardening with a regression suite, and the observability and reliability controls.

See the matrix below for links.

**2. Which shared services can AEGIS Secure reuse?**
Organizations, roles and row-level security; the policy engine (one engine, no second one); Shield's
detectors and data classes; the evidence ledger; the job queue; integrations and their credentials;
event destinations; security events and incidents; the metrics registry and alerts; the console shell.

**3. What architectural changes are required?**
- **An inspection service for people's AI traffic.** It is an OpenAI-compatible proxy that calls the same policy engine and detectors, with its own process and limits, so prompt inspection load and risk stay off the agent gateway (S2).
- **An ingestion API for discovery signals** from identity providers, browsers, network and endpoint tools. Every signal is stored as observed, inferred or unknown (S3).
- **A software inventory model:** components, SBOMs, findings and approvals (S4).
- **An isolated execution runner** outside the main processes (S5).

None of these needs a second identity, policy or evidence system.

**4. Which open-source projects should we integrate?**
- Microsoft Presidio as an optional detector backend.
- Syft and Grype (SBOM and vulnerability matching) for software inventory.
- OpenSSF Scorecard data and Sigstore cosign verification for provenance.
- gitleaks rules as a reference for secret patterns, reimplemented under its MIT license terms.
- gVisor for the S5 runner.
- OpenTelemetry, already used.

See docs/OPEN_SOURCE_RESEARCH.md for licenses and maintenance status.

**5. Which should we reject, and why?** Reject these:
- **Copyleft or source-available projects we would have to embed.** Code from AGPL or GPL repositories cannot be copied. They can only be run as separate tools that customers choose.
- **A second policy engine.** OPA and Cedar are kept as optional adapters, not replacements, because the existing engine drives replay, conflict analysis and explanations.
- **A generic SIEM or EDR.** Integrate with the customer's instead.
- **Model-based safety classifiers as the sole gate,** because the directive forbids relying solely on one.

**6. What is the strongest minimum viable product?**
- Agent control as built today.
- Plus the employee AI gateway with data loss prevention (S2), enforced at a proxy the organization routes traffic through, so that "blocked" means blocked.
- Plus Shadow AI discovery from identity-provider sign-in logs (S3).

**7. What are the largest technical and security risks?**
- Prompts holding confidential data pass through AEGIS, so the inspection service must not store them by default.
- Discovery that over-claims from partial telemetry.
- Per-tenant gateway throughput (5 to 6.5 decisions per second measured; see docs/PERFORMANCE.md).
- Running untrusted code (S5) on shared infrastructure.
- Copyleft contamination.

**8. What can be built immediately?**
- S1 foundations.
- The S2 gateway and DLP against a local fake model provider.
- S3 ingestion and inference from uploaded or test-double sign-in logs.
- S4 SBOM ingestion and vulnerability matching against a local advisory file.

All of these use test doubles and need no external credentials.

**9. How will the Secure track coexist with the original roadmap?** As modules of the same platform:
- the same organizations, roles, policies, evidence, events and console;
- new console sections under a "Secure" navigation group.

Phases keep their numbers; S-phases depend on finished original phases, as the graph below shows.

**10. What will the completed product look like to a customer?**
- **One console** that answers the five questions in section 6: what AI operates here, what it can reach, what it may do, whether dangerous behaviour is stopped and contained, and whether the controls provably worked.
- **Enforcement points:** the agent gateway, the MCP proxy, the employee AI gateway and the execution runner, all decided by one policy engine and recorded in one evidence ledger.

## 2. Architecture

```
                         +------------------- one policy engine, one evidence ledger -------------------+
 Agents, SDKs, MCP  ---> | Agent gateway (apps/api)      built                                          |
 MCP clients       ----> | MCP proxy (packages/mcp-gateway) built                                       |
 People's AI apps  ----> | Employee AI gateway + DLP     S2, built (local)                              |
 IdP, browser, endpoint  | Discovery ingestion           S3, not implemented (agent discovery partial)  |
 SBOMs, registries ----> | Software inventory and scans  S4, not implemented                            |
 Code to run      -----> | Isolated execution runner     S5, not implemented (separate host)            |
                         +--------------------------------------+---------------------------------------+
                                                                |
                 identity, orgs, roles, RLS | Shield detectors | approvals | jobs | events | metrics
                                                                |
                                                     PostgreSQL (RLS, append-only, guards)
```

High-risk inspection (prompts) and execution (untrusted code) run in their own processes, outside the
authorization service, as the directive requires.

## 3. Dependency graph

```
Phase 1 gateway --> Phase 2 identity --> Phases 3-5 autonomy, uncertainty, reasoning --> Phase 9 policy
     |                    |                                                                   |
     |                    +--> Cap 5 secrets and machine identity (partial)                    |
     +--> Phase 4 Shield --> Phase 6 lab --> Cap 7 continuous red teaming (partial)            |
     |                    \-> S2 AI gateway + DLP --> S3 Shadow AI --> Cap 1 agent discovery     |
     +--> MCP proxy --> Cap 2 MCP and tool security (partial) --> Cap 4 runtime protection     |
     +--> Phase 8 integrations --> S1 foundations --> S4 software security --> Cap 3 supply chain
                                                  \-> S5 secure execution
Phase 13 hardening --> Cap 6 kill switch (implemented) --> Cap 9 incident response (partial) --> S6
Phase 7 data inventory --> Cap 8 data lineage (partial)
Phase 3 evidence + audit --> Cap 10 continuous assurance (partial) --> S7 --> S8
```

## 4. Master feature matrix

### Original roadmap (Phases 0 to 15)

| Phase | Capability | Status | Evidence (code and tests) | Verified deployed |
|---|---|---|---|---|
| 0 | Platform audit | Implemented | `docs/AEGIS_FULL_PLATFORM_AUDIT.md` | No |
| 1 | Universal action gateway, six outcomes, SDKs, MCP, bypass detection | Implemented | `packages/core/src/gateway/`, `packages/mcp-gateway/`, `packages/sdk*/`; `gateway.test.ts`, `gateway-outcomes.test.ts`, `enforcement.test.ts`, `mcp-gateway/tests/proxy.test.ts`, `gateway-outcomes.spec.ts` | No |
| 2 | Agent identity and access | Implemented | `packages/core/src/agents/`, `identity/api-keys.ts`; `agent-identity.test.ts`, `agent-access.spec.ts` | No |
| 3 | Managed autonomy | Implemented | `autonomy/`; `autonomy.test.ts`, `autonomy.spec.ts` | No |
| 4 | Uncertainty engine | Implemented | `uncertainty/`; `uncertainty.test.ts`, `uncertainty.spec.ts` | No |
| 5 | Reasoning governance, Decision Inspector | Implemented | `reasoning/`; `reasoning.test.ts`, `inspector.spec.ts` | No |
| 6 | AI security, Attack Simulation Lab | Implemented | `security/lab.ts`, `shield/`; `attack-lab.test.ts`, `injection-response.test.ts`, `lab.spec.ts` | No |
| 7 | Model, data and regulatory governance | Implemented | `governance/`; `model-data-governance.test.ts`, `governance-registry.spec.ts` | No |
| 8 | Integration marketplace, event destinations | Implemented; vendor connections need external accounts | `integrations/`; `destinations.test.ts`, `integrations-marketplace.spec.ts` | No |
| 9 | Advanced policy engine | Implemented | `policy/`; `policy-advanced.test.ts`, `policy-advanced.spec.ts` | No |
| 10 | Enterprise control center | Implemented | `assurance/control-center.ts`; `control-center.spec.ts` | No |
| 11 | Deployment options, residency, Arabic | Implemented; the residency claim needs an operator's attestation | `deployment/`; `deployment.test.ts`, `deployment.spec.ts` | No |
| 12 | Commercial platform, sales demonstration | Implemented; billing provider needs approval and credentials | `commercial/`, `demos/sales.ts`; `commercial.test.ts`, `sales-demo.test.ts`, `commercial.spec.ts` | No |
| 13 | Security hardening and validation | Implemented; no independent penetration test | `docs/SECURITY_VALIDATION.md`; `security-regression.test.ts` | No |
| 14 | Performance and reliability | Implemented; the throughput target is missed | `lib/metrics.ts`, `lib/circuit.ts`, `assurance/ops-alerts.ts`; `reliability.test.ts` | No |
| 15 | Documentation and release | Implemented | this document and the ten others listed in docs/AEGIS_BUILD_PROGRESS.md | No |

### AEGIS Secure track (S0 to S8)

| Phase | Status | What exists | What is missing | Dependency |
|---|---|---|---|---|
| S0 Architecture and threat model | Implemented | This roadmap; `docs/THREAT_MODEL.md` (agent side) | Threat model sections for prompt inspection and execution, written with S2 and S5 | None |
| S1 Foundations | Implemented | Tenancy, policy, evidence, jobs, integrations, metrics are shared; ingestion API for discovery signals (`/v1/shadow-ai/imports`); `ai:chat` key scope; plan entitlements | Live connectors pulling from customer systems | None |
| S2 AI gateway and DLP | Implemented, tested locally | `secure/ai-gateway.ts`, `/v1/ai/chat/completions`, standalone process, console page; see docs/AI_GATEWAY_DLP.md | Streaming, tokenization, exact data matching, approval holds, cost budgets; a run against a real provider | S1 |
| S3 Shadow AI discovery | Implemented, tested with synthetic exports | `secure/shadow-ai.ts`: parsers for Entra, Okta, DNS (including Zeek), managed browser, proxy, endpoint and inventory exports; confirmed, observed and inferred; coverage; app register; see docs/SHADOW_AI.md | Live API connectors, browser extension, DHCP-based linking of DNS to people | S1; customer authorization for each source |
| S4 Open-source security | Implemented, tested with synthetic reports | `secure/software.ts`: requests, SBOM ingestion (CycloneDX, SPDX, npm lockfile), Grype, Trivy, Gitleaks and Scorecard reports, optional OSV.dev, local typosquatting, dependency confusion, install script, integrity and license checks, explained risk, policy, four-eyes decisions, reassessment; see docs/SOFTWARE_SECURITY.md | Signature and attestation verification (Cosign), behavioural analysis, running the scanners inside AEGIS, registry metadata for maintenance | S1 |
| S5 Secure execution | Not implemented | None | Isolated runner (gVisor or microVM), egress control, secrets isolation | Separate host; S1 |
| S6 Investigations | Partial | Security events, incidents with timelines, Decision Inspector | Correlation across signals, investigation workspace, summaries as drafts | S1, S2, S3 |
| S7 Enterprise Control Center | Partial | Control Center (Phase 10) | Secure tiles once S2 to S5 exist | S2 to S5 |
| S8 Hardening and release | Partial | Phases 13 and 14 apply to the shared platform | Validation of the S2 to S5 services | S2 to S5 |

### The ten capability expansions

| # | Capability | Group | Status | Evidence | Gap | Needs |
|---|---|---|---|---|---|---|
| 1 | AI agent discovery | Discover | Partial | `agents/discovery.ts`, Agent Discovery page; `agent-access.spec.ts` | Connectors for cloud, CI/CD and API gateways; verified, inferred and unknown attributes | Customer integrations |
| 2 | MCP and tool security | Core | Partial | `packages/mcp-gateway` (every tool call through the gateway), `shield/tool-security.ts`, tool disable and revoke; `proxy.test.ts` | MCP server inventory page, output inspection, detection of dangerous sequences across tools | None |
| 3 | AI supply-chain security | Secure | Partial | Model registry with lifecycle and evaluations (`governance/models.ts`) | Artifact integrity, provenance, SBOMs for models, MCP servers and packages | S4 |
| 4 | AI runtime protection | Core | Partial | The gateway pipeline (injection signals, data protection, quarantine, autonomy, multi-request velocity rules); the decision and receipt record whether a block happened | Output inspection, sequence analysis, runtime for employee AI apps | S2 |
| 5 | Secrets and machine identity | Identity | Partial | API keys with expiry, revocation and rotation; integration credentials with rotation dates; temporary access; least-privilege recommendations | Inventory of external secrets by reference, vault integrations, exposure alerts | Customer vault |
| 6 | Emergency kill switch and recovery | Core | Implemented | `agents/revocation.ts` (suspend, revoke, void grants, revoke keys and delegations, expire approvals), gateway pause, tool and credential revocation; `agent-identity.test.ts` | A recovery approval workflow and a post-incident review template | None |
| 7 | Continuous AI red teaming | Red Team | Partial | Attack Simulation Lab with scenarios mapped to OWASP LLM Top 10 and MITRE ATLAS, on demand | A schedule, regression tracking across runs, external tools (promptfoo, garak) as optional runners | None |
| 8 | Data lineage and provenance | Discover | Partial | Data inventory with an access audit from permissions and gateway requests (`governance/data.ts`) | A lineage graph across sources, transformations and destinations, with visibility gaps named | S2, S3 |
| 9 | AI incident response | Assurance | Partial | Incidents with timelines, linked security events, continuous governance responses, event destinations to ticketing | Correlation, affected-asset graph, root cause, post-incident report | Capability 1 |
| 10 | Continuous AI assurance | Assurance | Partial | Evidence ledger and signed checkpoints, policy enforcement status, exceptions, framework mappings, assessments | Scheduled control tests with pass and fail history | None |

## 5. Prioritization

The preferred sequence holds against the repository's dependencies:

1. **Foundations** (gateway, identity, policies, autonomy, uncertainty, inspection, audit): implemented and tested. Production verification is still needed.
2. **Secure MVP:** S1 ingestion, then the S2 employee AI gateway with DLP, then S3 Shadow AI from identity-provider logs, then S4 SBOM ingestion. Next to build.
3. **MCP and runtime:** capabilities 2 and 4, sequence analysis and output inspection.
4. **Incident response:** capabilities 6 and 9, recovery approvals, correlation.
5. **Advanced software security:** S4 completion, capability 3, S5.
6. **Continuous assurance:** capability 10 schedules, capabilities 7 and 8.

## 6. Product completeness criteria

| Question | Acceptance criterion | Today |
|---|---|---|
| 1. What AI agents, applications, models, tools and software operate here? | Every agent that calls a connected system appears in the inventory, registered or discovered. Each attribute is labelled verified, inferred or unknown. Models, MCP servers, tools and software components are listed with an owner | Partial. Registered agents, discovered agents, models and tools are listed; there is no software inventory and no MCP server inventory |
| 2. What systems, information and credentials can they access? | For any agent, a list of tools, resources, data classes, credentials and delegations, computed from records, with untracked access named as a gap | Partial. Tools, resources, classification limits, delegations and keys are shown; external credentials are not |
| 3. What actions are they authorized to perform? | A test request for any agent and tool returns the outcome the gateway would give, with the deciding rule. Replay shows the effect of a change on real history | Implemented (simulation, replay, Decision Inspector) |
| 4. Can dangerous behaviour be prevented, contained, investigated and recovered from? | A protected action that policy refuses never runs (tested). Emergency revocation voids every live permission (tested). An incident links every related event. A recovery is approved and recorded | Partial. Prevention and containment are tested; correlation and recovery approvals are not built |
| 5. Can the organization independently verify that its controls worked? | Evidence verifies offline with a published key. Controls are tested on a schedule with history. Exported evidence matches the ledger | Partial. Signed checkpoints and exports verify; scheduled control tests are not built. Independent verification means an auditor running the published verifier, not a certification |

Production readiness additionally needs the owner's deployment approval, a production deployment, an
independent penetration test, a production recovery drill, real integrations with customer
credentials, and pilot feedback. None of these has happened.

## 7. Remaining external dependencies

| Dependency | Needed for | Status |
|---|---|---|
| Owner approval to deploy | Every "verified deployed" entry | Not given |
| Customer identity provider logs or API access | S3 Shadow AI from sign-ins | Not available; test doubles used |
| Vendor accounts (Slack, ServiceNow, Splunk, Datadog, Okta, Entra) | Verifying connectors against real services | Not available |
| A billing provider account | Live billing | Not approved |
| A host that allows gVisor or microVMs | S5 | Not available in this environment |
| An independent security firm | Penetration test | Not engaged |
