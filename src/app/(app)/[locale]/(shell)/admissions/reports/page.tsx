import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, FileSpreadsheet } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { BarList } from "@/components/charts/bar-list";
import { Button } from "@/components/ui/button";
import { canViewAdmissions } from "@/server/admissions/access";
import { ageSummary, capacityReport, conversionFrom, funnel, nationalitySummary, SMALL_GROUP } from "@/server/admissions/reports";
import { asTx, loadSettings } from "@/server/admissions/settings";
import { countryName } from "@/server/admissions/config";
import { filterOptions, filtersFrom, type SP } from "@/server/admissions/page-data";
import { AdmissionFilters } from "@/components/admissions/filters";

export async function generateMetadata() {
  const t = await getTranslations("admissions.reports");
  return { title: t("title") };
}

// Capacity chart series: categorical slots 1 to 3 of the validated reference palette (light and dark steps).
const VIZ_CSS = `.adm-viz{--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--track:var(--muted)}.dark .adm-viz{--s1:#3987e5;--s2:#d95926;--s3:#199e70}`;

export default async function AdmissionsReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!canViewAdmissions(ctx)) notFound();
  const t = await getTranslations("admissions.reports");
  const tg = await getTranslations("gradeLevel");
  const ts = await getTranslations("admissions.stage");
  const { filters, years } = await filtersFrom(ctx, sp);
  const opts = await filterOptions(ctx, years);
  const year = years.find((y) => y.id === filters.yearId);
  if (!year) {
    return (
      <PageBody>
        <PageHeader title={t("title")} />
        <p className="text-sm text-muted-foreground">{t("noYear")}</p>
      </PageBody>
    );
  }
  const tx = asTx(ctx.db);
  const settings = await loadSettings(tx, ctx.orgId);
  const [f, cap, nat, ages] = await Promise.all([funnel(tx, ctx.orgId, year.id), capacityReport(tx, ctx.orgId, year), nationalitySummary(tx, ctx.orgId, year.id), ageSummary(tx, ctx.orgId, year, settings.cutoff)]);
  const fg = filters.grade === null ? f : f.filter((r) => r.grade === filters.grade);
  const byStage = settings.stages.map((s) => ({ key: s.key, label: pick(ctx.locale, s.labelEn, s.labelAr) || (ts.has(s.key) ? ts(s.key) : s.key), n: fg.filter((r) => r.stage === s.key).reduce((a, r) => a + r.n, 0) }));
  const conv = conversionFrom(fg, settings);
  const pct = (v: number | null) => (v === null ? "-" : `${v}%`);
  const grade = (g: number) => tg("label", gradeLevelValues(g));
  const capRows = cap.filter((c) => c.capacity !== null && (filters.grade === null || c.grade === filters.grade));
  const qs = `year=${year.id}`;
  return (
    <PageBody className="max-w-6xl">
      <style>{VIZ_CSS}</style>
      <PageHeader
        title={t("title")}
        description={t("subtitle", { year: pick(ctx.locale, year.nameEn, year.nameAr) })}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/admissions/export?kind=funnel&${qs}&format=xlsx`} data-testid="export-funnel">
                <FileSpreadsheet className="size-4" />
                {t("exportFunnel")}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/admissions/export?kind=capacity&${qs}&format=csv`} data-testid="export-capacity">
                <Download className="size-4" />
                {t("exportCapacity")}
              </a>
            </Button>
          </>
        }
      />
      <AdmissionFilters year={filters.yearId} years={opts.years} grades={opts.grades} search={false} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("submitted")} value={conv.submitted} tone="info" />
        <StatCard label={t("offerRate")} value={pct(conv.offerRate)} hint={t("offered", { n: conv.offered })} tone="gold" />
        <StatCard label={t("acceptRate")} value={pct(conv.acceptRate)} hint={t("accepted", { n: conv.accepted })} tone="success" />
        <StatCard label={t("enrollRate")} value={pct(conv.enrollRate)} hint={t("enrolled", { n: conv.enrolled })} tone="brand" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("funnel")} description={t("funnelHint")} />
          <BarList rows={byStage.filter((s) => s.n > 0 || ["NEW", "OFFER_MADE", "ENROLLED"].includes(s.key)).map((s) => ({ label: s.label, value: s.n }))} empty={t("noData")} />
        </Panel>
        <Panel className="adm-viz">
          <PanelHeader title={t("capacity")} description={t("capacityHint")} />
          {capRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("noCapacity")}{" "}
              <Link href="/admissions/capacity" className="text-brand hover:underline">
                {t("setCapacity")}
              </Link>
            </p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label={t("legend")}>
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--s1)" }} />{t("legendEnrolled")}</li>
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--s2)" }} />{t("legendAccepted")}</li>
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--s3)" }} />{t("legendOffered")}</li>
                <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border bg-muted" />{t("legendFree")}</li>
              </ul>
              <ul className="mt-3 space-y-2.5" data-testid="capacity-chart">
                {capRows.map((c) => {
                  const total = Math.max(c.capacity ?? 0, c.enrolled + c.holding + c.offered, 1);
                  const seg = (n: number) => `${(n / total) * 100}%`;
                  return (
                    <li key={c.grade} title={t("capacityTip", { grade: grade(c.grade), enrolled: c.enrolled, holding: c.holding, offered: c.offered, capacity: c.capacity ?? 0 })}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                        <span>{grade(c.grade)}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{t("ofCapacity", { n: c.enrolled + c.holding + c.offered, capacity: c.capacity ?? 0 })}</span>
                      </div>
                      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-muted">
                        {c.enrolled > 0 && <div style={{ width: seg(c.enrolled), background: "var(--s1)" }} />}
                        {c.holding > 0 && <div style={{ width: seg(c.holding), background: "var(--s2)" }} />}
                        {c.offered > 0 && <div style={{ width: seg(c.offered), background: "var(--s3)" }} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Link href="/admissions/capacity" className="mt-3 inline-block text-xs text-brand hover:underline">
                {t("asTable")}
              </Link>
            </>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("nationalities")} description={t("nationalitiesHint", { n: SMALL_GROUP })} />
          <BarList rows={nat.slice(0, 12).map((r) => ({ label: r.code === "OTHER" ? t("otherNationalities") : countryName(r.code, ctx.locale), value: r.n }))} empty={t("noData")} />
        </Panel>
        <Panel>
          <PanelHeader title={t("ages")} description={t("agesHint")} />
          <BarList rows={ages.bands.map((b) => ({ label: t(`band.${b.key}`), value: b.n }))} empty={t("noData")} />
          <p className="mt-3 text-xs text-muted-foreground">{t("ageFlags", { under: ages.under, over: ages.over })}</p>
        </Panel>
      </div>
    </PageBody>
  );
}
