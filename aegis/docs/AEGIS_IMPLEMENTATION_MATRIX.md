# Implementation matrix

Maps each phase of the master engineering program to what the repository holds today, based on the October 2026
code audit (three independent reviews of the source, not of the documentation) and on test runs on 2026-10-29:
core 531 tests, API 61, database isolation 22, SDK 19, MCP gateway 8, all passing. Defects are tracked in `DEFECT_REGISTER.md`.

Status:
- **Works**: built, tested, and the audit found no open P1 or P2 against it.
- **Works, P2 open**: built and tested, with a weakness listed in the defect register.
- **Partial**: some of the phase exists; the gap is named.
- **Missing**: not built.
- **Don't build (yet)**: deliberately deferred, with the reason.

Complexity: S (days), M (one to two weeks), L (several weeks), XL (a quarter or more, or needs outside parties).

## Workstream I: verify and harden what exists

| Phase | Status | Evidence | Next | Cx | Milestone |
| --- | --- | --- | --- | --- | --- |
| 0 System discovery | Works | This matrix, `DEFECT_REGISTER.md`, `AEGIS_FULL_PLATFORM_AUDIT.md` | Keep current per milestone | S | M1 |
| 1 Open-source repository evaluation | Partial | `OPEN_SOURCE_RESEARCH.md`, `PROVENANCE.md`; `THIRD_PARTY.md` is stale | Refresh the third-party inventory, sharp licence note | S | M1 |
| 2 Comprehensive security audit | Works, P2 open | 7 P1s and 14 of 16 P2s fixed with regression tests, P2-7 in part | P2-7 (external anchor), P2-14 | M | M1 |
| 3 Real AI agent red teaming | Partial | Attack Simulation Lab, held-out injection dataset run (`LIVE_VALIDATION.md`: recall 30% on held-out data) | Live-model runs need `ANTHROPIC_API_KEY` (blocked: not configured) | M | M1 |
| 4 Receipt and financial validation | Works | `RECEIPT_VALIDATION.md`, `PAYMENT_MATCHING.md`, 10 receipt tests with real images | Done: console panel and demo claims; P2-13 fixed. Next: scanned-receipt extraction | S | M1 |
| 5 Governance engine hardening | Works, P2 open | Delegation, execution window, policy-version binding (P1-2, P1-5), agent-mode grants and revoke rights (P2-6, P2-12), resource binding (P2-3) fixed | Principal binding | M | M1 |
| 6 Performance and reliability | Works | `PERFORMANCE.md` benchmarks, circuit breakers, dead-letter queue | Re-run benchmark after P1 changes | S | M2 |
| 7 Observability | Works | OpenTelemetry, structured logs, metrics, alerts | None urgent | S | M2 |
| 8 Automated testing | Works | Core, API, database and browser suites in CI; Proof page figures checked in CI | SBOMs, pinned actions, and CodeQL plus Semgrep with a blocking gate are in CI (`SAST.md`) | S | M1 |
| 9 User experience | Works | Control Center, Arabic console, onboarding, receipt validation panel | None urgent | S | M2 |
| 10 Live integration verification | Partial | OSV.dev and the injection dataset run live; Stripe and Alpaca only against fake servers in CI; Entra connector tested against recorded responses | Stripe test mode and Alpaca paper need the owner's sandbox keys | M | M1 |
| 11 Defect remediation | Partial | P1 done; P2 and P3 open | Work the register in order | M | M1 |
| 12 Production readiness | Partial | Deploy kits, backup docs, pentest readiness pack; no external pentest yet; not deployed to production | External pentest; deployment only with the owner's approval | L | M5 |

## Workstream II: core governance capabilities

| Phase | Status | Evidence | Next | Cx | Milestone |
| --- | --- | --- | --- | --- | --- |
| 13 Agent autonomy management | Works | Levels 0 to 4, deterministic transitions, history | None | S | M2 |
| 14 Real-time uncertainty engine | Works | Uncertainty assessment feeds policy input; low confidence escalates (P2-8 fixed) | None | S | M2 |
| 15 Decision Inspector | Works | Full rule and comparison trace per decision | None | S | M2 |
| 16 Agent-to-agent governance | Works | Delegations; delegate bound by delegator limits and policies (P1-5, P2-12 fixed) | None | S | M2 |
| 17 Continuous attack simulation | Works | On-demand and scheduled lab runs (daily or weekly per agent); a newly opened gap raises a high-severity event; organization-defined, versioned custom scenarios from templates, judged expected against actual | Multi-step scenarios | M | M2 |
| 18 Model and data governance | Works | Model registry, data inventory | None | S | M2 |
| 19 Autonomous incident containment | Works | Continuous Governance automatic responses, emergency pause, freezes | None | S | M2 |
| 20 Cryptographic evidence | Partial | Hash-chained, signed checkpoints; the verifier can pin the key and the expected last record | External anchoring of checkpoints | M | M2 |
| 21 Enterprise integration marketplace | Works | Connector catalog, generic HTTPS connector | None | S | M2 |
| 22 Enterprise control center | Works | Control Center, System Health | None | S | M2 |

