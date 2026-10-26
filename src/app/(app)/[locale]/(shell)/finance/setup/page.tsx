import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Info, ListChecks } from "lucide-react";
import type { FeeItem } from "@prisma/client";
import { getCtx } from "@/server/context";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { pick } from "@/lib/i18n-data";
import { fmtDate } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { formatPrefs } from "@/server/format";
import { FinanceTabs, Money } from "@/components/fees/shared";
import { CopyScheduleDialog, DeleteItemButton, DiscountDialog, FeeItemDialog, PlanDialog } from "@/components/fees/setup-dialogs";
import { SettingsForm } from "@/components/fees/settings-form";
import { dayInput } from "@/server/fees/money";
import { canFinance, yearContext } from "@/server/fees/queries";
import { loadFinanceConfig } from "@/server/fees/config";
import { previewInstalments } from "@/server/fees/schedule";
import { configuredProvider } from "@/server/payments/providers";

export async function generateMetadata() {
  const t = await getTranslations("finance");
  return { title: t("setup.title") };
}

const TABS = ["items", "plans", "discounts", "school", "rules", "online"] as const;
type Tab = (typeof TABS)[number];
const KIND_ORDER = ["TUITION", "TRANSPORT", "REGISTRATION", "REENROLLMENT", "SEAT_DEPOSIT", "BOOKS", "UNIFORM", "TRIP", "EXAM", "OTHER"];

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ tab?: string; year?: string }> }) {
  const ctx = await getCtx();
  if (!canFinance(ctx)) notFound();
  const t = await getTranslations("finance");
  const tg = await getTranslations();
  const prefs = await formatPrefs(ctx);
  const L = ctx.locale;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "items";
  const canManage = ctx.can("fees.manage");
  const { years, year, plans } = await yearContext(ctx, sp.year);
  const [items, discounts, cfg, billedParts] = await Promise.all([
    year ? ctx.db.feeItem.findMany({ where: { academicYearId: year.id } }) : Promise.resolve([] as FeeItem[]),
    ctx.db.feeDiscount.findMany({ orderBy: { code: "asc" } }),
    loadFinanceConfig(ctx.db, ctx.orgId),
    ctx.db.invoice.findMany({ where: { planPartId: { in: plans.flatMap((p) => p.parts.map((x) => x.id)) } }, select: { planPartId: true }, distinct: ["planPartId"] }),
  ]);
  const billed = new Set(billedParts.map((b) => b.planPartId));
  const sorted = [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.gradeLevels[0] ?? 99) - (b.gradeLevels[0] ?? 99) || a.code.localeCompare(b.code));
  const defaultPlan = plans.find((p) => p.isDefault) ?? plans[0];
  const shares = defaultPlan?.parts.map((p) => p.shareBp) ?? [];
  const provider = configuredProvider();
  const yearHref = (k: Tab) => `/finance/setup?${new URLSearchParams({ ...(k !== "items" ? { tab: k } : {}), ...(sp.year ? { year: sp.year } : {}) }).toString()}`;
  const gradeText = (g: number[]) => (g.length === 0 ? t("setup.allGrades") : g.map((x) => tg("gradeLevel.label", gradeLevelValues(x))).join(", "));

  let content: React.ReactNode = null;
  if (!year && (tab === "items" || tab === "plans")) {
    content = <EmptyState icon={<ListChecks className="size-5" />} title={t("setup.noYear")} body={t("setup.noYearBody")} />;
  } else if (tab === "items") {
    content = (
      <Panel padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <PanelHeader title={t("setup.itemsTitle", { year: pick(L, year!.nameEn, year!.nameAr) })} description={t("setup.itemsBody")} />
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <CopyScheduleDialog years={years.map((y) => ({ id: y.id, name: pick(L, y.nameEn, y.nameAr) }))} toYearId={year!.id} />
              <FeeItemDialog yearId={year!.id} />
            </div>
          )}
        </div>
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft/40 p-3 text-xs" data-testid="vat-note">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <span>{t("setup.vatConfirm")}</span>
        </div>
        {sorted.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState icon={<ListChecks className="size-5" />} title={t("setup.noItems")} body={t("setup.noItemsBody")} action={canManage ? <FeeItemDialog yearId={year!.id} /> : undefined} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm" data-testid="fee-items">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t("setup.item")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("setup.appliesTo")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("setup.vatTreatment")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("setup.amount")}</th>
                  <th className="px-4 py-2 text-end font-medium">{defaultPlan ? t("setup.perInstalment", { plan: pick(L, defaultPlan.nameEn, defaultPlan.nameAr) }) : ""}</th>
                  {canManage && <th className="w-20" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((i) => (
                  <tr key={i.id} className={cn(!i.active && "opacity-60")} data-testid={`item-${i.code}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{pick(L, i.nameEn, i.nameAr)}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <bdi>{i.code}</bdi> · {t(`kind.${i.kind}`)}
                        {i.recurring && <Pill tone="brand">{t("setup.recurringShort")}</Pill>}
                        {i.discountable && <Pill tone="gold">{t("setup.discountableShort")}</Pill>}
                        {!i.active && <Pill>{t("setup.off")}</Pill>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{i.kind === "TRANSPORT" ? t("setup.zoneN", { zone: i.zone ?? "" }) : gradeText(i.gradeLevels)}</td>
                    <td className="px-4 py-2.5">
                      <Pill tone={i.vatTreatment === "STANDARD" ? "warning" : "neutral"}>{t(`vat.${i.vatTreatment}`)}</Pill>
                    </td>
                    <td className="px-4 py-2.5 text-end font-medium">
                      <Money fils={i.amountFils} locale={L} />
                      <div className="text-xs font-normal text-muted-foreground">{i.recurring ? t("setup.perYear") : t("setup.each")}</div>
                    </td>
                    <td className="px-4 py-2.5 text-end text-xs text-muted-foreground">
                      {i.recurring && shares.length ? previewInstalments(i.amountFils, shares).map((a, k) => <div key={k}><Money fils={a} locale={L} /></div>) : "-"}
                    </td>
                    {canManage && (
                      <td className="px-2 py-2.5">
                        <div className="flex justify-end">
                          <FeeItemDialog
                            yearId={year!.id}
                            initial={{ id: i.id, academicYearId: i.academicYearId, code: i.code, kind: i.kind, nameEn: i.nameEn, nameAr: i.nameAr, amountFils: i.amountFils, gradeLevels: i.gradeLevels, zone: i.zone ?? "", recurring: i.recurring, proRata: i.proRata, discountable: i.discountable, autoBill: i.autoBill, vatTreatment: i.vatTreatment, active: i.active }}
                          />
                          <DeleteItemButton id={i.id} code={i.code} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  } else if (tab === "plans") {
    content = (
      <Panel>
        <PanelHeader title={t("setup.plansTitle")} description={t("setup.plansBody")} action={canManage ? <PlanDialog yearId={year!.id} /> : undefined} />
        {plans.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-5" />} title={t("setup.noPlans")} body={t("setup.noPlansBody")} action={canManage ? <PlanDialog yearId={year!.id} /> : undefined} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2" data-testid="plans">
            {plans.map((p) => {
              const isBilled = p.parts.some((x) => billed.has(x.id));
              return (
                <div key={p.id} className="rounded-lg border p-4">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{pick(L, p.nameEn, p.nameAr)}</div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <Pill tone="brand">{t(`planKind.${p.kind}`)}</Pill>
                        {p.isDefault && <Pill tone="success">{t("setup.default")}</Pill>}
                        {!p.active && <Pill>{t("setup.off")}</Pill>}
                      </div>
                    </div>
                    {canManage && (
                      <PlanDialog
                        yearId={year!.id}
                        billed={isBilled}
                        initial={{ id: p.id, academicYearId: p.academicYearId, key: p.key, nameEn: p.nameEn, nameAr: p.nameAr, kind: p.kind, isDefault: p.isDefault, active: p.active, parts: p.parts.map((x) => ({ labelEn: x.labelEn, labelAr: x.labelAr, shareBp: x.shareBp, dueDate: dayInput(x.dueDate), periodStart: dayInput(x.periodStart), periodEnd: dayInput(x.periodEnd) })) }}
                      />
                    )}
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    {p.parts.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2">
                        <span>
                          {pick(L, x.labelEn, x.labelAr)} <span className="text-xs text-muted-foreground">({x.shareBp / 100}%)</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{t("setup.dueOn", { date: fmtDate(prefs, x.dueDate) })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    );
  } else if (tab === "discounts") {
    content = (
      <div className="space-y-4">
        <Panel>
          <PanelHeader title={t("setup.automaticTitle")} description={t("setup.automaticBody")} />
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("setup.siblings")}</div>
              <div className="mt-1 font-medium">{t("setup.siblingRates", { second: cfg.siblingSecondBp / 100, third: cfg.siblingThirdBp / 100, fourth: cfg.siblingFourthBp / 100 })}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("setup.early")}</div>
              <div className="mt-1 font-medium">{cfg.earlyPaymentBp ? t("setup.earlyRate", { pct: cfg.earlyPaymentBp / 100, days: cfg.earlyPaymentDays }) : t("setup.earlyOff")}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("setup.stacking")}</div>
              <div className="mt-1 font-medium">{cfg.discountStacking === "STACK" ? t("setup.stackingStack") : t("setup.stackingBest")}</div>
            </div>
          </div>
          {canManage && (
            <Link href="/finance/setup?tab=rules" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
              {t("setup.changeRules")}
            </Link>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("setup.discountsTitle")} description={t("setup.discountsBody")} action={canManage ? <DiscountDialog /> : undefined} />
          {discounts.length === 0 ? (
            <EmptyState title={t("setup.noDiscounts")} action={canManage ? <DiscountDialog /> : undefined} />
          ) : (
            <ul className="divide-y" data-testid="discounts">
              {discounts.map((d) => (
                <li key={d.id} className={cn("flex flex-wrap items-center justify-between gap-3 py-3 text-sm", !d.active && "opacity-60")}>
                  <div>
                    <div className="font-medium">{pick(L, d.nameEn, d.nameAr)}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <bdi>{d.code}</bdi> · {t(`discountKind.${d.kind}`)}
                      {d.requiresApproval && <Pill tone="warning">{t("setup.needsApproval")}</Pill>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{d.method === "PERCENT" ? `${(d.percentBp ?? 0) / 100}%` : <Money fils={d.amountFils ?? 0} locale={L} />}</span>
                    {canManage && <DiscountDialog initial={{ id: d.id, code: d.code, kind: d.kind, nameEn: d.nameEn, nameAr: d.nameAr, method: d.method, percentBp: d.percentBp, amountFils: d.amountFils, requiresApproval: d.requiresApproval, active: d.active }} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("setup.orderTitle")} description={t("setup.orderBody")} />
        </Panel>
      </div>
    );
  } else {
    content = (
      <SettingsForm
        section={tab}
        readOnly={!canManage}
        online={{ configured: Boolean(provider), ready: Boolean(provider?.ready), provider: provider?.key ?? null, test: Boolean(provider?.test) }}
        initial={{
          legalNameEn: cfg.legalNameEn ?? "",
          legalNameAr: cfg.legalNameAr ?? "",
          addressEn: cfg.addressEn ?? "",
          addressAr: cfg.addressAr ?? "",
          trn: cfg.trn ?? "",
          vatRegistered: cfg.vatRegistered,
          standardVatBp: cfg.standardVatBp,
          invoicePrefix: cfg.invoicePrefix,
          proformaPrefix: cfg.proformaPrefix,
          creditNotePrefix: cfg.creditNotePrefix,
          receiptPrefix: cfg.receiptPrefix,
          refundPrefix: cfg.refundPrefix,
          paymentTermsDays: cfg.paymentTermsDays,
          siblingSecondBp: cfg.siblingSecondBp,
          siblingThirdBp: cfg.siblingThirdBp,
          siblingFourthBp: cfg.siblingFourthBp,
          discountStacking: cfg.discountStacking,
          earlyPaymentBp: cfg.earlyPaymentBp,
          earlyPaymentDays: cfg.earlyPaymentDays,
          proRataBasis: cfg.proRataBasis,
          proRataCutoffDay: cfg.proRataCutoffDay,
          remindersEnabled: cfg.remindersEnabled,
          reminderDaysBefore: cfg.reminderDaysBefore,
          reminderDaysAfter: cfg.reminderDaysAfter,
          holdReportCards: cfg.holdReportCards,
          holdAfterDays: cfg.holdAfterDays,
          onlinePayments: cfg.onlinePayments,
          bankDetailsEn: cfg.bankDetailsEn ?? "",
          bankDetailsAr: cfg.bankDetailsAr ?? "",
        }}
      />
    );
  }

  return (
    <PageBody>
      <PageHeader
        title={t("setup.title")}
        description={canManage ? t("setup.subtitle") : t("setup.subtitleReadOnly")}
        actions={
          years.length > 1 && (tab === "items" || tab === "plans") ? (
            <div className="flex flex-wrap gap-1.5">
              {years.slice(0, 3).map((y) => (
                <Link key={y.id} href={`/finance/setup?${new URLSearchParams({ ...(tab !== "items" ? { tab } : {}), year: y.id }).toString()}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", y.id === year?.id ? "border-brand bg-brand-soft text-brand" : "bg-card hover:bg-muted")}>
                  {pick(L, y.nameEn, y.nameAr)}
                </Link>
              ))}
            </div>
          ) : null
        }
      />
      <FinanceTabs active="setup" can={ctx.can} />
      <nav className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 lg:w-fit">
        {TABS.map((k) => (
          <Link key={k} href={yearHref(k)} className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === k ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")} data-testid={`setup-tab-${k}`}>
            {t(`setup.tab.${k}`)}
          </Link>
        ))}
      </nav>
      {content}
    </PageBody>
  );
}
