import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink, ClosingCta, Pill, Pre, Section, SectionHeading } from "./primitives";

export const homeMetadata: Metadata = {
  title: "AEGIS | AI governance, authorization, security and assurance",
  description: "Define what your AI agents may do. Enforce it before execution. Prove what happened. An enterprise platform for AI agent authorization, runtime enforcement, evidence and assessment, designed for regulated environments and private deployment.",
  alternates: { canonical: "/" },
};

const STEPS = [
  { n: "01", title: "Agent requests", body: "Before a tool runs, the agent (or the framework around it) posts the intended action to the gateway with its scoped API key, the tool, the parameters and an idempotency key.", code: "POST /v1/gateway/actions" },
  { n: "02", title: "Gateway evaluates", body: "Registry checks first: agent active, tool granted, schema valid, resource permitted, classification within limit, destination allowed. Then Shield inspects parameters. Then versioned policies are evaluated deterministically.", code: "registry -> shield -> policy" },
  { n: "03", title: "Allow, approve or deny", body: "Deny wins, then approval, then allow; anything unmatched is denied by default. Approvals go to eligible humans with an expiry and a request hash. Nothing executes until a decision exists.", code: "200 | 202 | 403" },
  { n: "04", title: "Evidence recorded", body: "The decision, the approval responses, the single-use execution grant and the downstream receipt are appended to a per-organization hash chain, in the same transaction as the decision.", code: "evidence_events seq, prev_hash, hash" },
];

const MODULES = [
  { id: "control", name: "Control", tag: "Authorization and the Action Gateway", body: "Agent registry with lifecycle, tools and resource permissions. Versioned JSON policies with embedded tests and four-eyes activation. The gateway that decides before anything executes, and the Approval Center that closes the loop.", points: ["Idempotent action requests, fail closed", "Approvals with expiry, separation of duties, hash binding", "Emergency controls: suspend, revoke, pause the gateway"] },
  { id: "assurance", name: "Assurance", tag: "Evidence ledger, monitoring, governance reporting", body: "A per-organization hash chain of every decision, approval, grant and receipt with Ed25519 checkpoints. Deterministic monitoring rules with configurable thresholds. Governance dashboards computed from real records.", points: ["Chain verification and signed exports (JSON Lines, CSV)", "11 built-in monitoring rules, deduplicated alerts", "Approval turnaround percentiles, decision series"] },
  { id: "shield", name: "Shield", tag: "Sensitive data, tool security, incidents", body: "A detector registry that classifies tool parameters (IBAN, card numbers, Emirates ID, API keys, private keys and more) and applies mask, redact, block or approval actions. Destination allowlists per tool. Heuristic prompt-injection signals that feed policy and security events.", points: ["Checksum-validated financial identifiers", "Per-tool destination rules on URLs and email domains", "Security events linked to incidents with a timeline"] },
  { id: "audit", name: "Audit", tag: "Document assessment against governance frameworks", body: "Upload policies and procedures, assess them against framework control catalogs with lexical retrieval, attach automated evidence of controls that operated inside AEGIS, track remediation and export reports.", points: ["Shared catalogs for ISO/IEC 42001, ISO/IEC 27001 Annex A, NIST AI RMF", "Custom frameworks and controls per organization", "Findings, remediation tasks, PDF and JSON reports"] },
];

const RISKS = [
  { title: "Unbounded transactions", risk: "An agent with a payments credential can move any amount, any time, as long as the model produces a plausible call. A prompt, a bug or a poisoned document is enough.", answer: "AEGIS evaluates amount, currency, resource, time of day and counterparty against versioned policy before the call. Above an autonomous limit the request waits for a named human; above an authority ceiling it is denied and a security event is raised. Illustrative example: autonomous below AED 50,000 in business hours, approval to AED 1,000,000, denied above." },
  { title: "Data egress", risk: "Tools that send email, call HTTP endpoints or export records can carry customer data to a destination nobody approved, including when the instruction came from untrusted content the agent read.", answer: "Shield classifies parameters and finds IBANs, card numbers, identity numbers and credentials with checksum validation. Each tool has a destination allowlist. A policy can deny when restricted data classes intersect with an external domain, and the attempt becomes a security event with the evidence attached." },
  { title: "Untraceable actions", risk: "After an incident, logs from the agent framework show what the model said, not what was authorized, by whom, under which policy version, and what the downstream system actually did.", answer: "Every request produces an action record, a decision with the full rule trace, any approval responses, the grant and the downstream receipt, hash-linked in one per-organization ledger. Verification recomputes the chain and checks the signed checkpoint, and exports carry the public key." },
];

