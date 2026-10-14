# AEGIS development provenance record

Started 2026-10-13. This file records how AEGIS was developed, which work needs independent review, and the technical foundations chosen for each new area. Add to it at the end of every phase. Do not delete or rewrite entries.

This record is not legal clearance. Qualified counsel must review the founder's existing agreements, including any NDA with DNRS, and the IP position before the company describes itself as legally cleared.

## 1. Development policy (effective 2026-10-13)

Founder's direction of 2026-10-13: DNRS must not be used as a technical, architectural, research, product or commercial reference for any part of AEGIS, now or in future. This excludes DNRS confidential information, presentations, demonstrations, private discussions, workflows, diagrams, architecture, branding, product-specific terminology, and use of DNRS as a competitor reference or benchmark.

AEGIS is built from:
- Independently written designs.
- Public technical standards.
- Published academic research.
- Open source software under licences recorded in `docs/THIRD_PARTY.md`.

Each phase lists its foundations in section 4.

## 2. How the code was written

- **Authorship.** Commits in this repository are authored by the Claude identity or a CI bot. Commit trailers record the AI assistance and the session. The founder directed the work through written briefs.
- **Repository.** The repository is the personal GitHub repository `jzaky/School`, branch `claude/aegis-ai-governance-bgmcnk`. It also contains a separate school operations product outside the `aegis/` directory.
- **First AEGIS commit:** 2854e21 on 2026-10-10.
- **Archive.** The file `aegis-source.zip` at the repository root is ignored by git and is not part of the tracked history. Its contents are not covered by this record.
- **Copied code.** No third-party source code was copied. `docs/THIRD_PARTY.md` lists dependencies and the public specifications from which algorithms were implemented.

## 3. Work flagged for independent review

DNRS is mentioned in this repository in two ways:
- **Earliest mention:** `docs/REAL_WORLD_VALIDATION.md` (commit 5c3620c, 2026-10-11) names a DNRS product in its section 5 heading.
- **Comparison:** `docs/COMPARISON_DNRS.md` (commit cd58429, 2026-10-13) is a comparison written from DNRS's public web pages. It ends with a list of "ideas worth taking". The work below was built on 2026-10-13 after that comparison, and several items follow its list.

Every item below was implemented from AEGIS's own engine and code. None was built from DNRS confidential material, as far as this repository records. Because they followed a document that analysed DNRS, they are flagged for counsel's review and are not treated as cleared.

| Commit | Date | Work | Relation to the comparison |
|---|---|---|---|
| 5c3620c | 2026-10-11 | Real-world validation plan, including the "certainty-band policy set" and a section contrasting static document checks with a DNRS product | Names a DNRS product and discusses its approach |
| cd58429 | 2026-10-13 | `docs/COMPARISON_DNRS.md` | Analysis of DNRS public pages |
| 0887fa9 | 2026-10-13 | Score-band policy template | Item 1 of the comparison's list |
| 010ba44 | 2026-10-13 | Replay calibration of draft policies | Item 2 |
| 12a5ec8 | 2026-10-13 | Autonomy posture per agent and the boundary sentence on approvals | Items 3 and 4 |
| b9b5d1c | 2026-10-13 | AEGIS Trading: trading mandate template, Alpaca paper connector, demo | Item 8 |
| 30ffee0 | 2026-10-13 | Ten framework catalogs, free public checker, Proof page | Items 5, 6 and 7 |
| Several | 2026-10-13 | `docs/STATUS.md` and `docs/PROGRESS_REPORT_2026-10-13.md` sections on DNRS follow-ups | Reporting of the above |

**Not flagged:** work before 2026-10-11, and Phases 0 to 2 of the enterprise expansion. That covers the gateway outcomes, signed grants, delegation, agent identity, SSO, SCIM and the SDKs, which were designed from the founder's expansion brief and public standards. Counsel may widen the review if the NDA's dates or scope require it.

**Handling.**
- The flagged documents stay in the repository unchanged, apart from a notice at the top of the comparison.
- The flagged features stay in the product until counsel advises.
- Phase 3 replaces the autonomy posture with an independently specified autonomy model (section 4).
- The old posture function remains in git history and stays in the code until its callers have moved.

## 4. Independent technical foundations by phase

### Phase 3: managed autonomy
- **Levels of automation.** The human-automation literature on levels of automation: Sheridan and Verplank (1978), "Human and Computer Control of Undersea Teleoperators"; Parasuraman, Sheridan and Wickens (2000), "A Model for Types and Levels of Human Interaction with Automation", IEEE Transactions on Systems, Man, and Cybernetics. AEGIS uses its own five levels (0 to 4) defined by what the gateway enforces, not by any vendor's states.
- **Risk management.** NIST AI Risk Management Framework 1.0 (NIST AI 100-1, 2023), Govern and Manage functions, for human oversight and documented decisions.
- **Transitions.** A deterministic finite state machine with an explicit transition table. This is standard computer science, with no external source.
- **Evidence.** Every transition is written to the existing AEGIS evidence ledger.

