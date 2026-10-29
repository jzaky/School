import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink, Note, Pill, Pre, Section, SectionHeading, Table } from "./primitives";
import { Screenshot } from "./screenshot";

export const homeMetadata: Metadata = {
  title: "AEGIS by Nexus AI Assurance | Let AI agents handle routine work. Require human approval for risky actions.",
  description: "AEGIS decides what an AI agent may do before it does it. Routine refunds go through on their own, risky ones wait for a named approver, and every decision is kept in a record nobody can quietly edit later (a verifiable ledger). Built for customer-support refund workflows first.",
  alternates: { canonical: "/" },
};

const PROMISE = ["Let AI agents handle routine work.", "Require human approval for risky actions.", "Keep a verifiable record of every decision."];

const FOR = [
  { who: "Heads of customer support and operations", why: "You want the support agent to issue small refunds without a queue. You also want to be the one who decides where \"small\" ends." },
  { who: "Finance and risk", why: "You need a limit the agent cannot talk its way past. You need a named person who approves anything above it. And you need proof afterwards of who allowed what." },
  { who: "Engineering and platform teams", why: "You need one door in front of the refund API (the Action Gateway). You need a one-time permission slip the payment system checks before each refund (an execution grant). And you need the same request never carried out twice, even when a response is lost (an idempotency key). None of this means rewriting the agent." },
];

const FLOW = [
  { n: "01", title: "The agent asks first", body: "Before it touches the payment system, the support agent sends the refund it intends to make (order, customer, amount, reason) to the Action Gateway, the one door every agent action goes through. It uses its own limited key and never holds the payment credential." },
  { n: "02", title: "Policy decides, the same way every time", body: "AEGIS first checks that the agent is registered and allowed, then checks the data in the request, then applies your refund policy. Below your threshold the refund is allowed. Between the thresholds it needs approval. Above them it is refused, and duplicates are refused. The same request always gets the same answer, with a full trace of why (deterministic policy evaluation)." },
  { n: "03", title: "A human decides the risky ones", body: "An approver who is allowed to decide sees the refund in plain words and approves, rejects, asks for information or escalates. The people who own the agent cannot approve its requests (separation of duties). The approval covers exactly the amount and details shown, and it expires." },
  { n: "04", title: "The gateway executes once", body: "The payment system acts only on a one-time permission slip it checks first (an execution grant), used once per request. The request carries a stable reference (an idempotency key), so the same refund is never carried out twice. If a response is lost, AEGIS checks with the payment system what actually happened instead of retrying blindly." },
  { n: "05", title: "Everything is on the record", body: "The decision, the approval, the permission slip and the receipt are added to a record that cannot be edited without it showing (a hash chain with signed checkpoints, one per organization). Export it, and anyone with the public key can check it." },
];

