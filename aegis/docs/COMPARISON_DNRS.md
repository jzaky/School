# DNRS.ai and AEGIS: what they say, what we have, what to take from it

Read on 2026-10-13 from the public pages of dnrs.ai and its demo sites (smartautonomydemos.com, smartaiden.com). Every DNRS statement below is their public wording or a paraphrase of it. This document compares positioning and public ideas only. The brief forbids reproducing DNRS.ai or SMARt proprietary technology, so nothing here is an implementation specification taken from them; the "take from it" section describes AEGIS features designed on our own terms.

## 1. What DNRS.ai is, in their words

**Tagline.** "A transformative digital companion providing Defensible NextGen Reasoning and Safety framework for critical infrastructures and complex societal-scale systems." Home page headline: "SMARt-Governed AI That Generates Measurable Returns."

**Core idea: SMARt, four autonomy states.** Stable (acts autonomously when "observations align"), Meta-Cognitive ("ambiguity detected, the system pauses to re-evaluate"), Assisted ("reaches out to tools, data, or human experts"), Regulated/Revoked ("human command... full autonomy relinquishment"). Their one-line principle: "DNRS doesn't make AI deterministic. It places probabilistic agents inside deterministic governance boundaries."

**Positioning against other governance tools.** "Most governance tools are external filters applied after the fact. SMARt intervenes within the reasoning process." And: "Stop auditing beliefs. Start generating governed returns." Governance is sold as the thing that makes autonomy profitable, not as compliance overhead.

**What it is commercially.** Their FAQ: "SMARt is not plug-and-play. Every engagement requires DNRS.ai to work alongside your team... This is collaborative implementation, not software installation." Engagement is "project-based or ongoing advisory retainers... Framework licensing available under separate terms." Three paths: 1 Governance Assessment (discovery), 2 SMARt Start (a "middleware layer that sits between your existing LLM/GenAI systems and your operational infrastructure", "4-8 weeks from assessment to production governance layer"), 3 Native Intelligence (embedded in model architecture, for "institutions with control over model parameters").

**Proof they show.** One live system and five simulations, each a separate demo site:

| Demo | What it is | Data | Headline claim |
|---|---|---|---|
| SMARtTrader | Long-only, sentiment-aware equity trading agent on an Alpaca paper account, "8 safety gates" (9 on the newer page), four-state escalation, audit logs | Live paper trading, April to May 2026 pilot | "+2.11% weekly yield", "100% Governance Success Rate", "zero unauthorized executions", "1% atomic stop-loss". Access to the live system needs credentials. The site's own disclaimer: "Metrics shown are illustrative examples." |
| SMARtFRAUD | Takes the probability from the customer's existing fraud model and routes each transaction into four zones: auto-approve, analyst review, hold and escalate, auto-block. Zone boundaries are sliders "your risk team owns". A calibration page recomputes analyst workload, catch rate and cost live. A "Signal-Integrity Auditor" refuses models with no signal or leakage. | IEEE-CIS (590K transactions), ULB (285K), an India retail set for readability | "77.8% fewer customers auto-blocked", "+34% more fraud caught" at the same auto-block cutoff |
| SMARtBREACH | Database of 2,080 public breaches classified into the four states, with a hypothetical "if SMARt had been monitoring" cost-avoidance simulator | Public breach records | "$764.8B avoidable" in the moderate scenario, labelled "hypothetical simulation" |
| SMARtCARE | ICU deterioration detection that surfaces a patient's forgotten prior trajectory; "no autonomous treatment decisions" | MIMIC-III, MIMIC-IV, eICU | "83 min earlier detection", "187 hospitals validated", "0 identity violations" |
| SMARtPolicy (DOHA) | Analytics and predictor over 37,080 US security-clearance adjudication decisions, 1992 to 2026 | Public DOHA decisions | Mitigation rates per adjudicative guideline |
| SMARtAIDC | Simulation of a university AI data centre: routes workloads, throttles deferrable jobs during peak tariffs, structurally protects hospital and emergency compute | Synthetic (seed=42) | "cutting operating costs by up to 74%", payback "0.5 yr" in Europe |

