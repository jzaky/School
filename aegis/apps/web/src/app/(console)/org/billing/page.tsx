import type { Metadata } from "next";
import Link from "next/link";
import { withTenant } from "@aegis/db";
import { featuresFor, subscriptionSummary } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Panel } from "@/components/ui/panel";
import { StatPanel } from "@/components/ui/stat-panel";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { EnterprisePricingForm } from "@/components/org/billing-form";
import type { Tone } from "@/lib/status";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const USAGE_TONE: Record<string, Tone> = { ok: "allow", near: "approval", over: "deny", unlimited: "neutral" };
const INVOICE_TONE: Record<string, Tone> = { issued: "approval", paid: "allow", void: "neutral", draft: "neutral" };

export default async function BillingPage() {
  const c = await requirePermission("org:read");
  const s = await withTenant(c.ctx.orgId, (db) => subscriptionSummary(db, c.ctx), { readOnly: true });
  const trial = s.trial;
  const features = featuresFor(s.plan.key);
  return (
    <div>
      <PageHeader title="Billing" description="Your plan, this month's usage against its limits, your contract and invoices." badges={<DemoBadge show={c.org.demoMode} />} />
      <Note className="mb-4">AEGIS is not connected to a payment provider. It never charges a card or collects payment; invoices here are documents from your provider, and payment happens outside AEGIS. Limits are reported, not enforced: nothing stops when one is passed.</Note>
      <div className="grid gap-3 md:grid-cols-3">
        <StatPanel label="Plan" value={<span data-testid="billing-plan" data-plan={s.plan.key}>{s.plan.name}</span>} footer={s.plan.summary} />
        <StatPanel
          label={trial.state === "not_trial" ? "Contract term" : "Trial"}
          value={trial.state === "active" || trial.state === "ending_soon" ? `${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left` : trial.state === "ended" ? "Ended" : trial.state === "no_end_date" ? "No end date" : s.contract ? `Until ${formatDate(s.contract.termEnd)}` : "No contract recorded"}
          tone={trial.state === "ending_soon" || trial.state === "ended" ? "approval" : undefined}
          footer={trial.state === "active" || trial.state === "ending_soon" ? `Ends ${formatDate(trial.endsAt)}` : trial.state === "ended" ? `Ended ${formatDate(trial.endedAt)}. Nothing has been switched off; contact your provider to continue.` : s.contract ? `${s.contract.billingPeriod} billing, ${s.contract.paymentTermsDays} days to pay` : undefined}
        />
        <StatPanel label="Usage period" value={s.period} footer="Calendar month, UTC. Attack Simulation Lab traffic is never counted." />
      </div>

      <Panel title="Usage this month" description="Measured from your own records when the page loads" className="mt-4" padded={false}>
        <ul className="divide-y divide-line" data-testid="usage-lines">
          {s.lines.map((l) => (
            <li key={l.metric} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-metric={l.metric} data-status={l.status}>
              <span className="text-sm text-fg">{l.label}</span>
              <span className="flex items-center gap-2 text-sm tabular">
                {l.used.toLocaleString("en-GB")} {l.limit === null ? "" : `of ${l.limit.toLocaleString("en-GB")}`}
                <Badge tone={USAGE_TONE[l.status] ?? "neutral"}>{l.status === "unlimited" ? "set by contract" : l.status === "near" ? "80% or more" : l.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="What your plan includes" padded={false}>
          <ul className="divide-y divide-line text-sm" data-testid="plan-features">
            {features.map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-3 px-4 py-2" data-feature={f.key} data-included={f.included && f.status === "available" ? "yes" : "no"}>
                <span className={f.included ? "text-fg" : "text-fg-dim"}>{f.name}</span>
                {f.status === "planned" ? <Badge tone="neutral">planned, not built</Badge> : f.included ? <Badge tone="allow">included</Badge> : <Badge tone="neutral">higher plan</Badge>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Contract" description="Recorded by your provider from the signed agreement">
          {s.contract ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-fg-muted">Term</dt>
              <dd>
                {formatDate(s.contract.termStart)} to {formatDate(s.contract.termEnd)}
              </dd>
              <dt className="text-fg-muted">Fee</dt>
              <dd className="tabular">
                {formatMoney(s.contract.periodFee, s.contract.currency)} per {s.contract.billingPeriod === "annual" ? "year" : s.contract.billingPeriod === "quarterly" ? "quarter" : "month"}
              </dd>
              <dt className="text-fg-muted">Included decisions</dt>
              <dd className="tabular">{s.contract.includedDecisions === null ? "Unlimited" : s.contract.includedDecisions.toLocaleString("en-GB")}</dd>
              <dt className="text-fg-muted">Tax rate</dt>
              <dd className="tabular">{s.contract.taxRatePercent}%</dd>
              {s.contract.purchaseOrder ? (
                <>
                  <dt className="text-fg-muted">Purchase order</dt>
                  <dd className="font-mono text-xs">{s.contract.purchaseOrder}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-fg-muted">No contract has been recorded for this organization. Plans are priced by quote; use the form below to ask for one.</p>
          )}
        </Panel>
      </div>

      <Panel title="Invoices" className="mt-4" padded={false}>
        {s.invoices.length ? (
          <SimpleTable caption="Invoices" className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th>Due</Th>
                <Th align="end">Total</Th>
              </tr>
            </thead>
            <tbody>
              {s.invoices.map((i) => (
                <Tr key={i.id} data-invoice={i.number}>
                  <Td mono>
                    <Link href={`/org/billing/invoices/${i.id}`} className="text-accent hover:underline">
                      {i.number}
                    </Link>
                  </Td>
                  <Td>{formatDate(i.periodStart)}</Td>
                  <Td>
                    <Badge tone={INVOICE_TONE[i.status] ?? "neutral"}>{i.status}</Badge>
                  </Td>
                  <Td>{i.dueAt ? formatDate(i.dueAt) : ""}</Td>
                  <Td align="end">{formatMoney(i.total, i.currency)}</Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        ) : (
          <p className="px-4 py-3 text-sm text-fg-muted">No invoices have been issued.</p>
        )}
      </Panel>

      <Panel title="Ask for a quote or a plan change" description="Your request is recorded as a platform event. Only the details you type are stored." className="mt-4">
        <EnterprisePricingForm defaultName={c.session.user.name} defaultEmail={c.session.user.email} />
      </Panel>
    </div>
  );
}
