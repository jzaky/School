import type { Metadata } from "next";
import { ApprovalMock, AssessmentMock, EvidenceMock, GatewayMock, MonitoringMock, ShieldMock, ToolSecurityMock } from "@/components/marketing/product-mocks";
import { ClosingCta, Note, PageIntro, Section } from "@/components/marketing/primitives";
import { Check } from "lucide-react";

export const metadata: Metadata = { title: "Products", description: "The four AEGIS modules: Control (decides what an agent may do, at the Action Gateway), Assurance (a record of every decision that cannot be quietly edited, plus monitoring), Shield (protects sensitive data and checks where tools send it) and Audit (checks your written policies against governance frameworks)." };

type Module = { id: string; name: string; tagline: string; what: string; capabilities: string[]; mocks: React.ReactNode[]; not?: string[] };

const MODULES: Module[] = [
  {
    id: "control",
    name: "Control",
    tagline: "Who may do what, decided at the Action Gateway",
    what: "Control decides whether an agent may act before it acts. Every protected action passes through the Action Gateway, the one door every agent action goes through. It asks one question: is this agent, acting for this person, allowed to do this, to this record, with these details, right now? Control also keeps the list of agents, the rule books (policies) with their versions, and the approval queue for anything that sits between a clear yes and a clear no.",
    capabilities: [
      "A register of every agent with its stage of life (draft, active, suspended, retired, revoked), its versions, a business owner and a technical owner, a risk tier and a limit on the kind of data it may touch",
      "Each tool an agent may use is described with its allowed inputs, its risk level, the system it connects to and where it may send data (JSON Schema parameter validation and destination rules). Permissions on individual resources list the allowed actions and when they expire",
      "API keys are shown once, stored only as a fingerprint (hashed at rest), tied to one agent and cancelled automatically when that agent is revoked",
      "Rules are written as policy documents in a small, fixed language (policy language v1, JSON): 22 ways to compare values, all/any/not combinations, and built-in tests that must pass before a policy can go to review",
      "Policies move through draft, review, active and retired. A second person must switch a policy on; the author cannot (four-eyes activation). Rolling back means copying an earlier version. A policy applies to the whole organization, a team or one agent",
      "The same request always gets the same answer (deterministic evaluation). Every rule is traced, a deny beats an approval, an approval beats an allow, and anything unmatched is refused by default. A faulty comparison never crashes the check",
      "The Action Gateway never carries out the same request twice (idempotency keys), checks that the agent and tool are registered, calls Shield, writes a full explanation for every decision, and refuses when anything goes wrong (fail closed)",
      "An approved action gets a one-time permission slip that the payment system or other system checks before acting (execution grant). It works once, expires after five minutes and is tied to the exact tool, action and details by a SHA-256 fingerprint. Downstream systems verify it through the API or SDK",
      "An Approval Center where only eligible people, by permission and role, can decide. The people who own the agent cannot approve its requests (separation of duties). Approvers can approve, reject, ask for information, escalate or reassign. Requests nobody answers expire on time through a background job",
      "Emergency stops: suspend or revoke an agent, revoke a tool, disable an integration, revoke a credential, or pause the gateway for the whole organization",
      "For engineers, a REST API (v1) and a TypeScript SDK with calls to authorize, waitForApproval, getGrant, reportExecution and verifyGrantDownstream",
    ],
    mocks: [<GatewayMock key="g" />, <ApprovalMock key="a" />],
    not: ["AEGIS does not run your agents and does not sit between them and their AI model. It governs the actions they take through the gateway. If an agent can reach a downstream system without going through the gateway, your own network rules have to close that path.", "In the demo tenant, the downstream systems are simulators that check the permission slip (grant). A real system needs that verification call added to its integration."],
  },
  {
    id: "assurance",
    name: "Assurance",
    tagline: "The permanent record, monitoring and governance reports",
    what: "Assurance keeps the record. Every decision, approval, permission slip, receipt, policy change and security event is written to a record that cannot be edited without it showing (a per-organization hash chain, verified on demand and exported with its checkpoint signature). Monitoring rules read the same record and raise alerts the same way every time.",
    capabilities: [
      "Each organization has its own evidence chain. Every entry carries a sequence number and a fingerprint of itself and the entry before it (seq, prev_hash, hash = sha256(canonical(event) || prev_hash)). The database itself rejects any attempt to change or delete an entry",
      "The background worker regularly signs a checkpoint of the chain (Ed25519), every N events or minutes. The signing key is kept outside the database, and the public key goes out with every export so anyone can check it",
      "Any single entry, or the whole chain, can be verified on demand. Running a verification and recording the result is itself an entry in the record",
      "Export the record as JSON Lines or CSV, stamped with the verification result and the checkpoint public key. A governance report is available as JSON",
      "12 built-in monitoring rules with limits you set: repeated refusals, an agent gaining permissions, unusual tool use, transaction volume, failing integrations, policy checks that error, missing evidence or receipts, abnormal activity, approvals about to expire, damage to the chain, credentials due for rotation, and actions whose outcome was never confirmed",
      "Alerts are not repeated for the same cause. Each can be acknowledged and resolved, every resolution is written to the record as evidence, and the worker checks the rules every minute",
      "A governance dashboard computed from real records: agents, decisions, approvals, violations, high-risk events, failed integrations, evidence status, service health, daily trends and how long approvals took (percentiles)",
      "Technical controls observed from live records, with measurements and references to the frameworks they support. These feed the per-framework summary used by Audit",
      "Policy history: every version, status change and assignment, kept in the policy_events trail",
    ],
    mocks: [<EvidenceMock key="e" />, <MonitoringMock key="m" />],
    not: ["Tamper-evident, not impossible to change. An attacker who holds both the database owner role and the signing key could rewrite history and sign it again. Checkpoints stored outside AEGIS make that detectable; they do not prevent it.", "Automated evidence shows that controls operated inside AEGIS. It does not prove that your organization conforms to any standard, and it is not an audit opinion."],
  },
  {
    id: "shield",
    name: "Shield",
    tagline: "Sensitive data protection, tool security, incidents",
    what: "Shield checks what an agent is about to send, and where, before it goes. It spots sensitive data such as card numbers in the details of a request (a detector registry), limits where each tool may send data (destination rules), and flags text that looks like an attempt to trick the agent (injection heuristics). What it finds goes into the policy decision and into the security event stream.",
    capabilities: [
      "Built-in detectors for email addresses, phone numbers, IBANs (mod-97 checksum), payment card numbers (Luhn check), Emirates ID numbers, API keys and access tokens, JWTs, private keys, passwords in text, IP addresses and URLs. Your organization can add its own patterns (custom regex classes)",
      "For each kind of data, you choose what happens: allow, mask, redact, block or require approval, each with a severity you set. Policies can read what was found and how severe it is (shield.dataClasses and shield.highestSeverity)",
      "Tool security: each tool has a list of web addresses and email domains it may send to (destination allowlists, wildcards supported), limits on which records it may touch, an on/off switch and a risk level",
      "Signals that someone is trying to trick the agent (prompt injection): overriding its instructions, hijacking its role, asking it to leak data, forcing a tool call, hiding content in encoded or invisible text (zero-width and bidi characters, unicode tags, comments), or applying urgency pressure. Each signal comes with a confidence",
      "Security events with a severity, each linked to the request, the decision and the policy rule that raised it",
      "Incidents move through open, investigating, contained and resolved, with an owner, notes, linked security events, a timeline and statistics",
      "A set of injection and data-leak test cases runs against the gateway on every code change in continuous integration (security evaluation corpus)",
    ],
    mocks: [<ShieldMock key="s" />, <ToolSecurityMock key="t" />],
    not: ["Injection detection is a best effort (heuristic). It gives signals with a confidence, not a verdict, and it will miss new phrasing. Whether an action is allowed never depends on it: permissions and policy decide, while signals add context and raise events.", "Detectors look at the details of a tool call as it passes the gateway. Content the agent reads elsewhere is inspected only when the integration sends it in for inspection."],
  },
  {
    id: "audit",
    name: "Audit",
    tagline: "Checks your written policies against governance frameworks and tracks the fixes",
    what: "Audit reads your written policies and procedures and matches them against the controls in recognised frameworks (control catalogs). It attaches automated evidence of controls that already operate inside AEGIS and tracks every fix to closure. Matching is done by the words in the text, not by an AI model (lexical retrieval), so it can be explained, and every finding points to the passage it came from.",
    capabilities: [
      "Framework catalogs shipped read-only with every deployment: ISO/IEC 42001:2023, ISO/IEC 27001:2022 Annex A and NIST AI Risk Management Framework 1.0 (control identifiers reproduced, descriptions paraphrased). Your organization can add its own frameworks and controls",
      "Upload documents as PDF, DOCX, TXT or Markdown. They are read inside the application itself (the Node process) and the files stay on the storage you configured",
      "Documents are split into passages and searched by the words they contain (BM25 lexical retrieval) inside PostgreSQL. No embeddings provider and no external calls",
      "One assessment per framework: a status for every control, the passage that matched, a coverage percentage and a summary",
      "Automated evidence drawn from ten kinds of AEGIS record (approval workflow, evidence ledger, access control, incident management, policy versioning, monitoring, agent inventory, data protection, integration security, security events), each with a machine-readable reference",
      "Fix-up tasks (remediation) with owners, status changes and notes. Every status change is written to the evidence record",
      "Reports as PDF and JSON, plus a per-framework summary shared with Assurance",
    ],
    mocks: [<AssessmentMock key="as" />],
    not: ["Findings are labelled lexical similarity: the words match, which is not the same as meeting the control. A passage that matches a control is a starting point for a human reviewer, not a conclusion.", "AEGIS holds no certification of its own and does not certify anything. Frameworks are referenced so that evidence can be mapped to their control identifiers."],
  },
];

export default function ProductsPage() {
  return (
    <>
      <PageIntro eyebrow="Products" title="Four modules, one enforcement path" lead="Everything below exists in the current build. Each capability is taken from the implementation status and the code, and each module also says plainly what it does not do.">
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
              <p className="mk-hint">These are illustrations of console screens drawn from made-up demo data, not screenshots.</p>
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
