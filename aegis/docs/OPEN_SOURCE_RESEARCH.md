# AEGIS open-source research

Date: 2026-10-10. Licenses were checked against each project's public GitHub page on this date. Release numbers are deliberately not recorded here because the GitHub summary pages did not expose them reliably; the dependency inventory in `THIRD_PARTY.md` records the exact versions that AEGIS actually installs.

Decision legend: **Adopt** (run or depend on it), **Adapt** (reimplement its public patterns in our own code, no code copied), **Defer** (good fit later, not in v1), **Reject**.

Guiding constraints:

1. One deterministic authorization path. Two policy engines in the request path would double the failure surface and make "deny on evaluation failure" harder to prove.
2. The first version is a TypeScript modular monolith. Anything that forces a Python or JVM sidecar into the critical path is deferred unless there is no credible alternative.
3. Every dependency must be MIT, Apache-2.0, BSD or ISC. Code with "ee", "enterprise" or commercial folders is only acceptable if we never import from those folders.
4. Nothing from AGPL or GPL repositories is copied. Patterns may be studied from public documentation.

## Authorization and policy engines

### Open Policy Agent (OPA)
- Functionality: general purpose policy engine; policies in Rego; REST API (`/v1/data`), Go library, WASM compilation; decision logs; bundle distribution; `opa test` for policy unit tests.
- License: Apache-2.0. No commercial restrictions.
- Maintenance: CNCF graduated project, very active, thousands of commits.
- Security: mature, widely deployed as a sidecar; decisions depend on the data pushed to it, so input construction remains our responsibility.
- Integration complexity: medium. Needs a sidecar or embedded WASM; Rego has a learning curve for customers who author policies; explaining decisions requires a convention in the policy (returning reasons).
- Decision: **Adapt now, Adopt as optional evaluator.** AEGIS ships an original deterministic policy evaluator in TypeScript (`packages/core/src/policy`) whose policy model mirrors the public concepts OPA popularised: versioned policy documents, input document, deterministic evaluation, structured decision with explanation, policy unit tests. An `OpaEvaluator` adapter implements the same `PolicyEvaluator` interface against OPA's documented `/v1/data` REST API for customers who already run OPA. The adapter is untested against a live OPA in this environment (the OPA binary could not be downloaded from GitHub because the egress policy blocks github.com) and is marked experimental.
- Why: the built-in evaluator keeps the enforcement path in-process, has no network hop to fail open through, is testable with Vitest, and gives customers a JSON policy format that the console can render and edit visually. OPA remains available as an escape hatch.

### OpenFGA
- Functionality: relationship-based access control (Zanzibar model); tuples, authorization model DSL, check and list-objects APIs; PostgreSQL, MySQL, SQLite storage.
- License: Apache-2.0.
- Maintenance: CNCF project, active.
- Security: mature; requires its own service and store.
- Integration complexity: high for v1 (separate service, model language, tuple sync).
- Decision: **Adapt, Defer adoption.** AEGIS models the relationships we need (organization membership, team ownership of agents, delegated approval authority, resource ownership) as first-class tables with a small relationship resolver. The resolver interface is designed so an OpenFGA-backed implementation can replace it when customers need deep relationship graphs.
- Why: our relationship graph is shallow (org, team, owner, delegate). Running a second stateful service for this in v1 adds operational risk without product benefit.

### Cerbos
- Functionality: policy decision point with YAML resource policies, derived roles, condition expressions, testing, audit logs.
- License: Apache-2.0. Cerbos Hub is a commercial add-on; the PDP is open.
- Maintenance: active (Go).
- Security: mature sidecar model.
- Integration complexity: medium, similar to OPA.
- Decision: **Reject as runtime, borrow the authoring UX.** Its YAML resource policy shape (resource, actions, effect, roles, condition) is closer to what governance staff can read than Rego. The AEGIS JSON policy schema borrows this readable shape (original schema, no code).
- Why: one engine rule; OPA has the larger ecosystem if we ever add an external evaluator.

