import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ExternalLink, Landmark } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { CheckSummary, countryLabel, requirementLines, SourceNote } from "@/components/pathways/pathway-ui";
import { pathwayFocus, withStudent } from "@/server/pathways/page-data";
import { checkProgram } from "@/server/pathways/profile";
import { usStats } from "@/server/pathways/us-data";
import type { ProgramRequirements } from "@/server/pathways/types";

export default async function UniversityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ student?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const t = await getTranslations("pathways");
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { db, locale } = ctx;
  const uni = await db.university.findUnique({ where: { id } });
  if (!uni) notFound();
  const focus = await pathwayFocus(ctx, sp.student);
  const link = (href: string) => withStudent(href, focus.student?.id, ctx.isStudent);
  const programs = await db.universityProgram.findMany({ where: { universityId: uni.id }, orderBy: { nameEn: "asc" } });
  const stats = usStats(uni.scorecardId);
  const curriculum = focus.data?.curriculum ?? "BRITISH";
  const monthName = (m: number) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2001, m - 1, 15)));

  return (
    <PageBody>
      <Link href={link("/career/universities?tab=universities")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>
      <PageHeader
        title={pick(locale, uni.nameEn, uni.nameAr)}
        description={`${pick(locale, uni.cityEn, uni.cityAr)}, ${countryLabel(uni.countryCode, locale)}`}
        actions={
          uni.website && (
            <a href={`https://${uni.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              {uni.website}
              <ExternalLink className="size-3.5" />
            </a>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("uni.facts")} />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("uni.route")}</dt>
              <dd className="text-end">{uni.applyVia ? t(`route.${uni.applyVia}`) : t("uni.checkSite")}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("uni.usualDeadline")}</dt>
              <dd className="text-end">{uni.deadlineMonth ? monthName(uni.deadlineMonth) : t("uni.checkSite")}</dd>
            </div>
            {uni.acceptanceRate != null && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("uni.admitRate")}</dt>
                <dd className="text-end">{fmt(uni.acceptanceRate)}%</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{uni.scorecardId ? t("uni.scorecardSource") : t("uni.catalogueSource")}</p>
        </Panel>
        {stats && (
          <Panel className="lg:col-span-2">
            <PanelHeader title={t("uni.scorecard")} description={t("uni.scorecardFetched", { date: fmtDate(prefs, stats.fetchedAt) })} />
            <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="scorecard-stats">
              {stats.satReading && (
                <div>
                  <dt className="text-muted-foreground">{t("uni.satReading")}</dt>
                  <dd>{t("uni.range", { low: fmt(stats.satReading[0]), high: fmt(stats.satReading[1]) })}</dd>
                </div>
              )}
              {stats.satMath && (
                <div>
                  <dt className="text-muted-foreground">{t("uni.satMath")}</dt>
                  <dd>{t("uni.range", { low: fmt(stats.satMath[0]), high: fmt(stats.satMath[1]) })}</dd>
                </div>
              )}
              {stats.act && (
                <div>
                  <dt className="text-muted-foreground">{t("uni.act")}</dt>
                  <dd>{t("uni.range", { low: fmt(stats.act[0]), high: fmt(stats.act[1]) })}</dd>
                </div>
              )}
              {stats.size != null && (
                <div>
                  <dt className="text-muted-foreground">{t("uni.size")}</dt>
                  <dd>{fmt(stats.size)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{t("uni.middle50")}</p>
          </Panel>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("uni.programmes")}</h2>
        {programs.length === 0 ? (
          <EmptyState icon={<Landmark className="size-5" />} title={t("uni.noProgrammes")} body={t("uni.noProgrammesBody")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {programs.map((p) => {
              const req = p.requirements as ProgramRequirements;
              const lines = requirementLines(t, curriculum, req, fmt);
              const check = focus.data ? checkProgram(p, focus.data) : null;
              return (
                <Panel key={p.id} className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={link(`/career/universities/programs/${p.id}`)} className="font-semibold hover:text-brand" data-testid="uni-program">
                      {pick(locale, p.nameEn, p.nameAr)}
                    </Link>
                    <Pill tone="brand">{p.degree}</Pill>
                  </div>
                  <div className="rounded-lg bg-brand-soft/50 p-3 text-xs">
                    <div className="mb-1 font-medium">{t("forCurriculum", { curriculum: t(`curriculum.${curriculum}`) })}</div>
                    {lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : <div className="text-muted-foreground">{t("notListedForCurriculum")}</div>}
                  </div>
                  {check && <CheckSummary check={check} />}
                  <SourceNote sourceUrl={p.sourceUrl} lastVerifiedAt={p.lastVerifiedAt} indicative={p.indicative} prefs={prefs} compact />
                </Panel>
              );
            })}
          </div>
        )}
      </section>
    </PageBody>
  );
}