### Phase 4: uncertainty governance
- **Uncertainty in measurement.** JCGM 100:2008, Guide to the Expression of Uncertainty in Measurement, for the distinction between evaluated (statistical) and non-statistical uncertainty. AEGIS labels indicators "heuristic" unless they come from a calibrated source.
- **Calibration.** Guo, Pleiss, Sun and Weinberger (2017), "On Calibration of Modern Neural Networks" (ICML), for expected calibration error, used only when a customer supplies outcome-labelled scores.
- **Evidence quality.** Data quality dimensions from ISO/IEC 25012 (completeness, consistency, currentness, credibility) for evidence checks.

### Phase 5: reasoning governance
- **Decision records.** W3C PROV-DM (2013) provenance data model for the structure of entities, activities and agents in a decision record.
- **Scope.** AEGIS governs observable artifacts only: inputs, cited evidence, tool calls, policy results and the stated rationale an agent submits. It does not claim access to hidden model reasoning.

### Phase 6: AI security and the Attack Simulation Lab
- **Threat taxonomies.** OWASP Top 10 for Large Language Model Applications, 2025 edition (LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM06 Excessive Agency, LLM09 Misinformation), and MITRE ATLAS (Adversarial Threat Landscape for Artificial-Intelligence Systems) technique identifiers. Both are public catalogs, used only to label scenarios; the mapping is AEGIS's own.
- **Test data.** The card number is the widely published test number 4111 1111 1111 1111, and the IBAN is a checksum-valid example. Neither belongs to anyone.
- **Method.** Regression testing of the organization's own configuration through the production code path (decision-only), which is standard software testing practice, with no external source.

### Phase 7: model governance, data governance and regulatory change
- **AI management systems.** ISO/IEC 42001:2023 (AI system life cycle, impact assessment, data for AI systems) and the NIST AI Risk Management Framework 1.0 (Map, Measure, Manage), for the stages, evaluations and periodic review. Both are already in the AEGIS framework catalog.
- **Model and dataset documentation.** Mitchell et al. (2019), "Model Cards for Model Reporting" (FAT* 2019), and Gebru et al. (2021), "Datasheets for Datasets" (Communications of the ACM), for the kinds of facts recorded per model and per dataset.
- **Erasure.** The right to erasure as described in GDPR Article 17 and the UAE Personal Data Protection Law, for the deletion request workflow. AEGIS records decisions; it does not determine legal obligations.
- **Regulatory facts.** The EU AI Act general-purpose AI obligations date (2 August 2025) is from Regulation (EU) 2024/1689. Every other regulatory entry in the demo is marked illustrative.

### Phase 8: integrations and event destinations
- **Vendor protocols.** Built from each provider's public API documentation: Slack incoming webhooks and Block Kit, Microsoft Teams workflow webhooks with Adaptive Cards 1.4, Splunk HTTP Event Collector, Datadog Logs intake API v2, and the ServiceNow Table API. No vendor SDK or source code is used.
- **Webhook signing.** HMAC-SHA-256 over a timestamp and the raw body (RFC 2104), the same scheme AEGIS already used for inbound webhooks.
- **Network safety.** Address ranges from RFC 1918, RFC 6598, RFC 3927, RFC 4193 and RFC 4291, and the OWASP guidance on server-side request forgery.
- **Delivery.** The transactional outbox pattern (a cursor over an append-only log, a unique delivery per destination and event, retries with backoff), which is standard practice with no single source.

### Phase 9: advanced policy management
- **Combining and conflicts.** Deny-overrides combination as in XACML 3.0 (OASIS, 2013); conflict detection by satisfiability of rule conditions, as in the policy analysis literature (for example Fisler et al., "Verification and change-impact analysis of access-control policies", ICSE 2005). AEGIS confirms each overlap with a concrete witness evaluated by its own engine.
- **Normal forms.** Disjunctive normal form and De Morgan's laws, standard logic.
- **Exceptions.** Time-limited, two-person approved exceptions follow common change-management practice (ISO/IEC 27001:2022 Annex A 8.32 change management; the separation of duties control 5.3).

### Phase 10: enterprise control center
- **Theme without flash.** An inline script sets the theme attribute before the stylesheet applies, a widely used pattern (for example the MIT-licensed next-themes project). AEGIS implements its own short version; no code was copied.
- **Health from evidence.** Judging a service by the records it should leave (heartbeats, checkpoints) follows common observability practice (Google SRE book, "Monitoring Distributed Systems", 2016).

