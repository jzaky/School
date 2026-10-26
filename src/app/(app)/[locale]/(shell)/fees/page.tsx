import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarClock, CheckCircle2, CreditCard, Download, FileText, Info, Receipt, Wallet } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick, personName } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { cn } from "@/lib/utils";
import { formatPrefs } from "@/server/format";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Link } from "@/i18n/navigation";
import { FeesCard } from "@/components/fees/fees-card";
import { InvoiceStatus, Money, PaymentStatus } from "@/components/fees/shared";
import { PayButton } from "@/components/fees/parent-pay";
import { parentStatement } from "@/server/fees/parent";
import { balanceOf } from "@/server/fees/ledger";
import { loadFinanceConfig } from "@/server/fees/config";
import { onlinePaymentAvailable } from "@/server/payments/providers";
import { todayKey } from "@/server/fees/queries";

export async function generateMetadata() {
  const t = await getTranslations("fees");
  return { title: t("title") };
}

/**
 * Parents: statements, invoices, receipts and balance when the school bills in Horizon; otherwise the school's own
 * payment portal link. Students never see fees.
 */
export default async function FeesPage({ searchParams }: { searchParams: Promise<{ account?: string; paid?: string; cancelled?: string; invoice?: string }> }) {
  const ctx = await getCtx();
  if (!ctx.isParent || !ctx.can("family.portal")) notFound();
  const sp = await searchParams;
  const st = await parentStatement(ctx, sp.account);
  const t = await getTranslations("fees");
  const tf = await getTranslations("finance");
  const tg = await getTranslations();
  if (!st || !st.invoices.length) {
    if (!ctx.org.feePaymentUrl) {
      return (
        <PageBody className="max-w-3xl">
          <PageHeader title={t("title")} />
          <EmptyState icon={<Wallet className="size-5" />} title={tf("parent.empty")} body={tf("parent.emptyBody")} />
        </PageBody>
      );
    }
    return (
      <PageBody className="max-w-3xl">
        <PageHeader title={t("title")} description={t("subtitle")} />
        <FeesCard url={ctx.org.feePaymentUrl} contact={ctx.org.feeContact} school={pick(ctx.locale, ctx.org.nameEn, ctx.org.nameAr)} />
        <p className="text-xs text-muted-foreground">{t("note")}</p>
      </PageBody>
    );
  }
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const cfg = await loadFinanceConfig(ctx.db, ctx.orgId);
  const { available } = onlinePaymentAvailable(cfg.onlinePayments, { isDemo: ctx.org.isDemo });
  const today = new Date(`${todayKey()}T00:00:00+04:00`);
  // An instalment shows its period; a one-off invoice shows what it is for (its first line) instead of a generic label.
  const invoiceTitle = (i: (typeof st.invoices)[number]) => {
    if (i.kind === "PROFORMA") return tf("invoice.proforma");
    const first = i.lines[0] ? pick(L, i.lines[0].descriptionEn, i.lines[0].descriptionAr).split(":")[0] : "";
    return pick(L, i.periodLabelEn, i.periodLabelAr) || first || tf("invoice.taxInvoice");
  };
  const open = st.invoices.filter((i) => (i.kind === "TAX" && (i.status === "OPEN" || i.status === "PARTIAL")) || (i.kind === "PROFORMA" && i.status === "OPEN"));
  const held = st.payments.filter((p) => p.status === "HELD");
  const receipts = st.payments.filter((p) => p.number);
  const overdue = open.filter((i) => i.kind === "TAX" && i.dueDate < today).reduce((s, i) => s + balanceOf(i), 0);

  return (
    <PageBody className="max-w-5xl">
      <PageHeader title={t("title")} description={tf("parent.subtitle", { family: pick(L, st.account.nameEn, st.account.nameAr) })} />
      {st.accounts.length > 1 && (
        <nav className="flex flex-wrap gap-1.5">
          {st.accounts.map((a) => (
            <Link key={a.id} href={`/fees?account=${a.id}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", a.id === st.account.id ? "border-brand bg-brand-soft text-brand" : "bg-card hover:bg-muted")}>
              {pick(L, a.nameEn, a.nameAr)}
            </Link>
          ))}
        </nav>
      )}
      {sp.paid && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft/50 p-4 text-sm" data-testid="paid-banner">
          <CheckCircle2 className="mt-0.5 size-5 text-success" />
          <span>{tf("parent.paidBanner")}</span>
        </div>
      )}
      {sp.cancelled && <div className="rounded-xl border bg-muted/50 p-4 text-sm">{tf("parent.cancelledBanner")}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="sm:col-span-1">
          <div className="text-xs font-medium text-muted-foreground">{tf("parent.balance")}</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight" data-testid="parent-balance">
            <Money fils={Math.max(0, st.balance)} locale={L} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{st.balance < 0 ? tf("parent.inCredit") : st.balance === 0 ? tf("parent.allPaid") : overdue > 0 ? tf("parent.someOverdue") : tf("parent.onTrack")}</div>
          {st.balance < 0 && <Money fils={-st.balance} locale={L} className="text-sm font-medium text-success" />}
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CalendarClock className="size-4" />
            {tf("parent.nextDue")}
          </div>
          {st.nextDue ? (
            <>
              <div className="mt-1 text-xl font-semibold">
                <Money fils={balanceOf(st.nextDue)} locale={L} />
              </div>
              <div className={cn("text-xs", st.nextDue.dueDate < today ? "text-danger" : "text-muted-foreground")}>{st.nextDue.dueDate < today ? tf("parent.wasDue", { date: fmtDate(prefs, st.nextDue.dueDate) }) : tf("parent.dueOn", { date: fmtDate(prefs, st.nextDue.dueDate) })}</div>
            </>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">{tf("parent.nothingDue")}</div>
          )}
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CreditCard className="size-4" />
            {tf("parent.howToPay")}
          </div>
          {available ? (
            <p className="mt-1 text-sm">{tf("parent.payOnlineHint")}</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground" data-testid="online-not-set-up">
              {tf("parent.onlineNotSetUp")}
            </p>
          )}
          {cfg.bankDetailsEn && <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{pick(L, cfg.bankDetailsEn, cfg.bankDetailsAr)}</p>}
          {ctx.org.feeContact && <p className="mt-2 text-xs text-muted-foreground">{t("contact", { contact: ctx.org.feeContact })}</p>}
        </Panel>
      </div>

      {open.length > 0 && (
        <Panel padded={false}>
          <div className="p-5 pb-3">
            <PanelHeader title={tf("parent.toPay")} />
          </div>
          <ul className="divide-y" data-testid="parent-open">
            {open.map((i) => (
              <li key={i.id} className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between", sp.invoice === i.id && "bg-brand-soft/40")}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{invoiceTitle(i)}</span>
                    <InvoiceStatus status={i.status} kind={i.kind} overdue={i.kind === "TAX" && i.dueDate < today} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <bdi>{i.number}</bdi> · {tf("parent.dueOn", { date: fmtDate(prefs, i.dueDate) })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-end">
                    <Money fils={i.kind === "TAX" ? balanceOf(i) : i.totalFils} locale={L} className="text-lg font-semibold" />
                    {i.kind === "TAX" && i.paidFils + i.creditedFils > 0 && <div className="text-xs text-muted-foreground">{tf("parent.ofTotal")} <Money fils={i.totalFils} locale={L} /></div>}
                  </div>
                  <a href={`/api/fees/invoices/${i.id}/pdf`} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline" data-testid="parent-invoice-pdf">
                    <Download className="size-4" />
                    {tf("parent.pdf")}
                  </a>
                  {available && <PayButton invoiceId={i.id} label={tf("parent.pay")} />}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {held.length > 0 && (
        <Panel>
          <PanelHeader title={tf("parent.chequesTitle")} description={tf("parent.chequesBody")} />
          <ul className="space-y-2 text-sm">
            {held.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{tf("parent.cheque", { no: p.chequeNumber ?? "", date: fmtDate(prefs, p.chequeDate) })}</span>
                <span className="flex items-center gap-2">
                  <PaymentStatus status={p.status} />
                  <Money fils={p.amountFils} locale={L} className="font-medium" />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <PanelHeader title={tf("parent.childrenTitle")} description={tf("parent.childrenBody")} />
        <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
          {st.perChild.map((c) => (
            <div key={c.student.id} className="rounded-lg border p-4" data-testid="child-statement">
              <div className="font-medium">{personName(c.student, L)}</div>
              <div className="text-xs text-muted-foreground">{tg("gradeLevel.label", gradeLevelValues(c.student.gradeLevel))}</div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{tf("parent.billed")}</dt>
                <dd className="text-end"><Money fils={c.billed} locale={L} /></dd>
                {c.discounts > 0 && (
                  <>
                    <dt className="text-muted-foreground">{tf("parent.discounts")}</dt>
                    <dd className="text-end text-success">{c.discounts ? "-" : ""}<Money fils={c.discounts} locale={L} /></dd>
                  </>
                )}
                <dt className="font-medium">{tf("parent.outstanding")}</dt>
                <dd className="text-end font-medium"><Money fils={c.outstanding} locale={L} /></dd>
              </dl>
              {c.lines.length > 0 && (
                <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
                  {c.lines.slice(0, 6).map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <span className="min-w-0">{pick(L, l.descriptionEn, l.descriptionAr).split(":")[0]}</span>
                      <Money fils={l.totalFils} locale={L} className="shrink-0" />
                    </li>
                  ))}
                  {c.lines.length > 6 && <li className="pt-1">{tf("parent.moreLines", { n: c.lines.length - 6 })}</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel padded={false}>
          <div className="p-5 pb-3">
            <PanelHeader title={tf("parent.invoicesTitle")} icon={<FileText className="size-4" />} />
          </div>
          <ul className="divide-y" data-testid="parent-invoices">
            {st.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{invoiceTitle(i)}</div>
                  <div className="text-xs text-muted-foreground">
                    <bdi>{i.number}</bdi> · {fmtDate(prefs, i.issueDate)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <InvoiceStatus status={i.status} kind={i.kind} overdue={i.kind === "TAX" && i.dueDate < today} />
                  <a href={`/api/fees/invoices/${i.id}/pdf`} aria-label={tf("parent.pdf")} className="text-muted-foreground hover:text-foreground">
                    <Download className="size-4" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel padded={false}>
          <div className="p-5 pb-3">
            <PanelHeader title={tf("parent.receiptsTitle")} icon={<Receipt className="size-4" />} />
          </div>
          {receipts.length === 0 && st.creditNotes.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">{tf("parent.noReceipts")}</p>
          ) : (
            <ul className="divide-y" data-testid="parent-receipts">
              {receipts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      <Money fils={p.amountFils} locale={L} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <bdi>{p.number}</bdi> · {tf(`method.${p.method}`)} · {fmtDate(prefs, p.clearedAt ?? p.receivedAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.status === "BOUNCED" && <PaymentStatus status={p.status} />}
                    <a href={`/api/fees/receipts/${p.id}/pdf`} aria-label={tf("parent.pdf")} className="text-muted-foreground hover:text-foreground" data-testid="parent-receipt-pdf">
                      <Download className="size-4" />
                    </a>
                  </div>
                </li>
              ))}
              {st.creditNotes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {tf("parent.creditNote")} · <Money fils={c.totalFils} locale={L} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      <bdi>{c.number}</bdi> · {pick(L, c.reasonEn, c.reasonAr)}
                    </div>
                  </div>
                  <a href={`/api/fees/credit-notes/${c.id}/pdf`} aria-label={tf("parent.pdf")} className="shrink-0 text-muted-foreground hover:text-foreground">
                    <Download className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {tf("parent.footnote")}
      </p>
    </PageBody>
  );
}
