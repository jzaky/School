import type { Metadata } from "next";
import Link from "next/link";
import { EvidenceChainDiagram, LifecycleDiagram, SystemShapeDiagram } from "@/components/marketing/diagrams";
import { ClosingCta, Note, PageIntro, Prose, Section, SectionHeading, Table } from "@/components/marketing/primitives";

export const metadata: Metadata = { title: "Architecture", description: "How AEGIS is built: a modular monolith with web, API gateway and worker processes over PostgreSQL with row-level security and Redis; the request lifecycle; fail-closed behaviour; the evidence chain." };

const FAIL_CLOSED: string[][] = [
  ["Policy evaluation throws", "Deny. Evidence event policy.evaluation_failed and a security event are recorded."],
  ["Database unavailable", "Gateway returns 503. Nothing executes."],
  ["Evidence append fails", "The transaction that contains the decision rolls back. Nothing executes."],
  ["Approval expired", "Status expired. Execution refused, including a late approve."],
  ["Parameters changed after approval", "Request hash mismatch. A new evaluation is required."],
  ["Agent suspended or revoked", "Rejected at authentication, before any evaluation."],
  ["Downstream system call fails", "Receipt failed. No retry without a new idempotent request."],
  ["Duplicate idempotency key", "The original result is returned. The downstream system is never called twice."],
  ["Gateway paused by an administrator", "Every request is denied with the pause reason until resumed."],
];

const MODULE_ROWS: string[][] = [
  ["Control", "agents, policy, authz, gateway, approvals, integrations", "AI Agents, Policies, Action Gateway, Approvals, Integrations"],
  ["Assurance", "evidence, monitoring, policy history, compliance mapping", "Evidence Ledger, Risk Monitoring, Governance Reports, Policy History"],
  ["Shield", "shield (detectors, tool security, injection), incidents, integration security", "Security Events, Data Protection, Tool Security, Incidents"],
  ["Audit", "documents, frameworks, assessments, remediation, reports", "Assessments, Standards, Documents, Remediation, Reports"],
];