## AI infrastructure

### LiteLLM
- Functionality: OpenAI-compatible proxy over 100+ providers; virtual keys, spend tracking, routing, logging callbacks.
- License: MIT for the core; the `enterprise` directory is under a separate commercial license.
- Maintenance: very active.
- Security: a proxy that holds provider keys is a high-value target; frequent releases mean frequent upgrades.
- Integration complexity: low to run alongside; medium to make AEGIS the source of truth for its key management.
- Decision: **Defer.** AEGIS governs actions and tool calls, not model traffic routing. An integration type `llm_gateway` is reserved in the integrations module so a LiteLLM deployment can forward tool-call intents to the AEGIS gateway. No LiteLLM code is imported.

### LangGraph
- Functionality: stateful agent graphs, checkpoints, interrupt and resume for human approval.
- License: MIT (Python and JS variants).
- Maintenance: active.
- Security: runs inside the customer's agent process; AEGIS cannot rely on it for enforcement.
- Integration complexity: low for an SDK example.
- Decision: **Adapt.** AEGIS provides a small TypeScript client SDK (`packages/sdk`) so an agent built with LangGraph, or anything else, can call `authorize` before a tool runs and `poll` an approval. The approval wait state lives in AEGIS, not in the agent framework, because enforcement must not depend on agent code cooperating. A LangGraph.js example is listed as future work.

### Temporal
- Functionality: durable workflow execution, timers, retries, signals; server plus SDK; needs a database (PostgreSQL, MySQL or Cassandra) and optionally Elasticsearch.
- License: MIT (server and SDKs).
- Maintenance: very active, commercial cloud offering.
- Security: mature; another service to secure and operate.
- Integration complexity: high for v1 (cluster, namespaces, worker fleet).
- Decision: **Defer. Adapt the guarantees.** Approval expiry, retries and recovery are implemented with a PostgreSQL-backed job table (`jobs`) processed by the AEGIS worker using `SELECT ... FOR UPDATE SKIP LOCKED`, idempotency keys and at-least-once delivery with idempotent handlers. Every state transition is in the same transaction as the domain change, which gives us the durability we need for approval timeouts without a second scheduler. Temporal becomes attractive when customers need long-running multi-step agent workflows orchestrated by AEGIS itself; that is out of v1 scope. The worker interface is isolated so a Temporal-backed implementation can replace it.

## Observability

### Langfuse
- Functionality: LLM tracing, prompt management, evaluations, datasets.
- License: MIT except the `ee` folders.
- Maintenance: active.
- Security: self-hostable; traces may contain sensitive prompt data, so data residency matters.
- Integration complexity: low (SDK or OTLP ingestion).
- Decision: **Defer, keep an export seam.** AEGIS evidence events carry `correlationId` and optional `traceId` so an operator can join AEGIS decisions to Langfuse traces. No code dependency in v1.

### OpenTelemetry
- Functionality: vendor-neutral traces, metrics, logs; Node SDK and auto-instrumentation.
- License: Apache-2.0.
- Maintenance: CNCF, very active.
- Security: exporters must be configured to trusted collectors only.
- Integration complexity: low.
- Decision: **Adopt.** `@opentelemetry/api` and the Node SDK instrument the API, gateway and worker. Export is disabled unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Trace ids are written into evidence events.

### SigNoz
- Functionality: APM, logs, metrics and traces on ClickHouse; OTLP native.
- License: MIT with an `ee` directory under a separate license.
- Maintenance: active.
- Security: separate stack (ClickHouse, query service, frontend).
- Integration complexity: low once OpenTelemetry is in place (it is just an OTLP endpoint).
- Decision: **Adopt as a recommended optional backend.** `deploy/docker-compose.observability.yml` documents how to point AEGIS at SigNoz. Not bundled in the default compose file to keep the development footprint small.

## Security