const TODAY = [
  "A register of every agent, what each one may do, its own limited keys (scoped API keys), and the ability to suspend or revoke it",
  "A policy engine that gives the same request the same answer every time, with a guided refund template (editable thresholds, approver roles, duplicate and reason rules) and the full rule language underneath for engineers (JSON)",
  "The Action Gateway, the one door every agent action goes through: the same request is never carried out twice (idempotency), one permission slip per request (a single live grant), execution in three phases, and when the outcome is unclear it checks with the other system or hands the case to a person to settle",
  "An Approval Center that knows who may decide, stops the agent's owners approving its requests (separation of duties), ties each approval to the exact request (hash binding), lets it expire, and supports escalation and reassignment",
  "An emergency pause that also stops actions already approved, plus an agent suspension that cancels any outstanding permission slips (grants)",
  "An evidence record that cannot be edited without it showing (a tamper-evident ledger with Ed25519 signed checkpoints), which you can verify and export",
  "Detection of sensitive data in what an agent sends, a list of permitted destinations for each tool, and security events and incidents to track what was found",
  "Assessment of your documents against 21 framework catalogs (487 controls): ISO/IEC 42001, 27001, 23894, 27701, 27017, 27018, 42005 and 38507, NIST AI RMF and CSF 2.0, the EU AI Act, GDPR, the UAE PDPL, the UAE Information Assurance Regulation, Dubai DESC ISR, DIFC data protection, the OWASP LLM Top 10, the AICPA trust services criteria, PCI DSS, the Singapore model AI governance framework and the SDAIA AI ethics principles. Each catalog is an original summary with its license note",
  "A free public governance checker: fourteen questions, scored in your own browser and mapped to those catalogs. Nothing you enter is stored",
  "A guided setup checklist and a sample refund workflow that runs without connecting any outside system or credentials",
  "A guided score-band template: take the score your own fraud or risk model already produces and route it into clear, review, hold and block bands. The approvals and holds are generated for you",
  "Replay calibration: before you switch on a draft policy, see what it would have done to the last 30 days of real requests, which outcomes change, and how many approvals per day it would create",
  "AEGIS Trading: a guided trading mandate for a trading agent you already run (permitted instruments, order value bands, a cap on units, market hours, duplicate block, daily loss cap), with an Alpaca paper-trading connector that refuses live keys",
  "A posture for each agent, showing how much it may do on its own (suspended, restricted, supervised, autonomous), worked out from its state, tools and policies. Every approval also carries one sentence saying which limit the request was close to",
  "Optional continuous governance: when a monitoring rule fires, AEGIS can respond on its own (suspend the agent, pause the gateway, disable the integration). You choose the response for each rule, every response is recorded as evidence, and a person can reverse it",
];

const INTEGRATIONS: { system: string; status: "Sandbox tested" | "Simulated" | "Planned"; detail: string }[] = [
  { system: "Stripe refunds (test mode)", status: "Sandbox tested", detail: "Built against Stripe's documented test mode. The same refund is never sent twice (idempotency keys), AEGIS checks with Stripe what actually happened (metadata reconciliation), and there is a connection test. Verified locally against a fake Stripe server; the live test-mode run needs a customer test key. Live keys are refused." },
  { system: "Support platform refunds", status: "Simulated", detail: "A stand-in that runs inside AEGIS and is used by the sample workflow. It checks the permission slip (grant) and never carries out the same request twice, as a real system would. It keeps a visible ledger." },
  { system: "Core banking transfers", status: "Simulated", detail: "A stand-in that runs inside AEGIS, used by the banking scenario." },
  { system: "Email gateway, CRM, data warehouse", status: "Simulated", detail: "Stand-ins that run inside AEGIS, used by the scenario where an agent tries to move customer data out (data egress)." },
  { system: "Alpaca paper trading (AEGIS Trading)", status: "Sandbox tested", detail: "Built against Alpaca's paper trading API. The same order is never sent twice (client_order_id idempotency), AEGIS checks with Alpaca what actually happened (order lookup reconciliation), and there is an account connection test. Verified locally against a fake Alpaca server; the paper-account run needs a customer paper key. Live keys and the live host are refused." },
  { system: "Helpdesk refunds (Zendesk, Intercom), PayPal, Adyen", status: "Planned", detail: "Would use the same connector interface. Not started." },
  { system: "Approvals in Slack or Teams", status: "Planned", detail: "Today, approvals are decided in the console and over the API." },
];

