import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink, Note, Pill, Pre, Section, SectionHeading, Table } from "./primitives";
import { Screenshot } from "./screenshot";

export const homeMetadata: Metadata = {
  title: "AEGIS by Nexus AI Assurance | Let AI agents handle routine work. Require human approval for risky actions.",
  description: "AEGIS governs the actions AI agents take. Routine refunds run on their own, risky ones wait for a named approver, and every decision is recorded in a verifiable ledger. Built for customer-support refund workflows first.",
  alternates: { canonical: "/" },
};

const PROMISE = ["Let AI agents handle routine work.", "Require human approval for risky actions.", "Keep a verifiable record of every decision."];

const FOR = [
  { who: "Heads of customer support and operations", why: "You want the support agent to issue small refunds without a queue, and you want to be the one who decides where \"small\" ends." },
  { who: "Finance and risk", why: "You need a hard limit the model cannot talk its way past, a named approver above it, and proof afterwards of who allowed what." },
  { who: "Engineering and platform teams", why: "You need one gateway in front of the refund API, a single-use grant per execution, and idempotency that survives lost responses, without rewriting the agent." },
];

const FLOW = [
  { n: "01", title: "The agent asks first", body: "Before it touches the payment system, the support agent posts the intended refund (order, customer, amount, reason) to the gateway with its own scoped key. It never holds the payment credential." },
  { n: "02", title: "Policy decides, deterministically", body: "Registry checks, data protection checks, then your refund policy: below the threshold allowed, between the thresholds approval required, above it denied, duplicates refused. Same input, same answer, full trace." },
  { n: "03", title: "A human decides the risky ones", body: "An eligible approver sees the refund in plain language and approves, rejects, asks for information or escalates. Separation of duties applies and the approval is bound to the exact parameters and an expiry." },
  { n: "04", title: "The gateway executes once", body: "A single live execution grant per request, consumed before the call. The payment system receives a stable idempotency key, so a lost response is reconciled from its own records instead of retried blindly." },
  { n: "05", title: "Everything is on the record", body: "Decision, approval, grant and receipt are appended to a per-organization hash chain with signed checkpoints. Export it; anyone with the public key can verify it." },
];

const TODAY = [
  "Agent registry, tool grants, scoped API keys, lifecycle with suspend and revoke",
  "Deterministic policy engine with a guided refund template (editable thresholds, approver roles, duplicate and reason rules) and the full JSON language underneath",
  "Action Gateway with idempotency, single live grant per request, three-phase execution, ambiguous-outcome reconciliation and human settlement",
  "Approval Center with eligibility, separation of duties, hash binding, expiry, escalation and reassignment",
  "Emergency pause that also stops already-approved actions, plus agent suspension that voids outstanding grants",
  "Tamper-evident evidence ledger with Ed25519 checkpoints, verification and export",
  "Sensitive data detection on parameters, destination allowlists per tool, security events and incidents",
  "Document assessment against ISO/IEC 42001, ISO/IEC 27001:2022 and NIST AI RMF catalogs",
  "Guided onboarding checklist and a sample refund workflow that runs without any external credentials",
  "Guided score-band template: route the score your own fraud or risk model produces into clear, review, hold and block bands, with approvals and holds generated for you",
  "Replay calibration: before activating a draft policy, see what it would have done to the last 30 days of real requests, which outcomes change and how many approvals per day it would create",
  "AEGIS Trading: a guided trading mandate (instrument list, order value bands, unit cap, market hours, duplicate block, daily loss cap) for a trading agent you already run, with an Alpaca paper-trading connector that refuses live keys",
  "Autonomy posture per agent (suspended, restricted, supervised, autonomous) read from its state, tools and policies, and one sentence on every approval saying which limit the request was close to",
  "Optional continuous governance: automatic, evidence-recorded responses to monitoring alerts (suspend the agent, pause the gateway, disable the integration), chosen per rule and reversible by a person",
];