**SMARtGov** is the umbrella "AI governance at runtime" product: a cross-walk of 13 frameworks (ISO 42001, EU AI Act, NIST AI RMF, plus consultancy and vendor frameworks and MITRE ATLAS) into "13 unified dimensions", a "7-layer AI governance stack" (policy management, semantic interpretation, conflict detection, formal verification, governance compilation, evidence and assurance, runtime governance) with an honest coverage table (two layers "Partial", a roadmap in three phases), NDJSON audit trails "from day zero", "gates are code, not checklists", "graduated autonomy, not kill-switches", and "every escalation hands the human reviewer a structured decision dossier".

**Small self-serve products with prices.** SMARtCheck (free keyword match of a policy document against 14 standards including ISO 42001, ISO 27001, EU AI Act, NIST AI RMF, GDPR, HIPAA, SOX, CMMC and Dubai's DESC ISR v3.0), SMARtMatch ($149 per month, embedding-based clause matching, 4 reports per period), SMARtCapture ($499 per report or $3,499 per year, proposal and competitor research), SMARtStart (legacy code modernization ranking, password gated), SMARtRA (research idea reviewer). Each page says "Interested in licensing this or another SMARt product... Contact dnrs.ai@outlook.com."

**Research backing.** One book (Dec 2025), one accepted journal paper (Journal of Intelligent and Robotic Systems, 2026, the SMARt model "formalized via timed guarded Petri nets"), four papers marked "Submitted 2026". Author throughout: Srini Ramaswamy.

**Regulations they name.** EU AI Act, HIPAA, SOX, NERC/CIP, DoD AI ethics; non-US: "EU AI Act is a primary reference". The free checker also lists DESC ISR v3.0 (Dubai), which matters for our market.

## 2. Side by side

| Dimension | DNRS.ai (public) | AEGIS (today) |
|---|---|---|
| What it is | A framework plus consulting, with demo sites; "not plug-and-play" | A deployable product: console, API, worker, database; installs from a guide or Compose in under an hour |
| Enforcement point | A middleware layer that "validates every AI decision before execution" (Path 2) or embedding inside the model (Path 3) | The Action Gateway: the agent cannot reach the downstream system; AEGIS holds the credentials, evaluates policy, issues one grant per request, executes through a connector, reconciles the receipt |
| Autonomy model | Four named states per system (S, M, A, Rt) with transitions; "graduated autonomy" | Per request: allow, require approval, deny, with a deterministic trace; per agent: active, suspended, revoked; organization-wide pause. Continuous governance (new) adds automatic containment responses per monitoring rule |
| Human in the loop | Escalation to a human with a "decision dossier"; no public approval workflow shown | Full Approval Center: eligibility, separation of duties, hash-bound approval, expiry, escalation, reassignment, approve-and-execute, business-readable summary with technical details collapsed |
| Evidence | "NDJSON audit trail" of every decision; "every state transition logged" | Append-only ledger with a hash chain, Ed25519 signed checkpoints, verification and export; audit events on sensitive views |
| Execution safety | Not described publicly beyond "zero unauthorized executions" | Single live grant per request, idempotency keys end to end, three-phase execution, ambiguous-outcome reconciliation, human settlement, emergency pause that voids outstanding grants |
| Data protection | SMARtCARE "privacy-preserving by architecture" (no PHI transmitted) | Shield: sensitive data detection on parameters, destination allowlists, injection heuristics, security events and incidents |
| Monitoring | State distribution metrics, escalation accuracy, "continuous governance cycle" | 12 deterministic rules with reproducible counts, alerts, and now automatic responses |
| Frameworks | 13 cross-walked; free document checker against 14 standards | Document assessment against ISO 42001, ISO 27001 and NIST AI RMF catalogs; remediation tracking |
| Multi-tenancy | Not described | Row-level security per organization, tested |
| Proof style | Dashboards over public datasets, simulations, one authenticated live paper-trading account; headline percentages with a small-print "illustrative" disclaimer | Test counts and recorded runs (170 core, 65 browser), a sample workflow anyone can run, a sandbox-tested Stripe connector; no customer, certification or performance claims |
| Pricing | Consulting and retainers; framework licence "under separate terms"; small tools at $149 to $3,499 | Per-deployment licence by registered agents, private deployment on every tier, continuous governance as an option; no public price list |
| Market | Critical infrastructure, healthcare, defense, finance, data centres | Refund workflow for AI customer-support agents first; banking and treasury scenarios in the demo; UAE and Gulf focus |

## 3. Ideas worth taking (on our own terms)

Ordered by value for the pilot and for sales conversations.

1. **Score-band routing as a policy template.** Their strongest demo is routing a model score into bands (auto-approve, review, hold, block) with boundaries the business owns. AEGIS already routes by amount and rules; add a template where the input is a confidence or risk score from the customer's own model and the bands map to allow, require approval, require approval with a hold flag, deny. Same engine, new template. Fits refunds (fraud score on the order), payments and onboarding.
2. **Calibration before activation ("what would this policy have done").** Their configure page recomputes workload and cost as sliders move. We have the sample-request tester; extend it to replay the organization's last N days of requests against a draft policy version and show counts per outcome, approvals created, estimated approver workload. This is the single most persuasive screen for a buyer and we have the data to do it.
3. **Autonomy posture per agent.** A named, visible level per agent derived from facts we already hold: full (policy allows the tool without approval), supervised (approval bands apply), restricted (only low-risk tools), suspended. Shown on the Agents page and in the Overview. It gives customers the "graduated autonomy" vocabulary without changing the engine.
4. **Decision dossier.** Our approval detail already shows what is asked, why a person is needed and the rule. Add "which boundary was close" (how far the amount was from the auto-approve limit, which duplicates or denials preceded it) in one sentence. Cheap, high impact for approvers.
5. **Framework breadth for this market.** Add EU AI Act and Dubai DESC ISR v3.0 catalogs to the Audit module, and GDPR and PDPL (UAE Federal Decree-Law 45/2021) mappings. DESC is the one a Dubai buyer will ask about first.
6. **A free public checker as lead generation.** Their free SMARtCheck exists to collect contacts. We already have the document assessment engine; a free, rate-limited "check your AI policy against ISO 42001" page on the site is a small build and gives sales a reason to call.
7. **Proof page.** Move the implementation report's verified numbers (test counts, what ran, what is simulated) onto a public "Proof" page. Their proof pages are persuasive because they show method and limits; ours can be more honest and still look as strong.
8. **AEGIS Trading.** Their live paper-trading agent is their best marketing asset. For us the product is not a trading strategy; it is governance of someone else's trading agent: a trading policy template (instrument allowlist, order size and notional limits, daily loss cap, market hours, duplicate order block, long-only option), a paper-trading connector on Alpaca's paper API that refuses live keys, and a demo scenario. The engine, approvals and evidence are reused unchanged. We define our own rules; we do not reproduce their gate pipeline.

## 4. What not to take

- Headline percentages without a basis we can show ("100% governance compliance", "zero violations", yield figures). The brief forbids unsupported claims, and their own pages add "illustrative examples" in small print. Our site states test counts and recorded runs instead.
- Consulting-first packaging. Their FAQ says the framework is "not plug-and-play"; our advantage is that AEGIS installs and runs the sample workflow without them in the room.
- Any mechanism specific to SMARt (state machine formalism, gate sequences, routing internals). We compare ideas; we implement our own.

## 5. Where each is stronger today

AEGIS is ahead on: a real installable product; the approval workflow; execution safety (grants, idempotency, reconciliation); signed, verifiable evidence; multi-tenant isolation; data protection on parameters and destinations; continuous governance with reversible automatic responses; honest public claims.

DNRS.ai is ahead on: research publications behind the narrative; breadth of domain demos with public datasets; a live paper-trading pilot with a story; framework cross-walk breadth (13); small priced self-serve tools; a clear sales narrative ("governance generates returns") and a vocabulary for graduated autonomy.

## 6. Suggested order of work

1. Score-band policy template and the replay calibration screen (items 1 and 2). Done 2026-10-13.
2. Autonomy posture and the decision dossier line (items 3 and 4). Done 2026-10-13: posture column and row, boundary sentence on every approval.
3. AEGIS Trading with the Alpaca paper connector (item 8). Built 2026-10-13 against a fake Alpaca server; the real paper-account run waits for the owner's paper key.
4. DESC ISR v3.0 and EU AI Act catalogs, then the free public checker and the Proof page (items 5, 6, 7).
