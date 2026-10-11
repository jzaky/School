import type { Metadata } from "next";
import { ApprovalMock, AssessmentMock, EvidenceMock, GatewayMock, MonitoringMock, ShieldMock, ToolSecurityMock } from "@/components/marketing/product-mocks";
import { ClosingCta, Note, PageIntro, Section } from "@/components/marketing/primitives";
import { Check } from "lucide-react";

export const metadata: Metadata = { title: "Products", description: "The four AEGIS modules: Control (authorization and the Action Gateway), Assurance (evidence ledger and monitoring), Shield (sensitive data and tool security) and Audit (framework assessment)." };

type Module = { id: string; name: string; tagline: string; what: string; capabilities: string[]; mocks: React.ReactNode[]; not?: string[] };

const MODULES: Module[] = [
  {
    id: "control",
    name: "Control",
    tagline: "Authorization and the Action Gateway",
    what: "Control answers one question before any protected action runs: is this agent, with this principal, allowed to do this, to this resource, with these parameters, now? It holds the agent registry, the policy versions and the gateway that evaluates them, plus the approval workflow for everything in between allow and deny.",
    capabilities: [
      "Agent registry with lifecycle (draft, active, suspended, retired, revoked), versions, business and technical owners, risk tier and data classification limit",
      "Tools with JSON Schema parameter validation, risk level, integration binding and destination rules; resource permissions with permitted actions and expiry",
      "API keys hashed at rest, shown once, scoped to one agent, revoked automatically when the agent is revoked",
      "Policy language v1: JSON documents, 22 comparison operators, all/any/not composition, embedded tests that must pass before review",
      "Policy lifecycle draft, review, active, retired; four-eyes activation (the author cannot activate); rollback by copy; assignment to organization, team or agent",
      "Deterministic evaluation: every rule traced, deny wins, then approval, then allow, else default deny; comparisons never throw",
      "Gateway with idempotency keys, structural registry checks, Shield hook, decision rows with full explanation, fail closed on any error",
      "Execution grants: single use, five minutes, bound to the SHA-256 of tool, action and parameters; downstream systems verify them through the API or SDK",
      "Approval Center: eligibility by permission and role, separation of duties, approve, reject, request information, escalate, reassign, expiry by worker job",
      "Emergency controls: suspend or revoke an agent, revoke a tool, disable an integration, revoke a credential, pause the gateway for the whole organization",
      "REST API v1 and a TypeScript SDK (authorize, waitForApproval, getGrant, reportExecution, verifyGrantDownstream)",
    ],
    mocks: [<GatewayMock key="g" />, <ApprovalMock key="a" />],
    not: ["AEGIS does not run your agents or route model traffic. It governs the tool calls they make through the gateway. If an agent can reach a downstream system without the gateway, network egress on your platform has to close that path.", "Downstream systems in the demo tenant are simulators that verify grants. Real systems need the verification call added to their integration."],
  },
  {
    id: "assurance",
    name: "Assurance",
    tagline: "Evidence ledger, monitoring, governance reporting",
    what: "Assurance keeps the record. Every decision, approval response, grant, receipt, policy transition and security event is appended to a per-organization hash chain, verified on demand and exported with its checkpoint signature. Monitoring rules read the same records and raise alerts deterministically.",
    capabilities: [
      "Per-organization evidence chain: seq, prev_hash, hash = sha256(canonical(event) || prev_hash); UPDATE and DELETE rejected by database trigger",
      "Ed25519 checkpoints written by the worker every N events or minutes; the signing key lives outside the database; public key exported with every export",
      "Verification per event and for the whole chain, with a verify-and-record action that itself becomes evidence",
      "Export as JSON Lines or CSV with the chain verification stamp and checkpoint public key; governance report JSON",
      "12 built-in monitoring rules with configurable thresholds: repeated denials, permission escalation, unusual tool usage, transaction volume, integration failures, policy evaluation failures, missing evidence or receipts, abnormal activity, approvals about to expire, chain integrity, credential rotation due, unresolved execution outcomes",
      "Deduplicated alerts with acknowledge and resolve, each resolution recorded as evidence; evaluated by the worker every minute",
      "Governance dashboard computed from real records: agents, decisions, approvals, violations, high-risk events, failed integrations, evidence status, service health, day series, approval turnaround percentiles",
      "Observed technical controls with measurements and framework references, feeding the per-framework mapping summary used by Audit",
      "Policy history: every version, transition and assignment, with the policy_events trail",
    ],
    mocks: [<EvidenceMock key="e" />, <MonitoringMock key="m" />],
    not: ["Tamper-evident, not immutable. An attacker holding the database owner role and the signing key could rewrite history and re-sign. Externally stored checkpoints make that detectable; they do not prevent it.", "Automated evidence shows that controls operated inside AEGIS. It does not prove organizational conformance with any standard and is not an audit opinion."],
  },
  {
    id: "shield",
    name: "Shield",
    tagline: "Sensitive data protection, tool security, incidents",
    what: "Shield inspects what agents are about to send and where. A detector registry classifies tool parameters, destination rules constrain each tool, injection heuristics flag suspicious instructions, and the results feed both the policy input and the security event stream.",
    capabilities: [
      "System data classes: email, phone, IBAN (mod-97 checksum), payment card number (Luhn), Emirates ID, API key or access token, JWT, private key, password in text, IP address, URL; custom regex classes per organization",
      "Per-class actions: allow, mask, redact, block, require approval, with configurable severity; detected classes and highest severity are available to policies as shield.dataClasses and shield.highestSeverity",
      "Tool security: per-tool destination allowlists on URLs and email domains (wildcards supported), resource key restrictions, enable and disable, risk levels",
      "Prompt-injection signals: instruction override, role hijack, exfiltration request, tool coercion, encoded payload, hidden text (zero-width and bidi characters, unicode tags, comments), urgency pressure; each with a confidence",
      "Security events with severity, linked to the action request, decision and policy rule that produced them",
      "Incidents: open, investigating, contained, resolved; assignment, notes, linked security events, timeline, statistics",
      "Security evaluation corpus of injection and exfiltration cases that runs in CI against the gateway",
    ],
    mocks: [<ShieldMock key="s" />, <ToolSecurityMock key="t" />],
    not: ["Injection detection is heuristic. It produces signals with confidences, not a verdict, and it will miss novel phrasing. Authorization never depends on it: permissions and policy decide; signals add context and raise events.", "Detectors run on tool parameters at the gateway. Content the agent reads elsewhere is inspected only when the integration submits it for inspection."],
  },
  {
    id: "audit",
    name: "Audit",
    tagline: "Document assessment against governance frameworks and remediation",
    what: "Audit assesses your written policies and procedures against control catalogs, attaches automated evidence of controls that operate inside AEGIS, and tracks remediation to closure. Retrieval is lexical and explainable; every finding points to the passage it came from.",
    capabilities: [
      "Shared read-only catalogs seeded in the deployment: ISO/IEC 42001:2023, ISO/IEC 27001:2022 Annex A, NIST AI Risk Management Framework 1.0 (identifiers reproduced, descriptions paraphrased); custom frameworks and controls per organization",
      "Document upload (PDF, DOCX, TXT, Markdown) parsed inside the Node process; files stay on the configured volume",
      "Chunking and BM25 lexical retrieval over document text stored in PostgreSQL; no embeddings provider and no external calls",
      "Assessments per framework with finding status per control, the matched passage, coverage percentage and a summary",
      "Automated evidence from ten AEGIS record types (approval workflow, evidence ledger, access control, incident management, policy versioning, monitoring, agent inventory, data protection, integration security, security events) with machine-readable references",
      "Remediation tasks with owners, status transitions and notes; every transition is evidence",
      "Reports as PDF and JSON; per-framework mapping summary shared with Assurance",
    ],
    mocks: [<AssessmentMock key="as" />],
    not: ["Findings are labelled lexical similarity, not conformance. A passage that matches a control is a starting point for a human reviewer, not a conclusion.", "AEGIS has no certification of its own and does not certify anything. Frameworks are referenced so evidence can be mapped to control identifiers."],
  },
];

