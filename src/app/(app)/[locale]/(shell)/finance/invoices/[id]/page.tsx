import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Download, Sparkles } from "lucide-react";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { pick } from "@/lib/i18n-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { InvoiceStatus, Money } from "@/components/fees/shared";
import { CancelProformaButton, CreditNoteDialog, RecordPaymentDialog, ReminderButton } from "@/components/fees/account-dialogs";
import { canFinance, invoiceDetail, todayKey } from "@/server/fees/queries";
import { creditableLines, earlyPaymentOffer } from "@/server/fees/ledger";
import type { Seller } from "@/server/fees/config";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("invoice.title") };
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx)) notFound();
  const { id } = await params;
  const d = await invoiceDetail(ctx, id);
  if (!d) notFound();
  const t = await getTranslations("finance");
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const inv = d.invoice;
  const seller = inv.seller as unknown as Seller;
  const today = new Date(`${todayKey()}T00:00:00+04:00`);
  const open = inv.kind === "TAX" && (inv.status === "OPEN" || inv.status === "PARTIAL");
  // A proforma paid in full becomes a tax invoice (the payment form does that).
  const payable = open || (inv.kind === "PROFORMA" && inv.status === "OPEN");
  const [credit, early] = await Promise.all([
    inv.kind === "TAX" && ctx.can("fees.manage") ? tenantTx(ctx.orgId, (tx) => creditableLines(tx, ctx.orgId, inv.id)) : Promise.resolve(null),
    open ? tenantTx(ctx.orgId, (tx) => earlyPaymentOffer(tx, ctx.orgId, inv.id, new Date())) : Promise.resolve(null),
  ]);
  const reminderBlock = !open ? t("invoice.reminderClosed") : d.account?.remindersPaused ? t("invoice.reminderPaused") : null;
  const title = inv.kind === "PROFORMA" ? t("invoice.proforma") : seller.vatRegistered ? t("invoice.taxInvoice") : t("invoice.plainInvoice");

  return (
    <PageBody className="max-w-5xl">
      <Link prefetch={false} href={d.account ? `/finance/accounts/${d.account.id}` : "/finance/invoices"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {d.account ? pick(L, d.account.nameEn, d.account.nameAr) : t("invoices.title")}
      </Link>
      <PageHeader
        eyebrow={title}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <bdi data-testid="invoice-number">{inv.number}</bdi>
            <InvoiceStatus status={inv.status} kind={inv.kind} overdue={inv.dueDate < today} />
          </span>
        }
        description={inv.periodLabelEn ? pick(L, inv.periodLabelEn, inv.periodLabelAr) : undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={`/api/fees/invoices/${inv.id}/pdf`} data-testid="invoice-pdf">
                <Download className="size-4" />
                {t("invoice.download")}
              </a>
            </Button>
            {open && ctx.can("fees.collect") && <ReminderButton invoiceId={inv.id} disabledReason={reminderBlock} />}
            {credit && ctx.can("fees.manage") && <CreditNoteDialog invoiceId={inv.id} locale={L} lines={credit.lines.map((l) => ({ id: l.line.id, description: pick(L, l.line.descriptionEn, l.line.descriptionAr), netLeft: l.netLeft, vatRateBp: l.line.vatRateBp }))} />}
            {inv.kind === "PROFORMA" && inv.status === "OPEN" && ctx.can("fees.manage") && <CancelProformaButton invoiceId={inv.id} />}
            {payable && ctx.can("fees.collect") && d.account && (
              <RecordPaymentDialog
                accountId={d.account.id}
                invoices={[{ id: inv.id, number: inv.number, balanceFils: d.balanceFils }]}
                defaultInvoiceId={inv.id}
                early={early ? { invoiceId: inv.id, discountFils: early.discountFils, payNowFils: early.payNowFils, deadline: fmtDate(prefs, early.deadline) } : null}
                locale={L}
              />
            )}
          </>
        }
      />

      {early && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft/40 p-4 text-sm" data-testid="early-offer">
          <Sparkles className="mt-0.5 size-4 text-success" />
          <span>{t("invoice.earlyOffer", { date: fmtDate(prefs, early.deadline) })} <Money fils={early.discountFils} locale={L} className="font-semibold" /></span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <div className="text-xs text-muted-foreground">{t("invoice.billTo")}</div>
          <div className="mt-1 font-medium">{pick(L, inv.billToName, inv.billToNameAr)}</div>
          {inv.billToAddress && <div className="text-xs text-muted-foreground">{inv.billToAddress}</div>}
          {inv.billToTrn && <div className="text-xs text-muted-foreground">{t("invoice.trn", { trn: inv.billToTrn })}</div>}
          {d.account && <div className="mt-1 text-xs text-muted-foreground"><bdi>{d.account.code}</bdi></div>}
        </Panel>
        <Panel>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("invoice.issued")}</dt>
            <dd className="text-end tabular-nums">{fmtDate(prefs, inv.issueDate)}</dd>
            <dt className="text-muted-foreground">{t("invoice.due")}</dt>
            <dd className="text-end tabular-nums">{fmtDate(prefs, inv.dueDate)}</dd>
            {inv.lastReminderAt && (
              <>
                <dt className="text-muted-foreground">{t("invoice.lastReminder")}</dt>
                <dd className="text-end tabular-nums">{fmtDate(prefs, inv.lastReminderAt)}</dd>
              </>
            )}
          </dl>
        </Panel>
        <Panel>
          <div className="text-xs text-muted-foreground">{t("invoice.seller")}</div>
          <div className="mt-1 font-medium">{pick(L, seller.nameEn, seller.nameAr)}</div>
          {seller.trn && <div className="text-xs text-muted-foreground">{t("invoice.trn", { trn: seller.trn })}</div>}
        </Panel>
      </div>

      <Panel padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm" data-testid="invoice-lines">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("invoice.description")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoice.qty")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoice.gross")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoice.discount")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoice.taxable")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoice.vatRate")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("invoice.vat")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("invoice.total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {inv.lines.map((l) => {
                const ds = (l.discounts as Array<{ labelEn: string; labelAr: string; amountFils: number }> | null) ?? [];
                return (
                  <tr key={l.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <div>{pick(L, l.descriptionEn, l.descriptionAr)}</div>
                      <div className="text-xs text-muted-foreground">{t(`vat.${l.vatTreatment}`)}</div>
                      {ds.map((x, i) => (
                        <div key={i} className="text-xs text-success">
                          {pick(L, x.labelEn, x.labelAr)}: -<Money fils={x.amountFils} locale={L} />
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{l.quantity}</td>
                    <td className="px-3 py-2.5 text-end"><Money fils={l.grossFils} locale={L} /></td>
                    <td className="px-3 py-2.5 text-end">{l.discountFils ? <>-<Money fils={l.discountFils} locale={L} /></> : "-"}</td>
                    <td className="px-3 py-2.5 text-end"><Money fils={l.netFils} locale={L} /></td>
                    <td className="px-3 py-2.5 text-end tabular-nums">{l.vatRateBp / 100}%</td>
                    <td className="px-3 py-2.5 text-end"><Money fils={l.vatFils} locale={L} /></td>
                    <td className="px-4 py-2.5 text-end font-medium"><Money fils={l.totalFils} locale={L} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t p-4">
          <dl className="grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm" data-testid="invoice-totals">
            <dt className="text-muted-foreground">{t("invoice.subtotal")}</dt>
            <dd className="text-end"><Money fils={inv.subtotalFils} locale={L} /></dd>
            <dt className="text-muted-foreground">{t("invoice.discounts")}</dt>
            <dd className="text-end">{inv.discountFils ? "-" : ""}<Money fils={inv.discountFils} locale={L} /></dd>
            <dt className="text-muted-foreground">{t("invoice.taxableTotal")}</dt>
            <dd className="text-end"><Money fils={inv.netFils} locale={L} /></dd>
            <dt className="text-muted-foreground">{t("invoice.vatTotal")}</dt>
            <dd className="text-end"><Money fils={inv.vatFils} locale={L} /></dd>
            <dt className="font-semibold">{t("invoice.total")}</dt>
            <dd className="text-end font-semibold"><Money fils={inv.totalFils} locale={L} /></dd>
            {inv.kind === "TAX" && (
              <>
                <dt className="text-muted-foreground">{t("invoice.paid")}</dt>
                <dd className="text-end">{inv.paidFils ? "-" : ""}<Money fils={inv.paidFils} locale={L} /></dd>
                <dt className="text-muted-foreground">{t("invoice.credited")}</dt>
                <dd className="text-end">{inv.creditedFils ? "-" : ""}<Money fils={inv.creditedFils} locale={L} /></dd>
                <dt className="font-semibold">{t("invoice.balance")}</dt>
                <dd className="text-end font-semibold" data-testid="invoice-balance"><Money fils={d.balanceFils} locale={L} /></dd>
              </>
            )}
          </dl>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("invoice.paymentsTitle")} />
          {d.perPayment.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("invoice.noPayments")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.perPayment.map(({ payment: p, amountFils }) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    <bdi>{p.number}</bdi> · {t(`method.${p.method}`)} · <span className="text-muted-foreground">{fmtDate(prefs, p.clearedAt ?? p.receivedAt)}</span>
                  </span>
                  <Money fils={amountFils} locale={L} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("invoice.creditsTitle")} />
          {d.creditNotes.length === 0 && !d.converted && !d.from ? (
            <p className="text-sm text-muted-foreground">{t("invoice.noCredits")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.creditNotes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <a href={`/api/fees/credit-notes/${c.id}/pdf`} className="hover:underline">
                    <bdi>{c.number}</bdi> · <span className="text-muted-foreground">{pick(L, c.reasonEn, c.reasonAr)}</span>
                  </a>
                  <Money fils={c.totalFils} locale={L} className="font-medium" />
                </li>
              ))}
              {d.converted && (
                <li>
                  {t("invoice.convertedTo")}{" "}
                  <Link prefetch={false} href={`/finance/invoices/${d.converted.id}`} className="font-medium text-brand hover:underline">
                    <bdi>{d.converted.number}</bdi>
                  </Link>
                </li>
              )}
              {d.from && (
                <li>
                  {t("invoice.convertedFrom")}{" "}
                  <Link prefetch={false} href={`/finance/invoices/${d.from.id}`} className="font-medium text-brand hover:underline">
                    <bdi>{d.from.number}</bdi>
                  </Link>
                </li>
              )}
            </ul>
          )}
          {d.links.length > 0 && (
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              {d.links.map((l) => (
                <div key={l.id}>
                  {t("invoice.link", { status: t(`linkStatus.${l.status}`), when: fmtDateTime(prefs, l.createdAt) })}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <p className="text-xs text-muted-foreground">{t("invoice.immutableNote")}</p>
    </PageBody>
  );
}
