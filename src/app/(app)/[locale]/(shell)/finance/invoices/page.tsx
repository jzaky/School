import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Link } from "@/i18n/navigation";
import { pick } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { FinanceTabs, InvoiceStatus, Money, Pager, qs } from "@/components/fees/shared";
import { canFinance, listInvoices, PAGE_SIZE, todayKey, type InvoiceFilter } from "@/server/fees/queries";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("invoices.title") };
}

const FILTERS: InvoiceFilter[] = ["all", "open", "overdue", "paid", "credited", "proforma"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string; run?: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx)) notFound();
  const t = await getTranslations("finance");
  const prefs = await formatPrefs(ctx);
  const sp = await searchParams;
  const filter = (FILTERS as string[]).includes(sp.filter ?? "") ? (sp.filter as InvoiceFilter) : "all";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const run = sp.run && /^[a-z0-9]{10,40}$/i.test(sp.run) ? sp.run : undefined;
  const { rows, total } = await listInvoices(ctx, { filter, q: sp.q ?? "", page, extra: run ? { billingRunId: run } : undefined });
  const today = new Date(`${todayKey()}T00:00:00+04:00`);
  const L = ctx.locale;
  const base = { q: sp.q, filter: filter === "all" ? undefined : filter, run };
  return (
    <PageBody>
      <PageHeader title={t("invoices.title")} description={t("invoices.subtitle")} />
      <FinanceTabs active="invoices" can={ctx.can} />
      <FilterBar tabParam="filter" tabs={FILTERS.map((f) => ({ value: f, label: t(`invoices.filter.${f}`) }))} searchPlaceholder={t("invoices.search")} />
      <Panel padded={false}>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<FileText className="size-5" />} title={t("invoices.empty")} body={filter === "all" && !sp.q ? t("invoices.emptyBody") : undefined} />
          </div>
        ) : (
          <>
            <div className="hidden grid-cols-[9rem_1fr_7rem_7rem_8rem_8rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid">
              <span>{t("invoices.number")}</span>
              <span>{t("invoices.billTo")}</span>
              <span>{t("invoices.issued")}</span>
              <span>{t("invoices.due")}</span>
              <span className="text-end">{t("invoices.total")}</span>
              <span className="text-end">{t("invoices.balance")}</span>
            </div>
            <ul className="divide-y" data-testid="invoice-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/finance/invoices/${r.id}`} className="grid gap-1 px-4 py-3 text-sm hover:bg-muted/40 lg:grid-cols-[9rem_1fr_7rem_7rem_8rem_8rem] lg:items-center lg:gap-3">
                    <span className="flex items-center justify-between gap-2 font-medium lg:block">
                      <bdi>{r.number}</bdi>
                      <span className="lg:hidden">
                        <InvoiceStatus status={r.status} kind={r.kind} overdue={r.dueDate < today} />
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{pick(L, r.billToName, r.billToNameAr)}</span>
                      <span className="hidden text-xs text-muted-foreground lg:block">
                        <InvoiceStatus status={r.status} kind={r.kind} overdue={r.dueDate < today} />
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground lg:text-sm">{fmtDate(prefs, r.issueDate)}</span>
                    <span className={r.dueDate < today && r.balanceFils > 0 && r.kind === "TAX" ? "text-xs text-danger lg:text-sm" : "text-xs text-muted-foreground lg:text-sm"}>{t("invoices.dueShort", { date: fmtDate(prefs, r.dueDate) })}</span>
                    <span className="lg:text-end">
                      <Money fils={r.totalFils} locale={L} />
                    </span>
                    <span className="font-medium lg:text-end">{r.kind === "TAX" ? <Money fils={r.balanceFils} locale={L} /> : <span className="text-muted-foreground">-</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager page={page} total={total} pageSize={PAGE_SIZE} href={(p) => `/finance/invoices${qs(base, { page: p > 1 ? p : undefined })}`} />
          </>
        )}
      </Panel>
    </PageBody>
  );
}