export default function ProductsPage() {
  return (
    <>
      <PageIntro eyebrow="Products" title="Four modules, one enforcement path" lead="Everything below exists in the current build. Capabilities are taken from the implementation status and the code, and each module lists what it does not do.">
        <nav aria-label="Modules" className="mt-8 flex flex-wrap gap-2">
          {MODULES.map((m) => (
            <a key={m.id} href={`#${m.id}`} className="mk-btn mk-btn-secondary mk-btn-sm">
              {m.name}
            </a>
          ))}
        </nav>
      </PageIntro>
      {MODULES.map((m, i) => (
        <Section key={m.id} id={m.id} className={i % 2 === 1 ? "bg-(--mk-bg-2)" : undefined}>
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <p className="mk-eyebrow mb-3">{m.tagline}</p>
              <h2 className="mk-h2">{m.name}</h2>
              <p className="mk-lead mt-4">{m.what}</p>
              <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-(--mk-dim)">In this build</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {m.capabilities.map((c) => (
                  <li key={c} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--mk-allow)" aria-hidden />
                    <span className="text-(--mk-muted)">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-4 lg:pt-16">
              {m.mocks}
              <p className="mk-hint">Illustrations of console screens built from synthetic demo data. Not screenshots.</p>
              {m.not ? (
                <Note title="What it is not">
                  <ul className="list-disc space-y-1.5 ps-4">
                    {m.not.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </Note>
              ) : null}
            </div>
          </div>
        </Section>
      ))}
      <ClosingCta />
    </>
  );
}