const INTEGRATIONS: { system: string; status: "Sandbox tested" | "Simulated" | "Planned"; detail: string }[] = [
  { system: "Stripe refunds (test mode)", status: "Sandbox tested", detail: "Connector implemented against Stripe's documented test mode with idempotency keys, metadata reconciliation and a connection test. Verified locally against a fake Stripe server; the live test-mode run needs a customer test key. Live keys are refused." },
  { system: "Support platform refunds", status: "Simulated", detail: "In-process stand-in used by the sample workflow. Verifies grants and honours idempotency like a real system; keeps a visible ledger." },
  { system: "Core banking transfers", status: "Simulated", detail: "In-process stand-in used by the banking scenario." },
  { system: "Email gateway, CRM, data warehouse", status: "Simulated", detail: "In-process stand-ins used by the data egress scenario." },
  { system: "Alpaca paper trading (AEGIS Trading)", status: "Sandbox tested", detail: "Connector implemented against Alpaca's paper trading API with client_order_id idempotency, order lookup reconciliation and an account connection test. Verified locally against a fake Alpaca server; the paper-account run needs a customer paper key. Live keys and the live host are refused." },
  { system: "Helpdesk refunds (Zendesk, Intercom), PayPal, Adyen", status: "Planned", detail: "Same connector interface. Not started." },
  { system: "Approvals in Slack or Teams", status: "Planned", detail: "Approvals are decided in the console and over the API today." },
];

const PILOT = [
  { step: "Week 1", what: "Explore the hosted demo, then connect your Stripe test-mode key. Register your support agent through the SDK or REST API and set the refund thresholds you would actually use." },
  { step: "Week 2", what: "Shadow mode: the agent asks the gateway for every refund but your existing process still executes. You compare what AEGIS would have allowed, held or refused." },
  { step: "Weeks 3 to 4", what: "Enforce mode on test-mode refunds: approvers decide in the console, outstanding actions are stopped with the emergency pause when you drill it, and you export the evidence at the end." },
  { step: "Exit", what: "A written report of every decision in the pilot, reconciled against Stripe's own records, and a list of what would need to change for production." },
];

const HERO_RESPONSE = `HTTP/1.1 202 Accepted
{
  "requestId": "0192f0c4-...-7f3a21c0",
  "status": "pending_approval",
  "decision": "require_approval",
  "reasons": ["Refunds from AED 500.00 to AED 2,500.00 need approval"],
  "matchedRuleIds": ["refund-authority/approval-band"],
  "approval": {
    "approvalRequestId": "0192f0c4-...-9b1d",
    "expiresAt": "2026-10-11T13:04:00.000Z",
    "requiredApprovals": 1,
    "requiredRoles": ["approver", "governance_manager", "owner"]
  }
}`;

