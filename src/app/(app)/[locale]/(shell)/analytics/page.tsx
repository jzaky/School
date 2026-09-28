import { getTranslations } from "next-intl/server";
import { CalendarCheck2, Compass, FileSignature, HeartHandshake, Inbox, ShieldCheck, Sparkles, Timer, TrendingUp } from "lucide-react";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { schoolKpis } from "@/server/analytics/kpis";
import { SENSITIVE } from "@/server/access/case-access";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { BarList } from "@/components/charts/bar-list";
import { TrendChart } from "@/components/charts/trend-chart";
import { Ring } from "@/components/charts/ring";
import { AskInsights } from "@/components/analytics/ask-insights";

export async function generateMetadata() {
  const t = await getTranslations("analytics");
  return { title: t("title") };
}

const PERIODS = [7, 30, 90] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePermission("analytics.view");
  const t = await getTranslations("analytics");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const days = PERIODS.find((p) => String(p) === sp.days) ?? 30;
  const since = new Date(Date.now() - days * 86400_000);
  const n = (v: number) => fmtNumber(prefs, v);
  const hrs = (v: number) => t("hours", { n: fmtNumber(prefs, v) });

  // Meetings linked to wellbeing or safeguarding cases are left out of every figure (CLAUDE.md rule 6).
  const sensitiveCaseIds = (await db.case.findMany({ where: { orgId, sensitivity: { in: SENSITIVE } }, select: { id: true } })).map((c) => c.id);
  const [k, byStatus, appts, types, assessments, chosen, letters] = await Promise.all([
    schoolKpis(ctx, days),
    db.request.groupBy({ by: ["status"], where: { orgId, sensitivity: { notIn: SENSITIVE }, submittedAt: { gte: since } }, _count: { _all: true } }),
    db.appointment.groupBy({ by: ["typeId", "status"], where: { orgId, startsAt: { gte: since, lt: new Date() }, OR: [{ caseId: null }, { caseId: { notIn: sensitiveCaseIds } }] }, _count: { _all: true } }),
    db.appointmentType.findMany({ where: { orgId }, select: { id: true, nameEn: true, nameAr: true } }),
    db.aptitudeAssessment.count({ where: { orgId, completedAt: { gte: since } } }),
    db.careerProfile.count({ where: { orgId, chosenCareerId: { not: null } } }),
    db.document.count({ where: { orgId, source: "GENERATED", createdAt: { gte: since } } }),
  ]);

  const statusRows = ["SUBMITTED", "IN_REVIEW", "PENDING_APPROVAL", "IN_PROGRESS", "COMPLETED", "REJECTED", "CANCELLED"]
    .map((s) => ({ label: t(`status.${s}`), value: byStatus.filter((b) => b.status === s || (s === "IN_PROGRESS" && b.status === "APPROVED")).reduce((a, b) => a + b._count._all, 0) }))
    .filter((r) => r.value > 0);
  const meetingsByType = types
    .map((ty) => ({ label: pick(locale, ty.nameEn, ty.nameAr), value: appts.filter((a) => a.typeId === ty.id && a.status !== "CANCELLED").reduce((s, a) => s + a._count._all, 0) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const noShows = appts.filter((a) => a.status === "NO_SHOW").reduce((s, a) => s + a._count._all, 0);
  const held = appts.filter((a) => a.status === "COMPLETED").reduce((s, a) => s + a._count._all, 0);

  const suggestions = [t("suggest1"), t("suggest2"), t("suggest3")];
  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label={t("period")}>
            {PERIODS.map((p) => (
              <Link key={p} href={`/analytics?days=${p}`} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", p === days ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")} data-testid={`period-${p}`}>
                {t("days", { n: p })}
              </Link>
            ))}
          </div>
        }
      />
      <p className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-success" />
        {t("privacyNote")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("kpiRequests")} value={n(k.requests.thisPeriod)} hint={t("vsPrevious", { delta: `${k.requests.delta >= 0 ? "+" : ""}${k.requests.delta}%` })} icon={<TrendingUp className="size-5" />} testId="analytics-requests" />
        <StatCard label={t("kpiResolution")} value={hrs(k.avgResolutionHours)} hint={t("closedInPeriod")} icon={<Timer className="size-5" />} tone="info" />
        <StatCard label={t("kpiOpen")} value={n(k.requests.open)} icon={<Inbox className="size-5" />} tone="warning" href="/requests?tab=all&status=open" />
        <StatCard label={t("kpiCases")} value={n(k.openCases)} hint={t("excludesSensitive")} icon={<HeartHandshake className="size-5" />} tone="gold" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("trendTitle")} description={t("trendHint")} />
          <TrendChart data={k.weeks} dir={locale === "ar" ? "rtl" : "ltr"} unit={locale === "ar" ? " س" : "h"} height={240} />
        </Panel>
        <Panel className="flex flex-col">
          <PanelHeader title={t("serviceLevel")} description={t("serviceLevelHint")} />
          <div className="flex flex-1 items-center justify-around gap-4">
            <div className="flex flex-col items-center gap-2">
              <Ring value={k.sla} label={t("slaMet")} tone={k.sla >= 90 ? "var(--success)" : "var(--warning)"} />
              <span className="text-xs text-muted-foreground">{t("slaMet")}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Ring value={k.utilization} label={t("attendance")} tone="var(--brand)" />
              <span className="text-xs text-muted-foreground">{t("attendance")}</span>
            </div>
          </div>
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel>
          <PanelHeader title={t("byService")} description={t("inPeriod", { n: days })} />
          <BarList rows={k.byService} format={n} empty={t("none")} />
        </Panel>
        <Panel>
          <PanelHeader title={t("byStatus")} description={t("inPeriod", { n: days })} />
          <BarList rows={statusRows} format={n} empty={t("none")} />
        </Panel>
        <Panel>
          <PanelHeader title={t("slowest")} description={t("slowestHint")} />
          <BarList rows={k.slowest.map((s) => ({ label: s.label, value: s.value }))} format={hrs} empty={t("none")} />
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel>
          <PanelHeader title={t("meetings")} description={t("meetingsHint", { held: n(held), noShow: n(noShows) })} icon={<CalendarCheck2 className="size-4" />} />
          <BarList rows={meetingsByType} format={n} empty={t("none")} />
        </Panel>
        <Panel>
          <PanelHeader title={t("casesByDept")} description={t("excludesSensitive")} icon={<HeartHandshake className="size-4" />} />
          <BarList rows={k.byDepartment} format={n} empty={t("none")} />
        </Panel>
        <Panel>
          <PanelHeader title={t("guidance")} description={t("inPeriod", { n: days })} icon={<Compass className="size-4" />} />
          <dl className="grid grid-cols-1 gap-3">
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
              <dt className="text-sm text-muted-foreground">{t("assessments")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{n(assessments)}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
              <dt className="text-sm text-muted-foreground">{t("chosenCareers")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{n(chosen)}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileSignature className="size-3.5" />
                {t("letters")}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">{n(letters)}</dd>
            </div>
          </dl>
        </Panel>
      </div>
      {ctx.can("ai.admin_insights") && (
        <Panel>
          <PanelHeader title={t("askTitle")} description={t("askHint")} icon={<Sparkles className="size-4" />} />
          <AskInsights suggestions={suggestions} />
        </Panel>
      )}
    </PageBody>
  );
}