### Microsoft Presidio
- Functionality: PII recognizers (regex, checksum, NLP), anonymizer operators (mask, redact, replace, hash, encrypt), image redaction.
- License: MIT.
- Maintenance: active (Python); project noted a move to a new home.
- Security: good; NLP models bring large dependencies.
- Integration complexity: medium (Python service).
- Decision: **Adapt now, optional Adopt later.** AEGIS implements an original TypeScript detector registry (`packages/core/src/shield/detectors`) following the publicly described recognizer and anonymizer pattern: each detector returns typed spans with a confidence; actions (allow, mask, redact, block, require approval) are applied per data class. Checksum validation is implemented for IBAN (mod 97) and card numbers (Luhn) using the public algorithms. A `presidio` detector provider interface is reserved for customers who want NLP-based detection through a self-hosted Presidio instance.

### Guardrails AI
- Functionality: input and output validators, structured output enforcement; validators distributed through Guardrails Hub, moving to PyPI packages in 2026.
- License: Apache-2.0.
- Maintenance: active, but hosted inference is being discontinued (notice dated July 2026).
- Security: validators run model calls in some cases; hub distribution adds supply-chain surface.
- Integration complexity: medium (Python).
- Decision: **Reject for v1.** AEGIS validates tool-call parameters with JSON Schema (Zod) at the gateway, which is the enforcement point we control. Model output validation belongs to the customer's agent stack.

### Giskard
- Functionality: LLM and ML evaluation, vulnerability scans (injection, hallucination, harmful content), test suites.
- License: Apache-2.0 (v3 direction; v2 no longer maintained).
- Maintenance: active but in transition between major versions.
- Security: evaluation only, not enforcement.
- Integration complexity: medium (Python).
- Decision: **Adapt the test-suite idea, Defer the tool.** AEGIS ships its own security evaluation corpus (`packages/core/src/shield/eval`) of prompt-injection and exfiltration cases that runs in CI against the gateway. This proves enforcement behaviour, which is what AEGIS owns. Model behaviour evaluation stays with the customer.

## Document intelligence

### Docling
- Functionality: layout-aware parsing of PDF, DOCX, PPTX, XLSX, HTML and more; tables; export to Markdown and JSON.
- License: MIT.
- Maintenance: very active (Python, LF AI and Data).
- Security: runs locally; ML models downloaded at install.
- Integration complexity: medium (Python service).
- Decision: **Defer, with a parser interface.** v1 uses `pdf-parse` (MIT) for PDF text, `mammoth` (BSD-2) for DOCX, and native handling for TXT and Markdown. The `DocumentParser` interface accepts a `docling` implementation later for table extraction and complex layouts. This keeps document processing inside the Node process and avoids shipping confidential documents to any other service.

### Qdrant
- Functionality: vector database with filtering, payloads, hybrid search.
- License: Apache-2.0.
- Maintenance: very active (Rust).
- Security: separate service; must be network isolated.
- Integration complexity: medium.
- Decision: **Defer.** v1 retrieval uses a deterministic lexical ranker (BM25, implemented in TypeScript from the public formula) over document chunks stored in PostgreSQL. This is explainable, needs no embeddings provider, and never sends document text outside the deployment. The `Retriever` interface accepts a Qdrant plus embeddings implementation when a customer explicitly authorises an embeddings provider. The assessment UI labels retrieval results as "lexical similarity", never as compliance.

## Summary of the chosen stack

| Concern | Choice | Status |
|---|---|---|
| Policy evaluation | Original TypeScript deterministic evaluator; OPA adapter optional | Built |
| Relationship authorization | Tables plus resolver; OpenFGA later | Built (tables) |
| Durable jobs | PostgreSQL job table plus worker | Built |
| Observability | OpenTelemetry; SigNoz optional | Built (instrumentation) |
| PII detection | Original detector registry; Presidio optional | Built |
| Prompt-injection signals | Original heuristics plus eval corpus | Built |
| Document parsing | pdf-parse, mammoth, native text; Docling later | Built |
| Retrieval | BM25 in PostgreSQL; Qdrant later | Built |
| Model routing | Not in scope; LiteLLM integration type reserved | Deferred |
| Agent workflow | Customer side; SDK provided | SDK built |

