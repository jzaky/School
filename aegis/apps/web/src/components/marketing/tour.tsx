"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Pill, Pre } from "./primitives";

/* Everything here is static text describing the live flow. No gateway is called from this page. */

type Tone = "allow" | "deny" | "approval" | "accent";
type Step = { title: string; actor: string; body: string; tone: Tone; badge: string; request?: string; response?: string; note?: string };

const TRANSFER_REQUEST = `POST /v1/gateway/actions
Authorization: Bearer aegis_ak_532c9780…
Idempotency-Key: TR-2302-1

{
  "tool": "initiate-transfer",
  "action": "transfer",
  "resource": "payments-core",
  "params": {
    "fromAccount": "AE07 0331 2345 6789 0123 456",
    "toAccount": "AE45 0030 0000 9876 5432 100",
    "amount": 250000,
    "currency": "AED",
    "reference": "Supplier settlement Q4 (synthetic)"
  },
  "justification": "Treasury ticket TR-2302: quarterly supplier settlement",
  "principal": { "type": "user", "ref": "treasury.analyst@meridian-demo.example" },
  "context": { "ticket": "TR-2302" },
  "executionMode": "gateway"
}`;

const STEPS: Step[] = [
  {
    title: "The treasury agent asks to make a transfer",
    actor: "Treasury Transfer Agent",
    badge: "Request",
    tone: "accent",
    body: "The agent has prepared an AED 250,000 settlement from a treasury ticket. Before it touches the bank's core ledger, it sends the intended transfer to the Action Gateway, the one door every agent action goes through. It uses its own limited key (a scoped API key) and adds a reference so the same transfer is never carried out twice (an idempotency key). The agent never holds the ledger credential.",
    request: TRANSFER_REQUEST,
  },
  {
    title: "Basic checks pass, no sensitive data is found, the policy asks for approval",
    actor: "Action Gateway",
    badge: "Evaluation",
    tone: "approval",
    body: "The basic checks run first: the agent is active, it is allowed to use initiate-transfer, the details match what the tool expects, payments-core is a permitted system for a transfer, the request is within the agent's limit, and the gateway is not paused. Shield, the data check, then reads the details: it finds two bank account numbers (IBANs) in the address fields and nothing being sent where it should not go. Finally, every rule of the assigned policy is checked. Rule manager-50k-1m matches: the amount is between 50,000 and 1,000,000.",
    response: `{
  "policy": "treasury-transfer-limits v1",
  "evaluated": [
    { "rule": "restricted-ledger-only", "effect": "deny",            "matched": false, "resource.key": "payments-core" },
    { "rule": "aed-only",               "effect": "deny",            "matched": false, "params.currency": "AED" },
    { "rule": "autonomous-under-50k",   "effect": "allow",           "matched": false, "params.amount < 50000": false },
    { "rule": "after-hours-approval",   "effect": "require_approval","matched": false, "params.amount < 50000": false },
    { "rule": "manager-50k-1m",         "effect": "require_approval","matched": true,  "params.amount between [50000, 1000000]": true },
    { "rule": "deny-over-1m",           "effect": "deny",            "matched": false, "params.amount > 1000000": false }
  ],
  "decidingRule": "manager-50k-1m",
  "result": "require_approval",
  "latencyMs": 14
}`,
    note: "A refusal beats an approval, and an approval beats an allow. If no rule matches, the answer is no. Every rule is checked, not just the first that matches, so the explanation always shows all of them.",
  },
  {
    title: "202: approval required, nothing executes",
    actor: "Action Gateway",
    badge: "202 Accepted",
    tone: "approval",
    body: "No money has moved. The decision, the approval request (which expires in four hours) and the evidence entries are saved together in one step, so none of them can exist without the others. The people allowed to approve are notified. The agent receives a 202 reply and can check back or wait; the SDK does this with waitForApproval.",
    response: `HTTP/1.1 202 Accepted
{
  "requestId": "0192f0c4-8d3e-7a1b-9c2f-7f3a21c0e5d4",
  "status": "pending_approval",
  "decision": "require_approval",
  "reasons": ["Manager approval required for transfers between AED 50,000 and 1,000,000"],
  "riskIndicators": ["high_value"],
  "policyVersionIds": ["0192e9a1-…"],
  "matchedRuleIds": ["manager-50k-1m"],
  "approval": {
    "approvalRequestId": "0192f0c4-8d3f-7c21-b0d4-19b1d6a7e802",
    "expiresAt": "2026-10-11T16:41:09.000Z",
    "requiredApprovals": 1,
    "requiredRoles": ["approver", "owner"]
  },
  "correlationId": "TR-2302"
}`,
  },
  {
    title: "A person decides, on exactly the request shown",
    actor: "Approval Center",
    badge: "Human decision",
    tone: "approval",
    body: "The approver sees the agent, the transfer details, the reason given, the rule that asked for approval with its comparisons, and the timeline of evidence. The people who own the agent cannot approve its requests (separation of duties). The decision is tied to a fingerprint of the exact request (the request hash). If the details had changed in the meantime, the approval could not apply.",
    request: `POST /v1/approvals/0192f0c4-8d3f-7c21-b0d4-19b1d6a7e802/decide
Cookie: aegis_session=…

{
  "decision": "approve",
  "comment": "Beneficiary and ticket TR-2302 verified with treasury",
  "requestHash": "3b9f0c5a7e2d4f61…e41a"
}`,
    note: "The other options are reject, request information, escalate and reassign. An approval that has expired is marked expired and can never be used; a late approve is refused.",
  },
  {
    title: "Permission slip issued, the bank system checks it, receipt recorded",
    actor: "Gateway and core banking system",
    badge: "Executed",
    tone: "allow",
    body: "Once approved, the gateway checks again that the agent is still active and the request is unchanged. It then issues a one-time permission slip (an execution grant) tied to a fingerprint of the tool, action and details (SHA-256), valid for five minutes. The bank's system checks the slip before acting and returns a receipt. The slip is used up; trying it again fails.",
    response: `{
  "requestId": "0192f0c4-8d3e-7a1b-9c2f-7f3a21c0e5d4",
  "status": "executed",
  "decision": "require_approval",
  "receipt": {
    "status": "succeeded",
    "downstreamSystem": "core-banking-sim",
    "reference": "TRF-0192F0C4",
    "summary": { "amount": 250000, "currency": "AED", "ledger": "payments-core" }
  }
}`,
  },
  {
    title: "Evidence: six linked entries nobody can quietly edit",
    actor: "Evidence ledger",
    badge: "Recorded",
    tone: "allow",
    body: "The whole flow left a record: decision, approval requested, approval decided, permission slip issued, executed, plus the notification. Each entry stores a fingerprint of the previous entry and of itself (a hash chain over canonical JSON), so any edit shows. Verification recomputes the chain and checks the latest signature (an Ed25519 checkpoint). Exports include the public key, so anyone can check them.",
    response: `seq 1041  gateway.decision.require_approval   prev e2b8…71c3  hash 9c1e…4a07
seq 1042  approval.requested                  prev 9c1e…4a07  hash b74d…08f2
seq 1043  approval.decided                    prev b74d…08f2  hash 5fa0…d9e6
seq 1044  gateway.grant_issued                prev 5fa0…d9e6  hash 71aa…0c3e
seq 1045  gateway.executed                    prev 71aa…0c3e  hash c3d1…66ab
checkpoint  Ed25519 over c3d1…66ab  signed by key outside the database`,
  },
];