### Phase 11: deployment options and localization
- **Residency.** The approach (inventory every component and subprocessor, record location and attestation) follows the records-of-processing and transfer duties in the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021, articles on cross-border transfer) and GDPR Article 30. AEGIS checks the operator's records for completeness; it does not interpret the law.
- **Readiness checks.** PostgreSQL's own catalogs (`pg_stat_ssl`, `pg_roles`, `pg_class.relrowsecurity`, `pg_trigger`), as documented in the PostgreSQL 16 manual.
- **Localization.** Unicode Bidirectional Algorithm (UAX #9) isolation with `dir="auto"` and `<bdi>`; W3C "Structural markup and right-to-left text in HTML". Number formats from the ECMAScript Internationalization API (ECMA-402) with the `nu-latn` extension.

### Phase 12: commercial platform
- **Money arithmetic.** Integer minor units and basis points, half-up rounding: the approach recommended for monetary values in financial software (for example Martin Fowler, Patterns of Enterprise Application Architecture, 2002, the Money pattern). No library code used.
- **Usage metering.** Idempotent upsert per period and metric, the pattern used by metered billing systems so retries never double count.
- **Customer health measures.** Common customer success practice (adoption, activity and support signals); the measures here are computed from records, not scored by a model.

### Phase 13: security hardening
- **Foreign keys and row-level security.** The PostgreSQL 16 manual (section 5.8, row security policies) notes that referential integrity checks bypass row security; the guard triggers close that gap.
- **DNS rebinding.** OWASP Server-Side Request Forgery Prevention Cheat Sheet: validate the resolved address used for the connection, not a separate lookup.
- **Advisory locks.** PostgreSQL `pg_advisory_xact_lock`, transaction-scoped.
- **Fail closed.** NIST SP 800-53 Rev. 5 SC-24 (fail in known state) and SC-7(18) (fail secure).

### Phase 14: performance and reliability
- **Metrics format.** Prometheus text exposition format 0.0.4 and the OpenTelemetry metrics API (both Apache 2.0 specifications); AEGIS writes the text format itself.
- **Circuit breaker.** The pattern described by Michael Nygard, Release It! (2007), as summarised in Martin Fowler's "CircuitBreaker" (2014).
- **Dead-letter queue and backpressure.** Common messaging practice (Enterprise Integration Patterns, Hohpe and Woolf, 2003: Dead Letter Channel).

Later phases add their foundations here.

### Secure and validation work (2026-10-14)

- **AI Gateway and data protection.**
  - OpenAI chat completions request and response format (public API reference).
  - Luhn checksum.
  - IBAN mod-97 (ISO 7064).
  - Detectors written by AEGIS.
- **Shadow AI discovery and the Entra ID connector.** Microsoft Graph public documentation:
  - `auditLogs/signIns` and `auditLogs/directoryAudits`;
  - OAuth 2.0 client credentials (RFC 6749);
  - the `Retry-After` header (RFC 9110).

  The Okta specification follows Okta's public System Log API documentation.
- **Software approvals.**
  - CycloneDX and SPDX specifications.
  - The OSV.dev public API schema.
  - OpenSSF Scorecard output format.
  - Grype, Trivy and Gitleaks report formats, read as data only. No scanner code is included.
- **Gateway throughput.** PostgreSQL advisory locks and transaction semantics (PostgreSQL documentation).
- **Staging, penetration-test readiness and pilot demo.** STRIDE threat modelling and OWASP testing guidance (public).
- **Brochure and technical capabilities document.** Screenshots of the AEGIS console with the synthetic demo tenant. Figures come from AEGIS's own recorded runs.

### Quant OS integration research and design (2026-10-14)

Recorded in `docs/QUANTOS_INTEGRATION.md`. Design only; nothing implemented, no trades placed, no dependencies installed.

**Sources used:**
- Quant OS's own repository (`jzaky/quantos`, commit `8c27f61`), owned by the same founder.
- AEGIS's existing agent-mode gateway, grant and evidence design.
- Public licence and manifest files of the 22 open-source projects reviewed. They were read to classify licences; no code was copied from any of them.
- Alpaca's public paper-trading API documentation: the `client_order_id` and order lookup endpoints.
- EU AI Act Article 17(1): public law text.
- Public reporting on EN 18286:2026, used only for its status and scope.

**Rules carried forward:**
- **EN 18286.** AEGIS will store EN 18286 clause numbers and its own descriptive wording only. They are entered from a licensed copy, and the standard's text, structure and tables are never reproduced.
- **Quant parameters.** No external scoring weights, gate structures or tier thresholds were reproduced or are to be reproduced. The Quant OS risk-governor limits referenced in the design are the values already in Quant OS's own code. Any new risk limits will be designed from public finance methods and cited: for example the Kelly criterion (Kelly, 1956), volatility targeting, and drawdown and exposure limits as described in public practitioner literature.
- **No confidential material.** No third-party confidential material was available or used.
