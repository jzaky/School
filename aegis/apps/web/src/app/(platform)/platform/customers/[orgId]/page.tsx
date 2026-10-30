import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isAegisError, PLANS, platformCustomerDetail } from "@aegis/core";
import { requirePlatformAdmin } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { ContractForm, DraftInvoiceForm, InvoiceActions, PlanForm, SupportUpdateForm } from "@/components/commercial/platform-forms";
import type { Tone } from "@/lib/status";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

const USAGE_TONE: Record<string, Tone> = { ok: "allow", near: "approval", over: "deny", unlimited: "neutral" };

export default async function CustomerPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const s = await requirePlatformAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) notFound();
  const d = await platformCustomerDetail(s.user.id, orgId).catch((e) => {
    if (isAegisError(e) && e.code === "not_found") return null;
    throw e;
  });
  if (!d) notFound();
  const h = d.health;
  const prev = new Date();
  prev.setUTCDate(1);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevPeriod = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Customers", href: "/platform/customers" }, { label: d.org.name }]} title={d.org.name} description={`${d.org.slug}. Plan ${PLANS[h.plan].name}.`} badges={<Badge tone="info">Platform admin</Badge>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Plan and trial">
          <PlanForm orgId={orgId} plan={h.plan} trialEndsAt={d.org.trialEndsAt ? d.org.trialEndsAt.toISOString() : null} />
        </Panel>
        <Panel title={`Usage, ${d.period}`} padded={false}>
          <ul className="divide-y divide-line text-sm">
            {d.lines.map((l) => (
              <li key={l.metric} className="flex items-center justify-between gap-2 px-4 py-2">
                <span>{l.label}</span>
                <span className="flex items-center gap-2 tabular">
                  {l.used.toLocaleString("en-GB")}
                  {l.limit === null ? "" : ` of ${l.limit.toLocaleString("en-GB")}`}
                  <Badge tone={USAGE_TONE[l.status] ?? "neutral"}>{l.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Contract" description={d.contract ? `Active: ${PLANS[d.contract.plan].name}, ${formatMoney(d.contract.periodFee, d.contract.currency)} per ${d.contract.billingPeriod} period, ${formatDate(d.contract.termStart)} to ${formatDate(d.contract.termEnd)}. Recording a new contract replaces it.` : "No contract recorded. Amounts come from the signed agreement; AEGIS has no price list."} className="mt-4">
        <ContractForm orgId={orgId} />
      </Panel>
      <Panel title="Invoices" description="Drafted from the contract and the period's measured usage. Amounts never change after drafting; a mistake is voided and redrafted. AEGIS does not collect payment." className="mt-4">
        <DraftInvoiceForm orgId={orgId} defaultPeriod={prevPeriod} hasContract={!!d.contract} />
        {d.invoices.length ? (
          <SimpleTable caption="Invoices" className="mt-3">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th align="end">Total</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {d.invoices.map((i) => (
                <Tr key={i.id} data-invoice={i.number} data-status={i.status}>
                  <Td mono>{i.number}</Td>
                  <Td>{formatDate(i.periodStart)}</Td>
                  <Td>
                    <Badge tone={i.status === "paid" ? "allow" : i.status === "issued" ? "approval" : "neutral"}>{i.status}</Badge>
                  </Td>
                  <Td align="end">{formatMoney(i.total, i.currency)}</Td>
                  <Td>
                    <InvoiceActions orgId={orgId} invoiceId={i.id} status={i.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        ) : null}
      </Panel>
      <Panel title="Support requests" className="mt-4" padded={false}>
        {d.support.length ? (
          <ul className="divide-y divide-line">
            {d.support.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.subject}</span>
                  <span className="flex gap-1.5">
                    <Badge tone={r.severity === "urgent" ? "deny" : r.severity === "high" ? "approval" : "neutral"}>{r.severity}</Badge>
                    <Badge tone={r.status === "resolved" ? "allow" : "approval"}>{r.status.replace("_", " ")}</Badge>
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{r.body}</p>
                <p className="text-xs text-fg-dim">Opened {formatDateTime(r.createdAt)}</p>
                <SupportUpdateForm orgId={orgId} requestId={r.id} status={r.status} resolution={r.resolution} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-fg-muted">No support requests.</p>
        )}
      </Panel>
      {d.usageHistory.length ? (
        <Panel title="Recorded usage" description="Snapshots written by the background job (idempotent, one per month and metric)" className="mt-4" padded={false}>
          <SimpleTable caption="Usage history" className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Metric</Th>
                <Th align="end">Value</Th>
              </tr>
            </thead>
            <tbody>
              {d.usageHistory.map((u) => (
                <Tr key={`${u.period}-${u.metric}`}>
                  <Td mono>{u.period}</Td>
                  <Td>{u.metric.replace(/_/g, " ")}</Td>
                  <Td align="end">{u.value.toLocaleString("en-GB")}</Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        </Panel>
      ) : null}
    </div>
  );
}