function toneClass(t: Tone) {
  return t;
}

export function BankingWalkthrough() {
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Tour steps">
        {STEPS.map((s, idx) => (
          <li key={s.title} className="shrink-0">
            <button type="button" onClick={() => setI(idx)} aria-current={idx === i ? "step" : undefined} className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-start text-sm transition-colors duration-150 ${idx === i ? "border-(--mk-accent) bg-(--mk-accent-soft)" : "border-(--mk-line) hover:bg-(--mk-bg-2)"}`}>
              <span className="mt-0.5 shrink-0 font-mono text-xs text-(--mk-dim)">{String(idx + 1).padStart(2, "0")}</span>
              <span className="hidden lg:inline">{s.title}</span>
              <span className="lg:hidden">{s.badge}</span>
            </button>
          </li>
        ))}
      </ol>
      <article className="mk-card" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-(--mk-dim)">{step.actor}</p>
            <h3 className="mk-h3 mt-1">{step.title}</h3>
          </div>
          <Pill tone={toneClass(step.tone)}>{step.badge}</Pill>
        </div>
        <p className="mt-3 text-sm text-(--mk-muted)">{step.body}</p>
        <div className="mt-5 grid gap-4">
          {step.request ? <Pre label="request">{step.request}</Pre> : null}
          {step.response ? <Pre label={step.request ? "response" : "result"}>{step.response}</Pre> : null}
        </div>
        {step.note ? <p className="mk-hint mt-3">{step.note}</p> : null}
        <div className="mt-6 flex items-center justify-between border-t border-(--mk-line) pt-4">
          <button type="button" className="mk-btn mk-btn-secondary mk-btn-sm" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Previous
          </button>
          <span className="text-xs text-(--mk-dim)">
            Step {i + 1} of {STEPS.length}
          </span>
          <button type="button" className="mk-btn mk-btn-secondary mk-btn-sm" onClick={() => setI((v) => Math.min(STEPS.length - 1, v + 1))} disabled={i === STEPS.length - 1}>
            Next <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </article>
    </div>
  );
}

const REFUND_RULES = [
  { id: "autonomous-band", effect: "allow" as const, test: (a: number) => a > 0 && a < 500, when: "params.amount > 0 and params.amount < 500", reason: "Within what the agent may refund on its own (below AED 500)", outcome: "200: carried out through the support platform, receipt recorded" },
  { id: "approval-band", effect: "require_approval" as const, test: (a: number) => a >= 500 && a <= 2500, when: "params.amount between [500, 2500]", reason: "A supervisor must approve refunds between AED 500 and 2,500", outcome: "202: approval required. Someone with the approver role decides, the request expires after 240 minutes, and the agent's owners cannot approve it (separation of duties)" },
  { id: "above-limit", effect: "deny" as const, test: (a: number) => a > 2500, when: "params.amount > 2500", reason: "The refund is above what the agent is allowed to do (above AED 2,500)", outcome: "403: refused. A security event of medium severity is recorded, with the risk indicator authority_exceeded" },
];

export function RefundSlider() {
  const [amount, setAmount] = useState(1200);
  const fired = useMemo(() => REFUND_RULES.find((r) => r.test(amount)) ?? null, [amount]);
  const effect = fired?.effect ?? "deny";
  const tone: Tone = effect === "allow" ? "allow" : effect === "require_approval" ? "approval" : "deny";
  const label = effect === "allow" ? "Allowed" : effect === "require_approval" ? "Approval required" : "Denied";
  return (
    <div className="mk-card">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <label htmlFor="refund-amount" className="mk-label">
            Refund amount (AED)
          </label>
          <div className="flex items-center gap-3">
            <input id="refund-amount" type="range" min={0} max={5000} step={10} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mk-range" aria-valuetext={`AED ${amount}`} data-testid="refund-slider" />
            <input type="number" min={0} max={5000} step={10} value={amount} onChange={(e) => setAmount(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))} className="mk-input w-28 tabular" aria-label="Refund amount in AED" />
          </div>
          <div className="mt-3 flex justify-between font-mono text-[11px] text-(--mk-dim)" aria-hidden>
            <span>0</span>
            <span>500</span>
            <span>2,500</span>
            <span>5,000</span>
          </div>
          <div className="mt-6" data-testid="refund-outcome">
            <div className="flex items-center gap-3">
              <Pill tone={tone}>{label}</Pill>
              <span className="font-mono text-sm" data-testid="refund-rule">
                {fired ? fired.id : "no rule matched, so the answer is no (default deny)"}
              </span>
            </div>
            <p className="mt-2 text-sm text-(--mk-muted)">{fired ? fired.reason : "The amount must be greater than zero. No rule matched, so the default answer is no."}</p>
            <p className="mt-1 text-sm text-(--mk-muted)">{fired ? fired.outcome : "403: refused."}</p>
          </div>
        </div>
        <div>
          <Pre label="policy refund-authority v1 (excerpt)">{REFUND_RULES.map((r) => `${r.id === fired?.id ? ">" : " "} ${r.id.padEnd(22)} ${r.effect.padEnd(17)} when ${r.when}`).join("\n")}</Pre>
          <p className="mk-hint mt-2">A refusal beats an approval, and an approval beats an allow. If nothing matches, the answer is no. The marker shows which rule decided for the current amount.</p>
        </div>
      </div>
    </div>
  );
}

const EGRESS_REQUEST = `POST /v1/gateway/actions
Authorization: Bearer aegis_ak_349f12b1…

{
  "tool": "export-customer-records",
  "action": "export",
  "params": {
    "segment": "gold-tier",
    "destination": "https://files.partner-upload.example/inbox",
    "fields": ["name", "email", "phone", "iban"]
  },
  "justification": "Share the gold segment with the agency",
  "context": { "source": "untrusted-email-instruction" },
  "idempotencyKey": "oct-14-exfil"
}`;

const EGRESS_RESPONSE = `HTTP/1.1 403 Forbidden
{
  "status": "denied",
  "decision": "deny",
  "reasons": [
    "Destination files.partner-upload.example is outside the tool allowlist (warehouse.meridian-demo.example)",
    "Customer records may only be exported to the internal warehouse"
  ],
  "riskIndicators": ["data_exfiltration_attempt"],
  "matchedRuleIds": ["export-internal-only"],
  "securityEvent": { "severity": "critical", "type": "shield.destination_blocked" }
}`;

const LEAK_REQUEST = `POST /v1/gateway/actions

{
  "tool": "send-email",
  "action": "send",
  "params": {
    "to": "agency@partner-upload.example",
    "subject": "Customer list",
    "body": "Customer 1: Ahmed, card 4111 1111 1111 1111, IBAN AE07 0331 2345 6789 0123 456"
  }
}`;

const LEAK_RESPONSE = `HTTP/1.1 403 Forbidden
{
  "status": "denied",
  "decision": "deny",
  "reasons": [
    "Email contains restricted data classes",
    "Destination partner-upload.example is outside the tool allowlist"
  ],
  "shield": {
    "dataClasses": ["card_number", "iban"],
    "highestSeverity": "high",
    "blocked": true
  },
  "matchedRuleIds": ["no-sensitive-in-email"],
  "riskIndicators": ["sensitive_data_egress"]
}`;

export function EgressBlock() {
  const [tab, setTab] = useState<"export" | "email">("export");
  return (
    <div className="mk-card">
      <div role="tablist" aria-label="Attempts to move customer data out" className="flex flex-wrap gap-2">
        {(["export", "email"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} id={`egress-tab-${t}`} aria-controls={`egress-panel-${t}`} onClick={() => setTab(t)} className={`mk-btn mk-btn-sm ${tab === t ? "mk-btn-primary" : "mk-btn-secondary"}`}>
            {t === "export" ? "Bulk export to an outside website" : "Email containing a card number and a bank account number"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`egress-panel-${tab}`} aria-labelledby={`egress-tab-${tab}`} className="mt-5">
        <p className="text-sm text-(--mk-muted)">
          {tab === "export"
            ? "The marketing agent, following an instruction it found in an email it read, tries to export the gold-tier customer segment to a partner's upload site. The tool may only send data to the internal warehouse (its destination allowlist). The organization-wide rule on moving customer data out (the customer-data-egress policy) refuses any other destination and records a critical security event."
            : "The same agent tries to email a customer list containing a card number and a bank account number (IBAN) to an outside address. Shield, the data check, recognises both and confirms them with the standard check digits (Luhn, mod-97). The no-sensitive-in-email rule refuses because restricted data classes were found (shield.dataClasses), and the destination is also not on the permitted list."}
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Pre label="request">{tab === "export" ? EGRESS_REQUEST : LEAK_REQUEST}</Pre>
          <Pre label="response">{tab === "export" ? EGRESS_RESPONSE : LEAK_RESPONSE}</Pre>
        </div>
        <p className="mk-hint mt-3">The replies are shortened for reading. The real reply also carries requestId, policyVersionIds and correlationId, and the security event is a separate record linked to the request.</p>
      </div>
    </div>
  );
}

export function TourFooterLinks() {
  return (
    <div className="flex shrink-0 flex-wrap gap-3">
      <Link href="/login" className="mk-btn mk-btn-primary">
        Sign in for the live demo
      </Link>
      <Link href="/site/demo" className="mk-btn mk-btn-secondary">
        Request a guided session
      </Link>
    </div>
  );
}
