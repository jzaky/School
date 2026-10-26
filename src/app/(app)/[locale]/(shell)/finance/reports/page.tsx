import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FileSpreadsheet, FileText } from "lucide-react";
import { getCtx } from "@/server/context";
import { tenantTx } from "@/lib/tenant-db";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { pick } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { formatPrefs } from "@/server/format";
import { FinanceTabs, Money, Pager, qs } from "@/components/fees/shared";
import { PeriodPicker } from "@/components/fees/report-controls";
import { canFinance, PAGE_SIZE, todayKey, yearContext } from "@/server/fees/queries";
import { agingByFamily, agingTotals, billedVsCollected, cashBook, discountsGiven, outstandingByGrade, vatSummary } from "@/server/fees/reports";
import type { ExportKind } from "@/server/fees/exports";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("reports.title") };
}

const TABS = ["summary", "aging", "outstanding", "vat", "discounts", "cashbook", "exports"] as const;
type Tab = (typeof TABS)[number];
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function quarter(d: Date, back: number) {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) - back;
  const start = new Date(Date.UTC(y, q * 3, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function ExportButtons({ kind, from, to, label }: { kind: ExportKind; from: string; to: string; label: { csv: string; xlsx: string } }) {
  const q = `report=${kind}&from=${from}&to=${to}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={`/api/fees/export?${q}&format=csv`} data-testid={`export-${kind}-csv`}>
          <FileText className="size-4" />
          {label.csv}
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`/api/fees/export?${q}&format=xlsx`} data-testid={`export-${kind}-xlsx`}>
          <FileSpreadsheet className="size-4" />
          {label.xlsx}
        </a>
      </Button>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; page?: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx) || !ctx.can("fees.reports")) notFound();
  const t = await getTranslations("finance");
  const tg = await getTranslations();
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "summary";
  const today = todayKey();
  const { year } = await yearContext(ctx);
  // The academic year's finance period starts with its first invoice (re-enrollment and Term 1 are billed before
  // the first school day), from the first of that month.
  const firstInvoice = year ? await ctx.db.invoice.findFirst({ where: { academicYearId: year.id }, orderBy: { issueDate: "asc" }, select: { issueDate: true } }) : null;
  const yearStart = year ? (firstInvoice && firstInvoice.issueDate < year.startsOn ? firstInvoice.issueDate : year.startsOn) : null;
  const yearFrom = yearStart ? new Date(yearStart.getTime() + 4 * 3_600_000).toISOString().slice(0, 8) + "01" : today.slice(0, 8) + "01";
  const from = KEY_RE.test(sp.from ?? "") ? sp.from! : yearFrom;
  const to = KEY_RE.test(sp.to ?? "") && sp.to! >= from ? sp.to! : today;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const now = new Date(`${today}T00:00:00Z`);
  const monthStart = today.slice(0, 8) + "01";
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const lastMonthStart = lastMonthEnd.slice(0, 8) + "01";
  const presets = [
    { label: t("reports.preset.year"), from: yearFrom, to: today },
    { label: t("reports.preset.month"), from: monthStart, to: today },
    { label: t("reports.preset.lastMonth"), from: lastMonthStart, to: lastMonthEnd },
    { label: t("reports.preset.quarter"), ...quarter(now, 0) },
    { label: t("reports.preset.lastQuarter"), ...quarter(now, 1) },
  ];
  const exportLabel = { csv: t("reports.csv"), xlsx: t("reports.xlsx") };
  const tabHref = (k: Tab) => `/finance/reports${qs({ from: sp.from, to: sp.to }, { tab: k === "summary" ? undefined : k })}`;
  const run = <T,>(fn: Parameters<typeof tenantTx<T>>[1]) => tenantTx(ctx.orgId, fn, { timeout: 60_000 });
  const th = "px-4 py-2 text-start font-medium";
  const thE = "px-4 py-2 text-end font-medium";

  let content: React.ReactNode = null;
  if (tab === "summary") {
    const months = await run((tx) => billedVsCollected(tx, ctx.orgId, { from, to }));
    const sum = months.reduce((s, m) => ({ billed: s.billed + m.billed, credited: s.credited + m.credited, collected: s.collected + m.collected, refunded: s.refunded + m.refunded }), { billed: 0, credited: 0, collected: 0, refunded: 0 });
    content = (
      <Panel padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <PanelHeader title={t("reports.summaryTitle")} description={t("reports.summaryBody")} />
          <ExportButtons kind="billed" from={from} to={to} label={exportLabel} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm" data-testid="report-summary">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className={th}>{t("reports.month")}</th>
                <th className={thE}>{t("reports.billed")}</th>
                <th className={thE}>{t("reports.credited")}</th>
                <th className={thE}>{t("reports.collected")}</th>
                <th className={thE}>{t("reports.refunded")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {months.map((m) => (
                <tr key={m.month}>
                  <td className="px-4 py-2 tabular-nums">{new Intl.DateTimeFormat(L === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`))}</td>
                  <td className="px-4 py-2 text-end"><Money fils={m.billed} locale={L} /></td>
                  <td className="px-4 py-2 text-end"><Money fils={m.credited} locale={L} /></td>
                  <td className="px-4 py-2 text-end"><Money fils={m.collected} locale={L} /></td>
                  <td className="px-4 py-2 text-end"><Money fils={m.refunded} locale={L} /></td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-semibold">
                <td className="px-4 py-2">{t("reports.total")}</td>
                <td className="px-4 py-2 text-end"><Money fils={sum.billed} locale={L} /></td>
                <td className="px-4 py-2 text-end"><Money fils={sum.credited} locale={L} /></td>
                <td className="px-4 py-2 text-end"><Money fils={sum.collected} locale={L} /></td>
                <td className="px-4 py-2 text-end"><Money fils={sum.refunded} locale={L} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    );
  } else if (tab === "aging") {
    const [totals, fam] = await Promise.all([run((tx) => agingTotals(tx, ctx.orgId, today)), run((tx) => agingByFamily(tx, ctx.orgId, today, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }))]);
    const cols = ["current", "d0_30", "d31_60", "d61_90", "d90p"] as const;
    content = (
      <Panel padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <PanelHeader title={t("reports.agingTitle")} description={t("reports.agingBody", { date: fmtDate(prefs, new Date(`${today}T00:00:00+04:00`)) })} />
          <ExportButtons kind="aging" from={from} to={to} label={exportLabel} />
        </div>
        <div className="grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-5">
          {cols.map((c) => (
            <div key={c} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t(`aging.${c}`)}</div>
              <div className={cn("mt-1 font-semibold", c === "d61_90" || c === "d90p" ? "text-danger" : "")}>
                <Money fils={totals[c]} locale={L} />
              </div>
            </div>
          ))}
        </div>
        {fam.rows.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState title={t("reports.nothingOwed")} />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-sm" data-testid="report-aging">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className={th}>{t("reports.family")}</th>
                    {cols.map((c) => (
                      <th key={c} className={thE}>
                        {t(`aging.${c}`)}
                      </th>
                    ))}
                    <th className={thE}>{t("reports.total")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {fam.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="px-4 py-2">
                        <Link href={`/finance/accounts/${r.accountId}`} className="font-medium hover:underline">
                          {pick(L, r.nameEn, r.nameAr)}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          <bdi>{r.code}</bdi>
                        </div>
                      </td>
                      {cols.map((c) => (
                        <td key={c} className={cn("px-4 py-2 text-end", r[c] && (c === "d61_90" || c === "d90p") ? "text-danger" : "")}>
                          {r[c] ? <Money fils={r[c]} locale={L} /> : <span className="text-muted-foreground">-</span>}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-end font-semibold">
                        <Money fils={r.total} locale={L} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={fam.total} pageSize={PAGE_SIZE} href={(p) => `/finance/reports${qs({ tab: "aging", from: sp.from, to: sp.to }, { page: p > 1 ? p : undefined })}`} />
          </>
        )}
      </Panel>
    );
  } else if (tab === "outstanding") {
    const rows = await run((tx) => outstandingByGrade(tx, ctx.orgId));
    const total = rows.reduce((s, r) => s + r.owed, 0);
    content = (
      <Panel padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <PanelHeader title={t("reports.byGradeTitle")} description={t("reports.byGradeBody")} />
          <ExportButtons kind="by_grade" from={from} to={to} label={exportLabel} />
        </div>
        {rows.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState title={t("reports.nothingOwed")} />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="report-grade">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className={th}>{t("reports.grade")}</th>
                <th className={thE}>{t("reports.students")}</th>
                <th className={thE}>{t("reports.outstanding")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={String(r.grade)}>
                  <td className="px-4 py-2">{r.grade === null ? t("reports.familyCharges") : tg("gradeLevel.label", gradeLevelValues(r.grade))}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{r.grade === null ? "-" : r.students}</td>
                  <td className="px-4 py-2 text-end"><Money fils={r.owed} locale={L} /></td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-semibold">
                <td className="px-4 py-2">{t("reports.total")}</td>
                <td />
                <td className="px-4 py-2 text-end"><Money fils={total} locale={L} /></td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="px-5 py-3 text-xs text-muted-foreground">{t("reports.byFamilyHint")} <Link href="/finance/reports?tab=aging" className="text-brand hover:underline">{t("reports.tab.aging")}</Link></p>
      </Panel>
    );
  } else if (tab === "vat") {
    const v = await run((tx) => vatSummary(tx, ctx.orgId, { from, to }));
    const net = (rows: typeof v.supplies) => rows.reduce((s, r) => ({ net: s.net + r.net, vat: s.vat + r.vat }), { net: 0, vat: 0 });
    const a = net(v.supplies);
    const b = net(v.adjustments);
    const row = (r: (typeof v.supplies)[number], neg: boolean) => (
      <tr key={`${neg}-${r.treatment}-${r.rateBp}`}>
        <td className="px-4 py-2">
          {t(`vat.${r.treatment}`)}
          {r.rateBp ? ` ${r.rateBp / 100}%` : ""}
        </td>
        <td className="px-4 py-2 text-end tabular-nums">{r.documents}</td>
        <td className="px-4 py-2 text-end"><Money fils={neg ? -r.net : r.net} locale={L} /></td>
        <td className="px-4 py-2 text-end"><Money fils={neg ? -r.vat : r.vat} locale={L} /></td>
      </tr>
    );
    content = (
      <Panel padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <PanelHeader title={t("reports.vatTitle")} description={t("reports.vatBody")} />
          <ExportButtons kind="vat" from={from} to={to} label={exportLabel} />
        </div>
        <table className="w-full text-sm" data-testid="report-vat">
          <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={th}>{t("reports.treatment")}</th>
              <th className={thE}>{t("reports.documents")}</th>
              <th className={thE}>{t("reports.taxable")}</th>
              <th className={thE}>{t("reports.vat")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-muted/20">
              <td colSpan={4} className="px-4 py-1.5 text-xs font-medium text-muted-foreground">{t("reports.supplies")}</td>
            </tr>
            {v.supplies.map((r) => row(r, false))}
            {v.adjustments.length > 0 && (
              <tr className="bg-muted/20">
                <td colSpan={4} className="px-4 py-1.5 text-xs font-medium text-muted-foreground">{t("reports.adjustments")}</td>
              </tr>
            )}
            {v.adjustments.map((r) => row(r, true))}
            <tr className="bg-muted/30 font-semibold">
              <td className="px-4 py-2">{t("reports.netForPeriod")}</td>
              <td />
              <td className="px-4 py-2 text-end"><Money fils={a.net - b.net} locale={L} /></td>
              <td className="px-4 py-2 text-end" data-testid="vat-due"><Money fils={a.vat - b.vat} locale={L} /></td>
            </tr>
          </tbody>
        </table>
        <p className="px-5 py-3 text-xs text-muted-foreground">{t("reports.vatNote")}</p>
      </Panel>
    );
  } else if (tab === "discounts") {
    const rows = await run((tx) => discountsGiven(tx, ctx.orgId, { from, to }));
    content = (
      <Panel padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <PanelHeader title={t("reports.discountsTitle")} description={t("reports.discountsBody")} />
          <ExportButtons kind="discounts" from={from} to={to} label={exportLabel} />
        </div>
        {rows.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState title={t("reports.noDiscounts")} />
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="report-discounts">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className={th}>{t("reports.discount")}</th>
                <th className={thE}>{t("reports.lines")}</th>
                <th className={thE}>{t("reports.amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.kind}>
                  <td className="px-4 py-2">{t(`discountKind.${r.kind}`)}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{r.lines}</td>
                  <td className="px-4 py-2 text-end"><Money fils={r.amount} locale={L} /></td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-semibold">
                <td className="px-4 py-2">{t("reports.total")}</td>
                <td />
                <td className="px-4 py-2 text-end"><Money fils={rows.reduce((s, r) => s + r.amount, 0)} locale={L} /></td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>
    );
  } else if (tab === "cashbook") {
    const c = await run((tx) => cashBook(tx, ctx.orgId, { from, to }, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }));
    content = (
      <Panel padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <PanelHeader title={t("reports.cashTitle")} description={t("reports.cashBody")} />
          <ExportButtons kind="cashbook" from={from} to={to} label={exportLabel} />
        </div>
        <div className="grid grid-cols-3 gap-3 px-5 pb-4">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{t("reports.opening")}</div>
            <Money fils={c.opening} locale={L} className="font-semibold" />
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{t("reports.in")}</div>
            <Money fils={c.totals.in} locale={L} className="font-semibold text-success" />
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{t("reports.out")}</div>
            <Money fils={c.totals.out} locale={L} className="font-semibold" />
          </div>
        </div>
        {c.rows.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState title={t("reports.noCash")} />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm" data-testid="report-cash">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className={th}>{t("reports.date")}</th>
                    <th className={th}>{t("reports.document")}</th>
                    <th className={th}>{t("reports.family")}</th>
                    <th className={thE}>{t("reports.in")}</th>
                    <th className={thE}>{t("reports.out")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {c.rows.map((r, i) => (
                    <tr key={`${r.number}-${i}`}>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">{fmtDate(prefs, r.at)}</td>
                      <td className="px-4 py-2">
                        {t(`reports.cashKind.${r.kind}`)} <bdi className="text-muted-foreground">{r.number}</bdi>
                        <div className="text-xs text-muted-foreground">{r.method ? t(`method.${r.method}`) : ""}{r.reference ? ` · ${r.reference}` : ""}</div>
                      </td>
                      <td className="px-4 py-2">{pick(L, r.nameEn, r.nameAr)}</td>
                      <td className="px-4 py-2 text-end">{r.direction === "IN" ? <Money fils={r.amount} locale={L} /> : ""}</td>
                      <td className="px-4 py-2 text-end">{r.direction === "OUT" ? <Money fils={r.amount} locale={L} /> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={c.total} pageSize={PAGE_SIZE} href={(p) => `/finance/reports${qs({ tab: "cashbook", from: sp.from, to: sp.to }, { page: p > 1 ? p : undefined })}`} />
          </>
        )}
      </Panel>
    );
  } else {
    const kinds: ExportKind[] = ["invoices", "lines", "payments", "credit_notes", "journal", "vat", "aging", "cashbook", "discounts", "billed", "by_grade"];
    content = (
      <Panel>
        <PanelHeader title={t("reports.exportsTitle")} description={t("reports.exportsBody")} />
        <ul className="divide-y" data-testid="exports-list">
          {kinds.map((k) => (
            <li key={k} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="text-sm font-medium">{t(`reports.export.${k}`)}</div>
                <div className="text-xs text-muted-foreground">{t(`reports.exportHint.${k}`)}</div>
              </div>
              <ExportButtons kind={k} from={from} to={to} label={exportLabel} />
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  return (
    <PageBody>
      <PageHeader title={t("reports.title")} description={t("reports.subtitle")} />
      <FinanceTabs active="reports" can={ctx.can} />
      <nav className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 lg:w-fit">
        {TABS.map((k) => (
          <Link key={k} href={tabHref(k)} className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === k ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")} data-testid={`rep-tab-${k}`}>
            {t(`reports.tab.${k}`)}
          </Link>
        ))}
      </nav>
      {tab !== "aging" && tab !== "outstanding" && <PeriodPicker from={from} to={to} presets={presets} />}
      {content}
    </PageBody>
  );
}
