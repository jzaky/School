import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withTenant } from "@aegis/db";
import { getInvoiceForOrg, isAegisError } from "@aegis/core";
import { requirePermission } from "@/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePermission("org:read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const inv = await withTenant(c.ctx.orgId, (db) => getInvoiceForOrg(db, c.ctx, id), { readOnly: true }).catch((e) => {
    if (isAegisError(e) && e.code === "not_found") return null;
    throw e;
  });
  if (!inv) notFound();
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Billing", href: "/org/billing" }, { label: inv.number }]} title={`Invoice ${inv.number}`} description={`${c.org.name}, ${formatDate(inv.periodStart)} to ${formatDate(new Date(inv.periodEnd.getTime() - 1))}`} badges={<Badge tone={inv.status === "paid" ? "allow" : inv.status === "issued" ? "approval" : "neutral"}>{inv.status}</Badge>} />
      <Panel padded={false}>
        <SimpleTable caption="Invoice lines" className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Description</Th>
              <Th align="end">Quantity</Th>
              <Th align="end">Unit price</Th>
              <Th align="end">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <Tr key={i}>
                <Td>{l.description}</Td>
                <Td align="end">{l.quantity.toLocaleString("en-GB")}</Td>
                <Td align="end">{l.unitPrice.toLocaleString("en-GB", { maximumFractionDigits: 4 })}</Td>
                <Td align="end">{formatMoney(l.amount, inv.currency)}</Td>
              </Tr>
            ))}
            <Tr>
              <Td colSpan={3} className="text-end text-fg-muted">
                Subtotal
              </Td>
              <Td align="end">{formatMoney(inv.subtotal, inv.currency)}</Td>
            </Tr>
            <Tr>
              <Td colSpan={3} className="text-end text-fg-muted">
                Tax
              </Td>
              <Td align="end">{formatMoney(inv.tax, inv.currency)}</Td>
            </Tr>
            <Tr>
              <Td colSpan={3} className="text-end font-medium">
                Total
              </Td>
              <Td align="end" className="font-semibold" data-testid="invoice-total">
                {formatMoney(inv.total, inv.currency)}
              </Td>
            </Tr>
          </tbody>
        </SimpleTable>
      </Panel>
      <p className="mt-3 text-xs text-fg-dim">
        {inv.issuedAt ? `Issued ${formatDate(inv.issuedAt)}. ` : ""}
        {inv.dueAt ? `Due ${formatDate(inv.dueAt)}. ` : ""}
        {inv.paidAt ? `Payment recorded ${formatDate(inv.paidAt)}${inv.paymentReference ? ` (reference ${inv.paymentReference})` : ""}. ` : ""}
        {inv.voidReason ? `Voided: ${inv.voidReason}. ` : ""}
        Payment is made outside AEGIS.
      </p>
    </div>
  );
}