const SECURITY = [
  { title: "Fail closed", body: "Evaluation errors deny. Database unavailable returns 503 and nothing executes. If the evidence append fails, the transaction holding the decision rolls back." },
  { title: "Tenant isolation in the database", body: "PostgreSQL row-level security is forced on every tenant table. The application role is a non-owner that cannot bypass RLS; each query runs with a transaction-local organization setting. An isolation test suite proves two organizations cannot see each other." },
  { title: "Tamper-evident evidence", body: "Per-organization SHA-256 hash chain over canonical JSON. UPDATE and DELETE are rejected by trigger. Ed25519 checkpoints are signed with a key held outside the database and can be exported to customer storage." },
  { title: "Private deployment", body: "Docker Compose or Kubernetes manifests, non-root containers, network policy for egress. No component calls an external AI provider. Uploaded documents stay on the configured volume." },
  { title: "OpenID Connect SSO and MFA", body: "Per-organization OIDC with PKCE and just-in-time provisioning limited to allowed email domains, TOTP MFA, argon2id passwords, server-side sessions with idle and absolute limits, lockout after repeated failures." },
];

const INDUSTRIES = [
  { name: "Banking and payments", scenario: "A treasury agent prepares intra-bank transfers from analyst tickets. AEGIS allows small business-hours transfers, routes an AED 250,000 settlement to an approver who sees the beneficiary and ticket reference, and denies a transfer above the ceiling before the core ledger is touched." },
  { name: "Insurance", scenario: "A claims agent settles low-value motor claims autonomously within a per-policy limit, requires an adjuster for amounts above it, and is blocked from exporting claimant records to a vendor domain that is not on the allowlist." },
  { name: "Healthcare", scenario: "A scheduling agent can read appointment slots but any tool that writes to the patient record requires a clinician approval, and parameters containing identity numbers are blocked from leaving through email or HTTP tools." },
  { name: "Government", scenario: "A citizen-services agent updates case status on an approved system of record only; destination rules and classification limits stop it from sending case files to external addresses, and every decision is exportable as signed evidence for oversight." },
  { name: "Customer operations", scenario: "A support agent refunds below AED 500 on its own, needs a supervisor between AED 500 and 2,500 and is denied above. A retried request with the same idempotency key returns the original result, so the customer is never refunded twice." },
];

const HERO_RESPONSE = `HTTP/1.1 202 Accepted
{
  "requestId": "0192f0c4-...-7f3a21c0",
  "status": "pending_approval",
  "decision": "require_approval",
  "reasons": ["Manager approval required for transfers between AED 50,000 and 1,000,000"],
  "riskIndicators": ["high_value"],
  "matchedRuleIds": ["manager-50k-1m"],
  "approval": {
    "approvalRequestId": "0192f0c4-...-9b1d",
    "expiresAt": "2026-10-11T13:04:00.000Z",
    "requiredApprovals": 1,
    "requiredRoles": ["approver", "owner"]
  }
}`;

