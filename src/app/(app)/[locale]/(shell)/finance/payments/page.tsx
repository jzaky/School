import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Banknote, Download } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Link } from "@/i18n/navigation";
import { pick } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { FinanceTabs, Money, Pager, PaymentStatus, qs, RefundStatus } from "@/components/fees/shared";
import { BounceDialog, ClearChequeDialog, RefundPaidDialog } from "@/components/fees/payment-actions";
import { dayInput } from "@/components/fees/form-bits";
import { canFinance, listPayments, PAGE_SIZE, todayKey } from "@/server/fees/queries";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("payments.title") };
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string; page?: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx)) notFound();
  const t = await getTranslations("finance");
  const prefs = await formatPrefs(ctx);
  const sp = await searchParams;
  const tab = sp.tab === "held" || sp.tab === "bounced" || sp.tab === "refunds" ? sp.tab : "all";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const L = ctx.locale;
  const canCollect = ctx.can("fees.collect");
  const today = todayKey();
  const base = { q: sp.q, tab: tab === "all" ? undefined : tab };
  const [heldCount, refundCount] = await Promise.all([ctx.db.feePayment.count({ where: { status: "HELD" } }), ctx.db.feeRefund.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } })]);

  let body: React.ReactNode;
  if (tab === "refunds") {
    const where = {};
    const [rows, total] = await Promise.all([ctx.db.feeRefund.findMany({ where, orderBy: { requestedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }), ctx.db.feeRefund.count({ where })]);
    const accounts = await ctx.db.feeAccount.findMany({ where: { id: { in: rows.map((r) => r.accountId) } }, select: { id: true, nameEn: true, nameAr: true, code: true } });
    body =
      rows.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={<Banknote className="size-5" />} title={t("refund.empty")} />
        </div>
      ) : (
        <>
          <ul className="divide-y" data-testid="refund-list">
            {rows.map((r) => {
              const a = accounts.find((x) => x.id === r.accountId);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/finance/accounts/${r.accountId}`} className="font-medium hover:underline">
                      {a ? pick(L, a.nameEn, a.nameAr) : ""}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(prefs, r.requestedAt)} · {r.reason}
                      {r.number ? ` · ${r.number}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <RefundStatus status={r.status} />
                    <Money fils={r.amountFils} locale={L} className="font-medium" />
                    {r.status === "APPROVED" && canCollect && <RefundPaidDialog refundId={r.id} />}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager page={page} total={total} pageSize={PAGE_SIZE} href={(p) => `/finance/payments${qs(base, { page: p > 1 ? p : undefined })}`} />
        </>
      );
  } else {
    const { rows, total } = await listPayments(ctx, { tab, q: sp.q ?? "", page });
    body =
      rows.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={<Banknote className="size-5" />} title={tab === "held" ? t("payments.noHeld") : t("payments.empty")} body={tab === "all" && !sp.q ? t("payments.emptyBody") : undefined} />
        </div>
      ) : (
        <>
          <ul className="divide-y" data-testid="payment-list">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" data-testid="payment-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/finance/accounts/${p.accountId}`} className="font-medium hover:underline">
                      {p.account ? pick(L, p.account.nameEn, p.account.nameAr) : ""}
                    </Link>
                    <span className="text-xs text-muted-foreground">{p.number ? <bdi>{p.number}</bdi> : t("payments.noReceiptYet")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t(`method.${p.method}`)}
                    {p.provider !== "manual" ? ` (${p.provider})` : ""} · {fmtDate(prefs, p.receivedAt)}
                    {p.method === "CHEQUE" ? ` · ${t("payments.chequeDated", { no: p.chequeNumber ?? "", date: fmtDate(prefs, p.chequeDate) })}` : ""}
                    {p.chequeBank ? ` · ${p.chequeBank}` : ""}
                    {p.reference && p.method !== "CHEQUE" ? ` · ${p.reference}` : ""}
                    {p.status === "HELD" && dayInput(p.chequeDate) <= today ? ` · ${t("payments.dueForDeposit")}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <PaymentStatus status={p.status} />
                  <Money fils={p.amountFils} locale={L} className="font-medium" />
                  {p.status === "HELD" && canCollect && <ClearChequeDialog paymentId={p.id} chequeDate={dayInput(p.chequeDate)} />}
                  {p.method === "CHEQUE" && p.status !== "BOUNCED" && p.refundedFils === 0 && canCollect && <BounceDialog paymentId={p.id} />}
                  {p.number && (
                    <a href={`/api/fees/receipts/${p.id}/pdf`} className="text-muted-foreground hover:text-foreground" aria-label={t("payments.receipt")} data-testid="receipt-pdf">
                      <Download className="size-4" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pager page={page} total={total} pageSize={PAGE_SIZE} href={(p) => `/finance/payments${qs(base, { page: p > 1 ? p : undefined })}`} />
        </>
      );
  }

  return (
    <PageBody>
      <PageHeader title={t("payments.title")} description={t("payments.subtitle")} />
      <FinanceTabs active="payments" can={ctx.can} />
      <FilterBar
        tabs={[
          { value: "all", label: t("payments.tab.all") },
          { value: "held", label: t("payments.tab.held"), count: heldCount },
          { value: "bounced", label: t("payments.tab.bounced") },
          { value: "refunds", label: t("payments.tab.refunds"), count: refundCount },
        ]}
        searchPlaceholder={tab === "refunds" ? undefined : t("payments.search")}
      />
      <Panel padded={false}>{body}</Panel>
    </PageBody>
  );
}