export default function ArchitecturePage() {
  return (
    <>
      <PageIntro eyebrow="Architecture" title="A modular monolith with one enforcement path" lead="This page explains how AEGIS is put together, and why every agent action has to pass the same checks. Every action goes through the Action Gateway, the one door every agent action goes through, and every decision is kept in a record that cannot be edited without it showing. If you are not an engineer, the first sentence of each section is enough; the rest is for your technical team." />
      <Section>
        <SectionHeading title="System shape" lead="AEGIS runs as one application in three parts, which keeps the path a decision takes short and hard to bypass. One database, one schema, three deployables: module boundaries are enforced by package structure, not by network, so the decision path has no internal hop that could fail open. Browsers reach the console. Agents, SDKs and downstream systems reach only the API, which is the Action Gateway process. All three processes import the same domain package and share PostgreSQL and Redis." />
        <div className="mt-8">
          <SystemShapeDiagram />
        </div>
        <Prose className="mt-8">
          <p>
            <strong className="text-(--mk-fg)">packages/core</strong> holds every domain module. Each service takes an OrgContext (tenant id, actor, request id) and a tenant-scoped database handle. <strong className="text-(--mk-fg)">packages/db</strong> holds the Prisma schema, migrations, the row-level security policies (the database rules that keep each customer's data apart) and the tenantDb helper that sets the organization for every query. <strong className="text-(--mk-fg)">apps/api</strong> exposes the REST surface and is the gateway; it is stateless and scales horizontally. <strong className="text-(--mk-fg)">apps/web</strong> renders the console and this site; server components import core directly, avoiding a second auth layer. <strong className="text-(--mk-fg)">apps/worker</strong> runs the job loop for approval expiry, monitoring, notifications and evidence checkpoints (signed markers that show whether the record has been edited since); every side effect carries an idempotency key, so the same request is never carried out twice.
          </p>
          <p>Durable jobs use a PostgreSQL table processed with SELECT ... FOR UPDATE SKIP LOCKED, so a state transition and its job are committed together. Extraction of a module into its own service remains possible later because modules only talk through service interfaces and the job table.</p>
        </Prose>
      </Section>
      <Section className="bg-(--mk-bg-2)" id="lifecycle">
        <SectionHeading title="Request lifecycle" lead="When an agent asks to do something, the answer is decided and written down before anything happens. What happens between an agent asking and a downstream system acting. The decision is durable before anything executes." />
        <div className="mt-8">
          <LifecycleDiagram />
        </div>
        <ol className="mt-8 grid gap-3 text-sm md:grid-cols-2">
          {[
            "Agent authenticates with an API key (hashed at rest, scoped to one agent, revocable). Revoked or suspended agents are rejected before any policy work.",
            "The body is validated against the registered tool parameter schema. Invalid input is denied and recorded.",
            "An action_requests row (status evaluating) is written inside a transaction with the idempotency key. A duplicate key returns the original result.",
            "The policy input is built (agent, principal, resource, action, parameters, classification, amount, context, Shield results) and the active policy versions assigned to the agent are evaluated. Evaluation failure is a deny.",
            "Shield runs classification and tool-security checks. A block is a deny with a security event.",
            "The result is allow, deny or require_approval. An authorization_decisions row stores the full explanation and the policy version ids.",
            "Allow: a short-lived grant (a one-time permission slip the downstream system checks before acting) bound to the request hash is issued; the downstream system verifies it; an execution_receipts row records the outcome.",
            "Require approval: an approval_requests row with an expiry is created. Nothing executes. On approval the gateway re-validates the hash and the agent status, then executes.",
            "Every step appends an evidence_events row to the hash chain (a record that cannot be edited without it showing) in the same transaction.",
          ].map((t, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-(--mk-line) bg-(--mk-bg) p-3">
              <span className="shrink-0 font-mono text-xs text-(--mk-accent)">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-(--mk-muted)">{t}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="fail-closed">
        <SectionHeading title="Fail-closed behaviour" lead="If anything goes wrong inside AEGIS, the safe outcome is that nothing happens in your systems. The gateway is built so that any failure leaves the downstream system untouched. These behaviours are covered by the core test suite." />
        <div className="mt-8">
          <Table head={["Failure", "Behaviour"]} rows={FAIL_CLOSED} caption="Fail-closed behaviours of the Action Gateway" />
        </div>
      </Section>
      <Section className="bg-(--mk-bg-2)" id="evidence">
        <SectionHeading title="Evidence integrity" lead="Every decision is kept in a record that cannot be edited without it showing, and a copy of the proof can be kept outside AEGIS. Hash linking inside the database, signed checkpoints outside it." />
        <div className="mt-8">
          <EvidenceChainDiagram />
        </div>
        <Prose className="mt-8">
          <p>evidence_events rows carry seq (per organization), prev_hash and hash = sha256(canonical(event) || prev_hash). Triggers reject UPDATE and DELETE for the application role. The worker writes a signed checkpoint (Ed25519 over the latest hash) every N events or minutes, and verification recomputes the chain from the first event. Checkpoints and the public key can be exported to customer storage, so a rewrite inside the database is detectable from outside it.</p>
        </Prose>
        <Note className="mt-6">Tamper-evident, not immutable. An attacker holding the database owner role and the signing key could rewrite history and re-sign. The signing key lives outside the database for that reason, and the UI never says immutable.</Note>
      </Section>
      <Section id="isolation">
        <SectionHeading title="Tenant isolation" lead="Each customer's data is kept apart inside the database, and the application itself cannot cross that line. Every tenant table has org_id. Row-level security is enabled and forced; the application role aegis_app is not the table owner and cannot bypass it." />
        <Prose className="mt-6">
          <p>tenantDb(orgId) runs each query inside a transaction that sets app.current_org. Three SECURITY DEFINER functions provide the only cross-tenant lookups (API key by hash, memberships by user, invitation by hash). Platform administration uses a separate owner connection confined to one module. The isolation test suite inserts rows for two organizations and proves that reads, writes and raw SQL through the application role see only one.</p>
        </Prose>
        <div className="mt-8">
          <Table head={["Product", "Core modules", "Console sections"]} rows={MODULE_ROWS} caption="Where the four products live" />
        </div>
        <p className="mk-hint mt-4">
          All four share identity, organizations, roles, policy versions, the evidence ledger and notifications. Deployment details are on the{" "}
          <Link href="/site/security#deployment" className="underline underline-offset-2">
            Security page
          </Link>
          .
        </p>
      </Section>
      <ClosingCta />
    </>
  );
}