See `THIRD_PARTY.md` for every installed package and its license.

## Re-verification for the Secure track (2026-10-14)

This section was added for the AEGIS Secure and platform expansion work. It covers the employee AI gateway, shadow AI discovery, supply chain, sandboxing and red-team candidates. AEGIS copies no source from any project below; the copyleft ones (TruffleHog, Velociraptor, Wazuh) may only ever run as separate processes, and none is a dependency today.


**How I checked:** `gh` and plain `curl` to api.github.com are blocked in this session. I used two other routes instead:
- **License and activity:** GitHub repository search (MCP). It returns each repo's `license.spdx_id` and `pushed_at`. "Active" below means the last push was within 3 months (on or after 2026-07-14). That counts pushes, not individual commits.
- **Releases and license files:** WebFetch of `github.com/<repo>/releases/latest` and the LICENSE files. GitHub leaves the year off dates in the current year, so release dates with no year shown are 2026. Where a page confirmed the year (tag name or changelog), the table says so.

| Project | Repository | License (verified) | Mixed-license parts | Latest release (date) | Active? | Use in AEGIS | Integration shape |
|---|---|---|---|---|---|---|---|
| OPA | open-policy-agent/opa | Apache-2.0 | None in top-level LICENSE | v1.21.2 (2026-10-12, atom feed) | Yes (push 2026-10-14) | Central policy decisions (Rego) for AI tool, data and model access | Go; sidecar or separate service, or Wasm/Go library |
| Cedar | cedar-policy/cedar | Apache-2.0 | None seen | cedar-policy-cli-v4.13.0 (15 Sep) | Yes (10-13) | Fast, analyzable authorization policies for agent actions | Rust library (Wasm/bindings) embedded in-process |
| Keycloak | keycloak/keycloak | Apache-2.0 | None seen | 26.8.1 (13 Oct) | Yes (10-14) | SSO, OIDC/SAML identity broker for users and services | Java; separate service |
| OpenTelemetry JS | open-telemetry/opentelemetry-js | Apache-2.0 | None seen | v2.12.0 (6 Oct) | Yes (10-13) | Tracing and metrics for AI calls and the policy path | TypeScript/Node library |
| Langfuse | langfuse/langfuse | MIT core ("MIT Expat") | **ee/, web/src/ee/, worker/src/ee/ under the proprietary Langfuse Enterprise License** | v4.59.0 (14 Oct) | Yes (10-14) | LLM trace, prompt and eval observability | TypeScript; separate service (needs Postgres/ClickHouse) |
| LangGraph | langchain-ai/langgraph | MIT | None in top-level license (sub-packages not checked) | cli==0.4.34 (13 Oct); this is the CLI tag, the core package tag was not checked | Yes (10-14) | Stateful agent orchestration with human approval steps | Python (JS port separate); library |
| MCP TypeScript SDK | modelcontextprotocol/typescript-sdk | Mixed: Apache-2.0 for new code, MIT for older contributions not yet relicensed, CC-BY-4.0 docs (GitHub shows NOASSERTION) | Moving from MIT to Apache-2.0 | v2.3.1 (5 Oct) | Yes (10-14) | Build or inspect MCP clients and servers, and an MCP gateway for policy enforcement | TypeScript library |
| MCP servers | modelcontextprotocol/servers | Same mixed Apache-2.0 / MIT / CC-BY-4.0 | Same transition | v1.0.0 (11 Oct) | Yes (10-13) | Reference MCP servers for testing gateway controls | Node/Python; separate processes |
| promptfoo | promptfoo/promptfoo | MIT (root LICENSE, "Copyright Promptfoo 2025") | None stated in root LICENSE; subdirectories not checked | 0.124.1 (2026-10-08, changelog) | Yes (10-14) | LLM red-teaming and eval in CI | TypeScript/Node CLI or library |
| garak | NVIDIA/garak (leondz/garak gave no search result; NVIDIA/garak is current) | Apache-2.0 | None seen | v0.17.0 (9 Sep) | Yes (10-10) | LLM vulnerability scanning (jailbreak, leakage probes) | Python CLI; batch job |
| NeMo Guardrails | **NVIDIA-NeMo/Guardrails** (current location; NVIDIA/NeMo-Guardrails gave no search result) | Apache-2.0 (LICENSE.md SPDX line; GitHub shows NOASSERTION) | None seen | v0.24.1 (16 Sep) | Yes (10-14) | Runtime input and output rails for LLM apps | Python library or guardrails server |
| Guardrails AI | guardrails-ai/guardrails | Apache-2.0 | None seen (validators in the Hub are separate repos) | v0.11.0 (14 Aug) | Yes (10-09) | Output validation and structured-output checks | Python library or server |
| Presidio | **data-privacy-stack/presidio** (moved from microsoft/presidio) | MIT ("Copyright (c) Presidio Contributors") | None seen | 2.2.364 (22 Jul) | Yes (10-09) | PII detection and redaction before prompts leave AEGIS | Python; library or analyzer/anonymizer REST services |
| OpenFGA | openfga/openfga | Apache-2.0 | None seen | v1.22.0 (6 Oct) | Yes (10-13) | Relationship-based authorization (Zanzibar-style) for tenants, agents and resources | Go; separate service |
| SPIFFE | spiffe/spiffe | Apache-2.0 | None seen | No releases | Yes (09-26) | Workload identity standard and spec | Spec only, no runtime |
| SPIRE | spiffe/spire | Apache-2.0 | None seen | v1.15.3 (21 Aug) | Yes (10-11) | Issues SPIFFE IDs (SVIDs) to agents and services for mTLS | Go; server plus per-node agent |
| Temporal | temporalio/temporal | MIT (Temporal and Uber copyrights, no carve-outs) | None | v1.32.1 (8 Oct) | Yes (10-14) | Durable workflows for approvals and remediation | Go server; separate service plus SDK workers |
| SOPS | getsops/sops | **MPL-2.0** | - | v3.13.3 (23 Jul) | Yes (10-13) | Encrypted secrets in Git (KMS/age) | Go CLI or library |
| Trivy | aquasecurity/trivy | Apache-2.0 | None seen | v0.75.0 (2026-10-01) | Yes (10-14) | Container, IaC, secret and SBOM scanning | Go CLI or server; CI job |
| LiteLLM | BerriAI/litellm | MIT outside enterprise/ (GitHub shows NOASSERTION) | **enterprise/ under the proprietary BerriAI Enterprise License; production use needs a paid subscription** | v1.105.1 (14 Oct) | Yes (10-14) | AI gateway: one API across many LLMs, with cost tracking and a guardrail hook | Python SDK or proxy service |
| Syft | anchore/syft | Apache-2.0 | None seen | v1.54.1 (6 Oct) | Yes (10-12) | SBOM generation for models and containers | Go CLI or library |
| Grype | anchore/grype | Apache-2.0 | None seen | v0.120.1 (6 Oct) | Yes (10-13) | Vulnerability matching against SBOMs | Go CLI or library |
| OpenSSF Scorecard | ossf/scorecard | Apache-2.0 | None seen | v5.6.0 (12 Oct) | Yes (10-12) | Supply-chain risk scoring of dependencies | Go CLI or GitHub Action |
| Package Analysis | ossf/package-analysis | Apache-2.0 | None seen | rel-38 (20 May) | Yes (09-25) | Dynamic analysis of packages for malicious behavior | Go; sandboxed batch service |
| Cosign | sigstore/cosign | Apache-2.0 | None seen | v3.1.3 (6 Aug) | Yes (10-14) | Signing and verifying images, models and attestations | Go CLI or library |
| Gitleaks | gitleaks/gitleaks | MIT | None seen | v8.30.1 (21 Mar) | Yes (09-30); no release since March | Secret scanning in repos and CI | Go CLI or library |
| TruffleHog | trufflesecurity/trufflehog | **AGPL-3.0** | - | v3.99.2 (8 Oct) | Yes (10-14) | Secret detection with live credential checks | Go CLI; run as a separate binary only |
| gVisor | google/gvisor | Apache-2.0 | None seen | release-20261005.0 (8 Oct) | Yes (10-14) | Sandboxes agent code and tool execution | Go; OCI runtime (runsc) |
| Firecracker | firecracker-microvm/firecracker | Apache-2.0 | None seen | v1.17.0 (10 Sep) | Yes (10-14) | MicroVM isolation for untrusted agent workloads | Rust VMM; host-level service (KVM) |
| Wazuh | wazuh/wazuh | **GPL-2.0** (OpenSSL linking exception on some files; GitHub shows NOASSERTION) | License says it also covers decoders, rules and data files | v4.14.8 (25 Sep) | Yes (10-14) | SIEM/XDR: endpoint telemetry and alerting | C/C++; separate manager plus agents |
| Velociraptor | Velocidex/velociraptor | **AGPL-3.0** (GitHub shows NOASSERTION) | - | v0.77.3 (5 Oct) | Yes (10-13) | Digital forensics and incident response (DFIR) on endpoints | Go; separate server plus clients |
| Zeek | zeek/zeek | BSD-3-Clause (COPYING text; GitHub shows NOASSERTION) | Not checked | v9.0.0 (21 Aug) | Yes (10-13) | Network traffic analysis and logs of AI egress | C++; separate sensor service |

