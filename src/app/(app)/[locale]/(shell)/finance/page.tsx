import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, Banknote, CalendarClock, FileText, Landmark, Scale, Stamp, Wallet } from "lucide-react";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { pick } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { FinanceTabs, Money, PaymentStatus, RunStatus } from "@/components/fees/shared";
import { BarList, PairBars } from "@/components/fees/bars";
import { SyncAccountsButton } from "@/components/fees/setup-dialogs";
import { canFinance, todayKey, yearContext } from "@/server/fees/queries";
import { agingTotals, billedVsCollected, headline } from "@/server/fees/reports";
import { loadFinanceConfig, taxInvoiceBlockers } from "@/server/fees/config";
import { formatAed } from "@/server/fees/money";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("title") };
}

export default async function FinanceOverview() {
  const ctx = await getCtx();
  if (!canFinance(ctx)) notFound();
  const t = await getTranslations("finance");
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const { year } = await yearContext(ctx);
  const today = todayKey();
  const from = year ? new Date(year.startsOn.getTime() + 4 * 3_600_000).toISOString().slice(0, 10) : today;
  const sixAgo = new Date(Date.now() - 150 * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10);
  const [cfg, accounts, items, h, aging, months, recent, runs] = await Promise.all([
    loadFinanceConfig(ctx.db, ctx.orgId),
    ctx.db.feeAccount.count(),
    year ? ctx.db.feeItem.count({ where: { academicYearId: year.id } }) : Promise.resolve(0),
    tenantTx(ctx.orgId, (tx) => headline(tx, ctx.orgId, { from, to: today })),
    tenantTx(ctx.orgId, (tx) => agingTotals(tx, ctx.orgId, today)),
    tenantTx(ctx.orgId, (tx) => billedVsCollected(tx, ctx.orgId, { from: sixAgo < from ? from : sixAgo, to: today })),
    ctx.db.feePayment.findMany({ orderBy: [{ createdAt: "desc" }], take: 6 }),
    ctx.db.billingRun.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
  ]);
  const recentAccounts = await ctx.db.feeAccount.findMany({ where: { id: { in: recent.map((r) => r.accountId) } }, select: { id: true, nameEn: true, nameAr: true } });
  const outstanding = aging.current + aging.d0_30 + aging.d31_60 + aging.d61_90 + aging.d90p;
  const overdue = outstanding - aging.current;
  const net = h.billed - h.credited;
  const rate = net > 0 ? Math.round((h.collected / net) * 100) : 0;
  const blockers = taxInvoiceBlockers(cfg);
  const fresh = accounts === 0 || items === 0;

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={year ? t("subtitleYear", { year: pick(L, year.nameEn, year.nameAr) }) : t("subtitle")}
        actions={
          ctx.can("fees.reports") ? (
            <Button asChild variant="outline">
              <Link href="/finance/reports">
                <Scale className="size-4" />
                {t("tabs.reports")}
              </Link>
            </Button>
          ) : null
        }
      />
      <FinanceTabs active="overview" can={ctx.can} />

      {blockers.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft/50 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="tax-setup-banner">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <div className="text-sm font-medium">{t("overview.taxSetupTitle")}</div>
              <p className="text-sm text-muted-foreground">{t("overview.taxSetupBody", { missing: blockers.map((b) => t(`overview.blocker.${b}`)).join(", ") })}</p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/finance/setup?tab=school">{t("overview.taxSetupAction")}</Link>
          </Button>
        </div>
      )}

      {fresh ? (
        <Panel>
          <PanelHeader title={t("overview.startTitle")} description={t("overview.startBody")} />
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              { n: 1, title: t("overview.step1"), body: t("overview.step1Body"), href: "/finance/setup?tab=school", done: blockers.length === 0 },
              { n: 2, title: t("overview.step2"), body: t("overview.step2Body"), href: "/finance/setup", done: items > 0 },
              { n: 3, title: t("overview.step3"), body: t("overview.step3Body"), href: "/finance/accounts", done: accounts > 0 },
            ].map((s) => (
              <li key={s.n} className="rounded-lg border p-4">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <span className={s.done ? "grid size-6 place-items-center rounded-full bg-success text-xs text-white" : "grid size-6 place-items-center rounded-full bg-brand-soft text-xs text-brand"}>{s.n}</span>
                  {s.title}
                </div>
                <p className="mb-3 text-sm text-muted-foreground">{s.body}</p>
                {s.n === 3 && ctx.can("fees.manage") ? (
                  <SyncAccountsButton />
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <Link href={s.href}>{t("overview.open")}</Link>
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("overview.billed")} value={<Money fils={net} locale={L} />} hint={t("overview.billedHint")} icon={<FileText className="size-5" />} testId="stat-billed" />
        <StatCard label={t("overview.collected")} value={<Money fils={h.collected} locale={L} />} hint={t("overview.collectionRate", { pct: rate })} icon={<Banknote className="size-5" />} tone="success" testId="stat-collected" />
        <StatCard label={t("overview.outstanding")} value={<Money fils={outstanding} locale={L} />} hint={t("overview.families", { n: aging.owingFamilies })} icon={<Wallet className="size-5" />} tone="info" href="/finance/accounts?filter=owing" testId="stat-outstanding" />
        <StatCard label={t("overview.overdue")} value={<Money fils={overdue} locale={L} />} hint={t("overview.families", { n: aging.overdueFamilies })} icon={<AlertTriangle className="size-5" />} tone={overdue ? "danger" : "success"} href="/finance/accounts?filter=overdue" testId="stat-overdue" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("overview.agingTitle")} description={t("overview.agingBody")} action={ctx.can("fees.reports") ? <Link href="/finance/reports?tab=aging" className="text-sm font-medium text-brand">{t("overview.viewAll")}</Link> : undefined} />
          {outstanding === 0 ? (
            <p className="text-sm text-muted-foreground">{t("overview.nothingOwed")}</p>
          ) : (
            <BarList
              testId="aging-bars"
              rows={[
                { key: "current", label: t("aging.current"), value: aging.current, display: formatAed(aging.current, L), tone: "brand" as const },
                { key: "d0_30", label: t("aging.d0_30"), value: aging.d0_30, display: formatAed(aging.d0_30, L), tone: "warning" as const },
                { key: "d31_60", label: t("aging.d31_60"), value: aging.d31_60, display: formatAed(aging.d31_60, L), tone: "warning" as const },
                { key: "d61_90", label: t("aging.d61_90"), value: aging.d61_90, display: formatAed(aging.d61_90, L), tone: "danger" as const },
                { key: "d90p", label: t("aging.d90p"), value: aging.d90p, display: formatAed(aging.d90p, L), tone: "danger" as const },
              ]}
            />
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("overview.toDo")} />
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/finance/payments?tab=held" className="flex items-center justify-between gap-2 rounded-lg border p-3 hover:bg-muted/50" data-testid="todo-cheques">
                <span className="flex items-center gap-2">
                  <CalendarClock className="size-4 text-muted-foreground" />
                  {t("overview.heldCheques", { n: h.heldCount })}
                </span>
                <Money fils={h.held} locale={L} className="text-muted-foreground" />
              </Link>
            </li>
            {ctx.can("fees.refund.approve") && (
              <li>
                <Link href="/finance/approvals" className="flex items-center justify-between gap-2 rounded-lg border p-3 hover:bg-muted/50">
                  <span className="flex items-center gap-2">
                    <Stamp className="size-4 text-muted-foreground" />
                    {t("overview.approvals", { n: h.approvals })}
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground rtl:rotate-180" />
                </Link>
              </li>
            )}
            <li>
              <Link href="/finance/accounts?filter=credit" className="flex items-center justify-between gap-2 rounded-lg border p-3 hover:bg-muted/50">
                <span className="flex items-center gap-2">
                  <Landmark className="size-4 text-muted-foreground" />
                  {t("overview.creditBalances")}
                </span>
                <ArrowRight className="size-4 text-muted-foreground rtl:rotate-180" />
              </Link>
            </li>
          </ul>
          {runs.length > 0 && (
            <div className="mt-5 space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("overview.recentRuns")}</h3>
              {runs.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="tabular-nums text-muted-foreground">{fmtDate(prefs, r.createdAt)}</span>
                  <span className="tabular-nums">{t("overview.runInvoices", { n: r.invoicesCreated })}</span>
                  <RunStatus status={r.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("overview.monthsTitle")} description={t("overview.monthsBody")} />
          {months.every((m) => !m.billed && !m.collected) ? (
            <p className="text-sm text-muted-foreground">{t("overview.noActivity")}</p>
          ) : (
            <PairBars
              legend={{ a: t("overview.billedShort"), b: t("overview.collectedShort") }}
              rows={months.map((m) => ({
                key: m.month,
                label: new Intl.DateTimeFormat(L === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`)),
                a: m.billed - m.credited,
                b: m.collected,
                aText: formatAed(m.billed - m.credited, L),
                bText: formatAed(m.collected, L),
              }))}
            />
          )}
        </Panel>
        <Panel padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader title={t("overview.recentPayments")} action={<Link href="/finance/payments" className="text-sm font-medium text-brand">{t("overview.viewAll")}</Link>} />
          </div>
          {recent.length === 0 ? (
            <div className="p-5 pt-0">
              <EmptyState icon={<Banknote className="size-5" />} title={t("payments.empty")} body={t("payments.emptyBody")} />
            </div>
          ) : (
            <ul className="divide-y">
              {recent.map((p) => {
                const a = recentAccounts.find((x) => x.id === p.accountId);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/finance/accounts/${p.accountId}`} className="block truncate font-medium hover:underline">
                        {a ? pick(L, a.nameEn, a.nameAr) : ""}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {t(`method.${p.method}`)} · {fmtDate(prefs, p.receivedAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <PaymentStatus status={p.status} />
                      <Money fils={p.amountFils} locale={L} className="font-medium" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </PageBody>
  );
}
