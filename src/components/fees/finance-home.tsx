import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, CalendarClock, FileText, Layers, Scale, Users, Wallet } from "lucide-react";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { tenantTx } from "@/lib/tenant-db";
import { Link } from "@/i18n/navigation";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { Greeting, RequestsPanel, TasksPanel } from "@/components/dashboard/widgets";
import { Money } from "./shared";
import { agingTotals } from "@/server/fees/reports";
import { todayKey } from "@/server/fees/queries";

/** Home for the finance office: what is owed, what is overdue, cheques to bank, and the main finance tasks. */
export async function FinanceHome({ ctx, prefs }: { ctx: Ctx; prefs: FormatPrefs }) {
  const t = await getTranslations("finance.home");
  const today = todayKey();
  const [aging, held, chequesDue, accounts] = await Promise.all([
    tenantTx(ctx.orgId, (tx) => agingTotals(tx, ctx.orgId, today)),
    ctx.db.feePayment.aggregate({ where: { status: "HELD" }, _sum: { amountFils: true }, _count: true }),
    ctx.db.feePayment.count({ where: { status: "HELD", chequeDate: { lte: new Date(`${today}T23:59:59+04:00`) } } }),
    ctx.db.feeAccount.count(),
  ]);
  const outstanding = aging.current + aging.d0_30 + aging.d31_60 + aging.d61_90 + aging.d90p;
  const overdue = outstanding - aging.current;
  const links = [
    { href: "/finance/accounts", icon: <Users className="size-4" />, label: t("linkAccounts") },
    { href: "/finance/billing", icon: <Layers className="size-4" />, label: t("linkBilling") },
    { href: "/finance/invoices?filter=overdue", icon: <FileText className="size-4" />, label: t("linkOverdue") },
    { href: "/finance/reports", icon: <Scale className="size-4" />, label: t("linkReports") },
  ];
  return (
    <PageBody>
      <Greeting ctx={ctx} prefs={prefs} subtitle={t("subtitle")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("outstanding")} value={<Money fils={outstanding} locale={ctx.locale} />} hint={t("families", { n: aging.owingFamilies, total: accounts })} icon={<Wallet className="size-5" />} tone="info" href="/finance/accounts?filter=owing" testId="fh-outstanding" />
        <StatCard label={t("overdue")} value={<Money fils={overdue} locale={ctx.locale} />} hint={t("overdueFamilies", { n: aging.overdueFamilies })} icon={<AlertTriangle className="size-5" />} tone={overdue ? "danger" : "success"} href="/finance/reports?tab=aging" testId="fh-overdue" />
        <StatCard label={t("held")} value={<Money fils={held._sum.amountFils ?? 0} locale={ctx.locale} />} hint={t("heldCount", { n: held._count })} icon={<CalendarClock className="size-5" />} tone="gold" href="/finance/payments?tab=held" testId="fh-held" />
        <StatCard label={t("chequesDue")} value={chequesDue} hint={t("chequesDueHint")} icon={<CalendarClock className="size-5" />} tone={chequesDue ? "warning" : "success"} href="/finance/payments?tab=held" testId="fh-cheques-due" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("quick")} />
            <div className="grid gap-2 sm:grid-cols-2">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{l.icon}</span>
                    {l.label}
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground rtl:rotate-180" />
                </Link>
              ))}
            </div>
          </Panel>
          <RequestsPanel ctx={ctx} prefs={prefs} limit={4} />
        </div>
        <TasksPanel ctx={ctx} prefs={prefs} />
      </div>
    </PageBody>
  );
}