export function HomePage() {
  return (
    <>
      <Section dark className="!pt-16 !pb-16 md:!pt-24 md:!pb-24">
        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mk-eyebrow mb-4">Governance for AI agents that act</p>
            <h1 className="mk-h1">
              {PROMISE.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mk-lead mt-5 max-w-xl">AEGIS sits between your AI customer-support agent and the refund system. Small refunds go through on their own. Larger ones wait for a named approver. Duplicates, wrong currencies and anything above the limit are refused. Every decision is recorded in a ledger you can verify.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/site/demo">Explore the demo</ButtonLink>
              <ButtonLink href="/site/pilot" variant="secondary">
                Discuss a pilot
                <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
              {[
                ["Decision", "Deterministic, default deny"],
                ["Execution", "One grant, one call, reconciled"],
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
            <p className="mk-hint mt-2">An AED 1,450 refund from the sample workflow. Thresholds are yours to set; these are the demo values.</p>
          </div>
        </div>
      </Section>

      <Section id="for-whom">
        <SectionHeading eyebrow="Who it is for" title="Teams putting an AI agent in front of real money" lead="The first workflow AEGIS supports end to end is refunds issued by an AI customer-support agent. The same machinery applies to transfers, exports and other consequential tool calls." />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {FOR.map((f) => (
            <article key={f.who} className="mk-card">
              <h3 className="mk-h3">{f.who}</h3>
              <p className="mt-3 text-sm text-(--mk-muted)">{f.why}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section id="how-it-works" className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Agent authorization and downstream enforcement" title="How a refund moves through AEGIS" lead="The agent asks, policy decides, a human decides the risky ones, the gateway executes once, and the record is kept. Five steps, each with a transaction boundary where it matters." />
        <ol className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {FLOW.map((s) => (
            <li key={s.n} className="mk-card flex flex-col">
              <span className="shrink-0 font-mono text-xs text-(--mk-accent)">{s.n}</span>
              <h3 className="mk-h3 mt-2">{s.title}</h3>
              <p className="mt-2 flex-1 text-sm text-(--mk-muted)">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Screenshot screen="approvalDetail" caption="An approver sees the refund in words: what, how much, for which order, why, and which rule asked for a human. The JSON and the trace sit behind a details section." priority />
          <Screenshot screen="requestDetail" caption="After approval: the single execution grant, the downstream receipt with the provider reference, and the evidence entries for this request." />
        </div>
      </Section>

      <Section id="today">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading eyebrow="What is implemented today" title="Built and tested, not planned" lead="Everything below runs in the current build and is covered by automated tests. The status page in the implementation report separates implemented, verified, simulated and remaining work." />
            <ul className="mt-6 space-y-2 text-sm">
              {TODAY.map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--mk-allow)" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Note className="mt-6">No customers or certifications are claimed. AEGIS has not been through an independent security audit or penetration test. The hosted demo runs on synthetic data and is labelled as such.</Note>
          </div>
          <div className="space-y-6">
            <Screenshot screen="overview" caption="The Overview leads with what needs a decision, then agent and integration health, then recent actions grouped by outcome." />
            <Screenshot screen="policyThresholds" caption="The guided refund policy: thresholds, approver roles and prohibited conditions in a form, with the outcome of sample requests shown live. The JSON stays editable." />
          </div>
        </div>
      </Section>

      <Section id="integrations" className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Integrations" title="Which systems are simulated, sandbox-tested or planned" lead="Every integration is labelled in the console. Simulated systems are in-process stand-ins that behave like real ones (they verify grants and honour idempotency). Sandbox-tested means a real provider in its documented test mode." />
        <div className="mt-8">
          <Table
            caption="Integration status"
            head={["System", "Status", "Detail"]}
            rows={INTEGRATIONS.map((i) => [
              <span key="s" className="font-medium">
                {i.system}
              </span>,
              <Pill key="p" tone={i.status === "Sandbox tested" ? "allow" : i.status === "Simulated" ? "approval" : "neutral"}>
                {i.status}
              </Pill>,
              <span key="d" className="text-(--mk-muted)">
                {i.detail}
              </span>,
            ])}
          />
        </div>
        <div className="mt-8">
          <Screenshot screen="integrations" caption="Integrations in the console: the kind badge, connection test and credential rules for the Stripe test-mode sandbox." />
        </div>
      </Section>

      <Section id="pilot">
        <SectionHeading eyebrow="How to start a pilot" title="Four weeks, test-mode money only" lead="A pilot runs against your provider's test mode. Live payment keys are refused by the connector, so nothing in a pilot can move real money." />
        <ol className="mt-10 divide-y divide-(--mk-line) border-y border-(--mk-line)">
          {PILOT.map((p) => (
            <li key={p.step} className="grid gap-2 py-5 md:grid-cols-[160px_1fr] md:gap-8">
              <h3 className="font-semibold">{p.step}</h3>
              <p className="text-sm text-(--mk-muted)">{p.what}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/site/pilot">Discuss a pilot</ButtonLink>
          <ButtonLink href="/site/demo" variant="secondary">
            Explore the demo first
          </ButtonLink>
          <Link href="/site/products" className="mk-nav-link self-center">
            All four products
          </Link>
        </div>
      </Section>
    </>
  );
}