const PILOT = [
  { step: "Week 1", what: "Explore the hosted demo, then connect your Stripe test-mode key. Register your support agent (through the SDK or REST API) and set the refund thresholds you would actually use." },
  { step: "Week 2", what: "Shadow mode: the agent asks AEGIS about every refund, but your existing process still carries it out. You compare what AEGIS would have allowed, held or refused." },
  { step: "Weeks 3 to 4", what: "Enforce mode on test-mode refunds: AEGIS now decides. Approvers decide in the console, you drill the emergency pause and watch it stop outstanding actions, and you export the evidence at the end." },
  { step: "Exit", what: "A written report of every decision in the pilot, checked against Stripe's own records, and a list of what would need to change for production." },
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
            <p className="mk-eyebrow mb-4">Control over what AI agents are allowed to do</p>
            <h1 className="mk-h1">
              {PROMISE.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mk-lead mt-5 max-w-xl">AEGIS sits between your AI customer-support agent and the refund system. Small refunds go through on their own. Larger ones wait for a named approver. Duplicates, wrong currencies and anything above the limit are refused. Every decision is kept in a record nobody can quietly edit later (a verifiable ledger).</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/site/demo">Explore the demo</ButtonLink>
              <ButtonLink href="/site/pilot" variant="secondary">
                Discuss a pilot
                <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
              {[
                ["Decision", "Same request, same answer. When in doubt, no"],
                ["Execution", "One permission slip, one call, then checked"],
                ["Evidence", "A record that shows any edit"],
                ["Deployment", "Runs privately, calls no AI provider"],
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
              <span className="font-mono text-[11px] uppercase tracking-wider text-(--mk-dim)">the gateway&apos;s reply, demo tenant with made-up data</span>
              <Pill tone="approval">Approval required</Pill>
            </div>
            <Pre>{HERO_RESPONSE}</Pre>
            <p className="mk-hint mt-2">An AED 1,450 refund from the sample workflow. The thresholds are yours to set; these are the demo values.</p>
          </div>
        </div>
      </Section>

      <Section id="for-whom">
        <SectionHeading eyebrow="Who it is for" title="Teams putting an AI agent in front of real money" lead="The first workflow AEGIS supports from start to finish is refunds issued by an AI customer-support agent. The same controls apply to transfers, data exports and any other action with real consequences (any tool call)." />
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
        <SectionHeading eyebrow="Permission first, then enforcement" title="How a refund moves through AEGIS" lead="The agent asks, the policy decides, a person decides the risky ones, the gateway carries it out once, and the record is kept. Five steps. Where it matters, each step is saved safely before the next begins (a transaction boundary)." />
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
          <Screenshot screen="approvalDetail" caption="An approver sees the refund in words: what, how much, for which order, why, and which rule asked for a person. The technical details (the JSON and the trace) sit behind a details section." priority />
          <Screenshot screen="requestDetail" caption="After approval: the one-time permission slip used for this refund (the execution grant), the receipt from the payment system with its reference, and every evidence entry for this request." />
        </div>
      </Section>

      <Section id="today">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading eyebrow="What is implemented today" title="Built and tested, not planned" lead="Everything below runs in the current build and is covered by automated tests. The status page in the implementation report separates what is implemented, what is verified, what is simulated and what remains to be done." />
            <ul className="mt-6 space-y-2 text-sm">
              {TODAY.map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-(--mk-allow)" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Note className="mt-6">No customers or certifications are claimed. AEGIS has not been through an independent security audit or penetration test. The hosted demo runs on made-up data (synthetic) and is labelled as such.</Note>
          </div>
          <div className="space-y-6">
            <Screenshot screen="overview" caption="The Overview starts with what needs a decision, then whether agents and connected systems are healthy, then recent actions grouped by outcome." />
            <Screenshot screen="policyThresholds" caption="The guided refund policy: thresholds, who may approve and what is never allowed, in a form. The outcome for sample requests updates as you change it. The underlying rules (JSON) stay editable." />
          </div>
        </div>
      </Section>

      <Section id="integrations" className="bg-(--mk-bg-2)">
        <SectionHeading eyebrow="Integrations" title="Which systems are simulated, sandbox-tested or planned" lead="Every connected system is labelled in the console. Simulated systems are stand-ins that run inside AEGIS and behave like real ones: they check the permission slip (grant) and never carry out the same request twice (idempotency). Sandbox-tested means a real provider, running in its documented test mode." />
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
          <Screenshot screen="integrations" caption="Connected systems in the console: the label saying what kind each one is, the connection test, and the credential rules for the Stripe test-mode sandbox." />
        </div>
      </Section>

      <Section id="pilot">
        <SectionHeading eyebrow="How to start a pilot" title="Four weeks, test-mode money only" lead="A pilot runs against your payment provider's test mode. The connector refuses live payment keys, so nothing in a pilot can move real money." />
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