## Workstream III: enterprise reach

| Phase | Status | Evidence | Next | Cx | Milestone |
| --- | --- | --- | --- | --- | --- |
| 23 AI discovery and inventory | Works | Shadow AI discovery; links by stable id only (P2-10 fixed) | None | S | M3 |
| 24 Execution-path coverage | Partial | Bypass detection; enforcement coverage from observed traffic (P2-11 fixed) | Network-level observation for agents outside the SDK | M | M3 |
| 25 Enterprise deployment and resilience | Partial | Compose (ports on localhost by default), offline install, deployment profiles | Production restore drill with point-in-time recovery | M | M5 |
| 26 Compliance and assurance | Works | 21 framework catalogs, 487 controls, ISO 27001 readiness pack. Internal mapping only, not certification | None; never describe as certified | S | M5 |
| 27 Commercial infrastructure | Works | Plans, metering, invoices in each currency's decimals; trials always end | None | S | M5 |

## Workstream IV: new capabilities

| Phase | Status | Next | Cx | Milestone |
| --- | --- | --- | --- | --- |
| 28 Universal AI action firewall | Partial: gateway, SDK adapters, MCP gateway exist; network-level interception does not | Proxy mode for agents that cannot use the SDK | L | M3 |
| 29 AI autonomy operating system | Missing (budgets, quotas across agents) | Per-agent and per-team action budgets on the existing gateway | M | M4 |
| 30 Predictive action risk engine | Missing | Don't build yet: needs months of real decision data to be more than a heuristic. Use precedent and replay in the meantime | L | M4 |
| 31 AI digital twin | Partial: policy replay over 30 days of history | Extend replay to "what if" agent changes | M | M4 |
| 32 Agent trust passport | Missing | Signed, exportable agent identity and record; design after P2-7 | M | M4 |
| 33 Universal emergency revocation | Partial: org-wide pause, agent suspension, grant voiding | Revocation fan-out to connected systems | M | M3 |
| 34 AI chain-of-custody engine | Partial: evidence ledger links request, decision, approval and execution | Lineage across delegations and documents | M | M4 |
| 35 Self-testing governance | Partial: policy tests run on review; impact test | Scheduled self-tests with alerts | S | M4 |
| 36 Cross-organization agent trust | Missing | Don't build yet: needs a second real organization and P2-7 | XL | M6 |
| 37 AI governance exchange | Missing | Don't build yet: a marketplace with no customers is dead UI | XL | M6 |

## Workstream V: universal architecture

| Phase | Status | Next | Cx | Milestone |
| --- | --- | --- | --- | --- |
| 38 Universal governance architecture | Works: tool, resource and policy model is sector-neutral; no currency or region assumed in core | Default the refund template currency to the organization's own | S | M6 |
| 39 Industry policy packs | Works: sector templates and pilot kits | UAE frameworks only for UAE-resident organizations (done) | S | M6 |
| 40 Global and jurisdictional support | Partial: English and Arabic, UAE and GCC VAT rules, data residency settings | Add jurisdictions as customers need them | M | M6 |

## Workstream VI: validation and market

| Phase | Status | Next | Cx | Milestone |
| --- | --- | --- | --- | --- |
| 41 Competitive intelligence | Partial: `COMPARISON_DNRS.md` | Refresh before any public comparison; never claim first, only or best without independent evidence | S | M7 |
| 42 Technical differentiation research | Partial | Get legal advice before publishing anything potentially patentable | S | M7 |
| 43 Enterprise demonstrations | Works: six demo scenarios, impact test, platform tour | Receipt validation is in the demo; next, a guided demo scenario for it | S | M7 |
| 44 Independent validation | Missing: no external pentest or audit yet | External pentest (RFQ ready in `PENTEST_RFQ.md`) | XL | M7 |
| 45 Customer pilots | Partial: pilot kits and watch-only mode are built; no live pilot | Needs a customer | XL | M7 |

## Blockers that need the owner

- `ANTHROPIC_API_KEY` for live-model red teaming (phase 3).
- `AEGIS_VALIDATE_EMAIL_TO` for live email validation.
- Stripe test-mode and Alpaca paper keys for live connector checks (phase 10).
- Approval before any production deployment (phase 12).
- An external pentest firm and a pilot customer (phases 44 and 45).