export function HomePage() {
  return (
    <>
      <Section dark className="!pt-16 !pb-16 md:!pt-24 md:!pb-24">
        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mk-eyebrow mb-4">Enterprise AI governance, authorization, security and assurance</p>
            <h1 className="mk-h1">Define what your AI agents may do. Enforce it before execution. Prove what happened.</h1>
            <p className="mk-lead mt-5 max-w-xl">AEGIS sits between your agents and the systems they act on. Register each agent, write the policy that bounds it, route elevated actions to named humans, and keep a tamper-evident record of every decision and every downstream receipt.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/site/demo">Request a demo</ButtonLink>
              <ButtonLink href="/site/tour" variant="secondary">
                Explore the product tour
                <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
              {[
                ["Decision path", "Deterministic, default deny"],
                ["Isolation", "PostgreSQL row-level security"],
                ["Evidence", "Hash chain, signed checkpoints"],
                ["Deployment", "Private, no AI provider calls"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wider text-(--mk-dim)">{k}</dt>
                  <dd className="mt-1 font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-(--mk-dim)">gateway response, synthetic demo tenant</span>
              <Pill tone="approval">Approval required</Pill>
            </div>
            <Pre>{HERO_RESPONSE}</Pre>
            <p className="mk-hint mt-2">An AED 250,000 transfer from the synthetic banking scenario. Thresholds are illustrative and customer-configurable.</p>
          </div>
        </div>
      </Section>

      <Section id="how-it-works">
        <SectionHeading eyebrow="Runtime enforcement" title="How runtime enforcement works" lead="Four steps, one transaction boundary around the decision. Agents never hold the downstream credential; they hold a scoped key to the gateway." />
        <ol className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="mk-card flex flex-col">
              <span className="font-mono text-xs text-(--mk-accent)">{s.n}</span>
              <h3 className="mk-h3 mt-2">{s.title}</h3>
              <p className="mt-2 flex-1 text-sm text-(--mk-muted)">{s.body}</p>
              <code className="mk-code mt-4 self-start whitespace-normal break-words text-[11px]">{s.code}</code>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="products" className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Four products, one platform" title="Control, Assurance, Shield and Audit share one identity model, one policy engine and one evidence ledger" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {MODULES.map((m) => (
            <Link key={m.id} href={`/site/products#${m.id}`} className="mk-card group flex flex-col" data-module={m.id}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="mk-h3">{m.name}</h3>
                <ArrowRight className="h-4 w-4 text-(--mk-dim) transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
              </div>
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-(--mk-accent)">{m.tag}</p>
              <p className="mt-3 text-sm text-(--mk-muted)">{m.body}</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {m.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--mk-allow)" aria-hidden />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </Section>

      <Section id="why">
        <SectionHeading eyebrow="Why AI authorization matters" title="Agents act. Models cannot be trusted to bound their own actions." lead="Authorization has to live outside the model, in a component that sees the registered permissions, the policy and the parameters, and that fails closed." />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {RISKS.map((r) => (
            <article key={r.title} className="mk-card">
              <h3 className="mk-h3">{r.title}</h3>
              <p className="mt-3 text-sm text-(--mk-muted)">
                <span className="font-semibold text-(--mk-deny)">Risk. </span>
                {r.risk}
              </p>
              <p className="mt-3 text-sm text-(--mk-muted)">
                <span className="font-semibold text-(--mk-allow)">With AEGIS. </span>
                {r.answer}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="security" dark>
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <SectionHeading eyebrow="Enterprise security" title="Designed for regulated environments" lead="Security properties are implemented in the database and the request path, not in documentation. The Security page lists what is built and what is still a gap." />
            <ButtonLink href="/site/security" variant="secondary" className="mt-6">
              Security details and known gaps
            </ButtonLink>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            {SECURITY.map((s) => (
              <div key={s.title} className="rounded-xl border border-(--mk-line) bg-(--mk-bg-2) p-5 sm:[&:last-child]:col-span-2">
                <dt className="font-semibold">{s.title}</dt>
                <dd className="mt-2 text-sm text-(--mk-muted)">{s.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section id="industries">
        <SectionHeading eyebrow="Where it applies" title="Industry scenarios" lead="Each scenario is a pattern the policy language and the gateway support today. The figures are illustrative and customer-configurable; the demo tenant is synthetic." />
        <div className="mt-10 divide-y divide-(--mk-line) border-y border-(--mk-line)">
          {INDUSTRIES.map((i) => (
            <div key={i.name} className="grid gap-2 py-5 md:grid-cols-[220px_1fr] md:gap-8">
              <h3 className="font-semibold">{i.name}</h3>
              <p className="text-sm text-(--mk-muted)">{i.scenario}</p>
            </div>
          ))}
        </div>
      </Section>

      <ClosingCta />
    </>
  );
}