### Copyleft or source-available licenses to review

**Do not copy source from these; run them only as separate processes:**
- **TruffleHog: AGPL-3.0.** The network-use clause applies if it is modified and offered as a service. Gitleaks (MIT) is the permissive alternative.
- **Velociraptor: AGPL-3.0.**
- **Wazuh: GPL-2.0.** This also covers its rules and decoders.

**Weak copyleft:**
- **SOPS: MPL-2.0.** Copyleft applies per file. Using it as a CLI or library is fine; if you modify SOPS files, those files must stay MPL.

**Source-available or commercial parts inside otherwise permissive repos:**
- **Langfuse:** the `ee/`, `web/src/ee/` and `worker/src/ee/` directories are under a proprietary Enterprise License. Free for development and testing; production needs a subscription; redistribution is forbidden.
- **LiteLLM:** the `enterprise/` directory is under the proprietary BerriAI Enterprise License. Production use needs a seat-based subscription. Avoid copying from or enabling these features without a contract.

**License in transition, not copyleft:**
- **MCP typescript-sdk and servers** are moving from MIT to Apache-2.0, with CC-BY-4.0 docs. Keep both MIT and Apache notices when reusing code.

None of the 33 repos showed SSPL, BUSL or Elastic licensing in the files I checked.

### Not verified
- **Release years:** most release pages showed only day and month. They are taken as 2026 because GitHub omits the current year. Years were confirmed for OPA (atom feed), promptfoo and Trivy (changelog), and gVisor (tag name).
- **Repo moves:** the moves of Presidio (to data-privacy-stack, with the same 2018 repo creation date) and NeMo Guardrails (to NVIDIA-NeMo) are inferred from search results. I did not see a redirect notice. The garak case is likewise inferred: leondz/garak gave no search result and NVIDIA/garak is the active repo.
- **Subdirectory licenses:** these were not checked beyond the top-level LICENSE for promptfoo, LangGraph (its sub-packages and the separately distributed LangGraph Platform/API), Keycloak, Zeek and the other Apache/MIT repos.
- **LangGraph core package:** its latest release tag was not checked; the table shows the CLI tag only.
- **Commit-level activity:** "Active" is based on the repo's last push time, not a count of commits in the last 3 months.
