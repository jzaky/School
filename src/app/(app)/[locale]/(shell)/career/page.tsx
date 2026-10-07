import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Compass, Handshake, Map as MapIcon } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtRelative } from "@/lib/format";
import { initials, personName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { CareerOverview } from "@/components/career/career-overview";

export async function generateMetadata() {
  const t = await getTranslations("career");
  return { title: t("title") };
}

export default async function CareerPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("career");
  const prefs = await formatPrefs(ctx);
  if (ctx.isStudent && ctx.membership.student) {
    const tp = await getTranslations("partners");
    const tn = await getTranslations("nav");
    const partners = await ctx.db.partnerResource.findMany({ where: { active: true, audience: { has: "student" } }, orderBy: { nameEn: "asc" }, take: 3 });
    return (
      <PageBody>
        <PageHeader
          title={t("title")}
          description={sp.done ? t("doneSubtitle") : t("subtitle")}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/career/explore">{t("explorer")}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/career/events">{tn("careerEvents")}</Link>
              </Button>
              {ctx.can("pathways.view") && (
                <Button asChild data-testid="open-pathway-planning">
                  <Link href="/career/pathways">{t("pathwayCta.button")}</Link>
                </Button>
              )}
            </>
          }
        />
        {ctx.can("pathways.view") && (
          <Link href="/career/pathways" className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs transition hover:border-brand/40" data-testid="pathway-cta">
            <MapIcon className="size-6 shrink-0 text-brand" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t("pathwayCta.title")}</span>
              <span className="block text-sm text-muted-foreground">{t("pathwayCta.body")}</span>
            </span>
          </Link>
        )}
        <CareerOverview ctx={ctx} prefs={prefs} studentId={ctx.membership.student.id} mode="student" />
        {partners.length > 0 && (
          <section className="rounded-xl border bg-card p-5 shadow-xs" data-testid="career-partners">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Handshake className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <h2 className="text-sm font-semibold">{tp("cardTitle")}</h2>
                  <p className="text-xs text-muted-foreground">{tp("cardBody")}</p>
                </div>
              </div>
              <Link href="/career/resources" className="shrink-0 text-xs font-medium text-brand">
                {tp("seeAll")}
              </Link>
            </div>
            <ul className="grid gap-2 sm:grid-cols-3">
              {partners.map((p) => (
                <li key={p.id} className="min-w-0 rounded-lg border p-3">
                  <a href={`/api/career/resources/${p.id}/go`} target="_blank" rel="noopener noreferrer" className="block text-sm font-medium hover:text-brand">
                    {pick(ctx.locale, p.nameEn, p.nameAr)}
                  </a>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{pick(ctx.locale, p.descEn, p.descAr)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PageBody>
    );
  }
  if (!ctx.can("career.advise")) notFound();
  const { db, orgId, locale } = ctx;
  const assessments = await db.aptitudeAssessment.findMany({ where: { orgId, completedAt: { not: null } }, include: { student: { include: { careerProf: true } } }, orderBy: { completedAt: "desc" }, take: 60 });
  const drafts = await db.careerRecommendation.groupBy({ by: ["studentId"], where: { orgId, status: "DRAFT" }, _count: { _all: true } });
  const careers = await db.career.findMany({ where: { orgId, id: { in: assessments.map((a) => a.student.careerProf?.chosenCareerId).filter(Boolean) as string[] } } });
  const seen = new Set<string>();
  const rows = assessments.filter((a) => (seen.has(a.studentId) ? false : (seen.add(a.studentId), true)));
  return (
    <PageBody>
      <PageHeader
        title={t("advisorTitle")}
        description={t("advisorSubtitle")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/career/explore">{t("explorer")}</Link>
            </Button>
            {ctx.can("pathways.view") && ctx.can("people.view") && (
              <Button asChild>
                <Link href="/career/pathways">{t("pathwayCta.button")}</Link>
              </Button>
            )}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Compass className="size-5" />} title={t("noAssessments")} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {rows.map((a) => {
            const chosen = careers.find((c) => c.id === a.student.careerProf?.chosenCareerId);
            const draft = drafts.find((d) => d.studentId === a.studentId)?._count._all ?? 0;
            return (
              <li key={a.id}>
                <Link href={`/career/students/${a.studentId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30" data-testid="career-student">
                  <span className="grid size-9 place-items-center rounded-full bg-violet-50 text-xs font-semibold text-violet-700">{initials(`${a.student.firstNameEn} ${a.student.lastNameEn}`)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{personName(a.student, locale)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("gradeN", { grade: a.student.gradeLevel })} · {fmtRelative(prefs, a.completedAt)}
                    </span>
                  </span>
                  {chosen && <Pill tone="brand">{pick(locale, chosen.titleEn, chosen.titleAr)}</Pill>}
                  {draft > 0 && <Pill tone="warning">{t("toReview")}</Pill>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
