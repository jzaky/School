import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Layers } from "lucide-react";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Progress } from "@/components/ui/progress";
import { Link } from "@/i18n/navigation";
import { pick } from "@/lib/i18n-data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { FinanceTabs, Money, Pager, RunStatus } from "@/components/fees/shared";
import { CancelRunButton, NewRunDialog, RunAutoRefresh } from "@/components/fees/payment-actions";
import { dayInput } from "@/server/fees/money";
import { canFinance, PAGE_SIZE, yearContext } from "@/server/fees/queries";
import { loadFinanceConfig, taxInvoiceBlockers } from "@/server/fees/config";
import { accountsForPlanWhere } from "@/server/fees/billing";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("billing.title") };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx) || !ctx.can("fees.manage")) notFound();
  const t = await getTranslations("finance");
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { year, plans } = await yearContext(ctx);
  const [cfg, runs, total, items] = await Promise.all([
    loadFinanceConfig(ctx.db, ctx.orgId),
    ctx.db.billingRun.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ctx.db.billingRun.count(),
    year ? ctx.db.feeItem.count({ where: { academicYearId: year.id, autoBill: true, active: true } }) : Promise.resolve(0),
  ]);
  const billedParts = new Set((await ctx.db.billingRun.findMany({ where: { status: "COMPLETED" }, select: { partId: true } })).map((r) => r.partId));
  const parts = await Promise.all(
    plans
      .filter((p) => p.active)
      .flatMap((p) =>
        p.parts.map(async (x) => ({
          id: x.id,
          label: `${pick(L, p.nameEn, p.nameAr)}: ${pick(L, x.labelEn, x.labelAr)}`,
          due: dayInput(x.dueDate),
          families: await ctx.db.feeAccount.count({ where: accountsForPlanWhere(ctx.orgId, p) }),
          billed: billedParts.has(x.id),
        })),
      ),
  );
  const blockers = taxInvoiceBlockers(cfg);
  const blocked = blockers.length ? t("billing.blockedTax") : items === 0 ? t("billing.blockedItems") : null;
  const partLabel = (id: string) => parts.find((p) => p.id === id)?.label ?? "";
  const active = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");

  return (
    <PageBody>
      <RunAutoRefresh active={active} />
      <PageHeader title={t("billing.title")} description={t("billing.subtitle")} actions={<NewRunDialog parts={parts} blocked={blocked} />} />
      <FinanceTabs active="billing" can={ctx.can} />
      {blocked && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-sm" data-testid="billing-blocked">
          {blocked}{" "}
          <Link href={blockers.length ? "/finance/setup?tab=school" : "/finance/setup"} className="font-medium text-brand hover:underline">
            {t("billing.fixIt")}
          </Link>
        </p>
      )}
      <Panel>
        <PanelHeader title={t("billing.howTitle")} description={t("billing.howBody")} />
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded-lg border p-3 text-sm">
              <div className="font-medium">
                {pick(L, p.nameEn, p.nameAr)}
                {p.isDefault ? <span className="ms-2 text-xs text-muted-foreground">{t("billing.default")}</span> : null}
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {p.parts.map((x) => (
                  <li key={x.id} className="flex justify-between gap-2">
                    <span>{pick(L, x.labelEn, x.labelAr)}</span>
                    <span className={billedParts.has(x.id) ? "text-success" : ""}>{billedParts.has(x.id) ? t("billing.billed") : t("billing.dueShort", { date: fmtDate(prefs, x.dueDate) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!plans.length && <p className="text-sm text-muted-foreground">{t("billing.noPlans")}</p>}
        </div>
      </Panel>
      <Panel padded={false}>
        <div className="p-5 pb-3">
          <PanelHeader title={t("billing.runs")} />
        </div>
        {runs.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState icon={<Layers className="size-5" />} title={t("billing.noRuns")} body={t("billing.noRunsBody")} />
          </div>
        ) : (
          <>
            <ul className="divide-y" data-testid="run-list">
              {runs.map((r) => {
                const pct = r.totalAccounts ? Math.round((r.processed / r.totalAccounts) * 100) : 0;
                return (
                  <li key={r.id} className="space-y-2 px-5 py-4 text-sm" data-testid="run-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{partLabel(r.partId) || t("billing.instalment")}</div>
                        <div className="text-xs text-muted-foreground">{t("billing.runMeta", { started: fmtDateTime(prefs, r.createdAt), due: fmtDate(prefs, r.dueDate) })}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <RunStatus status={r.status} />
                        {(r.status === "RUNNING" || r.status === "QUEUED") && <CancelRunButton runId={r.id} />}
                      </div>
                    </div>
                    <Progress value={r.status === "COMPLETED" ? 100 : pct} className="h-1.5" />
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>{t("billing.progress", { done: r.processed, total: r.totalAccounts })}</span>
                      <span>{t("billing.created", { n: r.invoicesCreated })}</span>
                      {r.skipped > 0 && <span>{t("billing.skipped", { n: r.skipped })}</span>}
                      <span>
                        {t("billing.totalBilled")} <Money fils={r.totalFils} locale={L} className="font-medium text-foreground" />
                      </span>
                      {r.status === "COMPLETED" && (
                        <Link href={`/finance/invoices?run=${r.id}`} className="text-brand hover:underline">
                          {t("billing.viewInvoices")}
                        </Link>
                      )}
                      {r.error && r.status !== "COMPLETED" && <span className="text-danger">{t("billing.retrying")}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager page={page} total={total} pageSize={PAGE_SIZE} href={(p) => `/finance/billing${p > 1 ? `?page=${p}` : ""}`} />
          </>
        )}
      </Panel>
    </PageBody>
  );
}
