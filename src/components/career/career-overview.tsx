import { getTranslations } from "next-intl/server";
import { ArrowRight, CalendarPlus, Compass, GraduationCap, Sparkles, TrendingUp } from "lucide-react";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { BarList } from "@/components/charts/bar-list";
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "@/server/career/dimensions";
import { ChooseCareerButton, ReviewRecommendations, Shortlist } from "./career-client";
import { gapText } from "@/components/pathways/pathway-ui";
import { checkProgram, loadStudentPathway } from "@/server/pathways/profile";
import { programsForEntries } from "@/server/pathways/shortlist";
import { catalogScope } from "@/server/pathways/scope";
import { CareerReportButton } from "./career-report-button";

const COUNTRY: Record<string, { en: string; ar: string }> = {
  AE: { en: "UAE", ar: "الإمارات" },
  GB: { en: "United Kingdom", ar: "المملكة المتحدة" },
  US: { en: "United States", ar: "الولايات المتحدة" },
  CA: { en: "Canada", ar: "كندا" },
  NL: { en: "Netherlands", ar: "هولندا" },
  DE: { en: "Germany", ar: "ألمانيا" },
  CH: { en: "Switzerland", ar: "سويسرا" },
  IE: { en: "Ireland", ar: "أيرلندا" },
  FR: { en: "France", ar: "فرنسا" },
  ES: { en: "Spain", ar: "إسبانيا" },
  SA: { en: "Saudi Arabia", ar: "المملكة العربية السعودية" },
  JO: { en: "Jordan", ar: "الأردن" },
  AU: { en: "Australia", ar: "أستراليا" },
  SG: { en: "Singapore", ar: "سنغافورة" },
  HK: { en: "Hong Kong", ar: "هونغ كونغ" },
};
export const countryName = (code: string, locale: string) => (COUNTRY[code] ? pick(locale, COUNTRY[code].en, COUNTRY[code].ar) : code);

/** Career results, matches and university shortlist for one student. Used by the student and the advisor. */
export async function CareerOverview({ ctx, prefs, studentId, mode }: { ctx: Ctx; prefs: FormatPrefs; studentId: string; mode: "student" | "advisor" }) {
  const t = await getTranslations("career");
  const { db, orgId, locale } = ctx;
  const [assessment, recs, profile, entries, universities, careerCase] = await Promise.all([
    db.aptitudeAssessment.findFirst({ where: { studentId, completedAt: { not: null } }, orderBy: { completedAt: "desc" } }),
    db.careerRecommendation.findMany({ where: { studentId, status: { not: "REJECTED" } }, include: { career: true }, orderBy: { rank: "asc" } }),
    db.careerProfile.findUnique({ where: { studentId } }),
    db.shortlistEntry.findMany({ where: { studentId }, include: { university: true, requirements: { orderBy: { dueAt: "asc" } } }, orderBy: { createdAt: "asc" } }),
    // Curated catalogue only: the full US list (thousands) is browsed on /career/universities.
    db.university.findMany({ where: { ...catalogScope(orgId), programsEn: { isEmpty: false } }, orderBy: [{ countryCode: "asc" }, { worldRank: "asc" }] }),
    db.case.findFirst({ where: { studentId, type: "CAREER", status: { notIn: ["CLOSED"] } }, orderBy: { openedAt: "desc" } }),
  ]);
  const tp = await getTranslations("pathways");
  const pathway = entries.length ? await loadStudentPathway(db, orgId, studentId) : null;
  const entryPrograms = await programsForEntries(db, entries);
  const applications = entries.length ? await db.application.findMany({ where: { orgId, studentId }, select: { id: true, universityId: true, programId: true } }) : [];
  const appFor = (e: (typeof entries)[number]) => {
    const p = entryPrograms.get(`${e.universityId}|${e.programEn}`);
    return applications.find((a) => (p ? a.programId === p.id : a.universityId === e.universityId && !a.programId))?.id ?? null;
  };
  const canApply = (mode === "student" && ctx.isStudent) || (mode === "advisor" && ctx.can("applications.manage"));
  const entryCheck = (e: (typeof entries)[number]) => {
    const p = entryPrograms.get(`${e.universityId}|${e.programEn}`);
    if (!p || !pathway) return null;
    const c = checkProgram(p, pathway);
    const n = (x: number) => fmtNumber(prefs, x);
    return {
      href: `/career/universities/programs/${p.id}`,
      met: c.summary.met,
      notMet: c.summary.notMet,
      unknown: c.summary.unknown,
      gaps: c.items.filter((i) => i.status === "not_met" && !i.optional).map((i) => gapText(tp, i, n)).filter((x): x is string => !!x),
    };
  };
  const scores = (assessment?.scores ?? null) as Record<Dimension, number> | null;
  const chosenId = profile?.chosenCareerId ?? null;
  const chosen = recs.find((r) => r.careerId === chosenId)?.career ?? (chosenId ? await db.career.findUnique({ where: { id: chosenId } }) : null);

  if (!assessment) {
    return (
      <Panel className="overflow-hidden p-0">
        <div className="bg-gradient-to-br from-violet-600 to-brand p-8 text-white">
          <Sparkles className="mb-3 size-8 opacity-90" />
          <h2 className="text-2xl font-semibold">{mode === "student" ? t("startTitle") : t("notTaken")}</h2>
          <p className="mt-2 max-w-xl text-white/80">{t("startBody")}</p>
          {mode === "student" && (
            <Button asChild size="lg" className="mt-6 bg-white text-brand hover:bg-white/90" data-testid="start-assessment">
              <Link href="/career/assessment">{t("startCta")}</Link>
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {chosen && (
        <div className="flex flex-col gap-4 rounded-xl border border-brand/20 bg-gradient-to-r from-brand-soft to-violet-50 p-5 sm:flex-row sm:items-center" data-testid="chosen-banner">
          <span className="grid size-12 place-items-center rounded-xl bg-brand text-brand-foreground">
            <Compass className="size-6" />
          </span>
          <div className="flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("yourPath")}</div>
            <div className="text-lg font-semibold">{pick(locale, chosen.titleEn, chosen.titleAr)}</div>
            <div className="text-sm text-muted-foreground">{mode === "student" ? t("nextStep") : t("studentChose")}</div>
          </div>
          {mode === "student" ? (
            <Button asChild data-testid="book-advisor">
              <Link href="/services/career_guidance">
                <CalendarPlus className="size-4" />
                {t("bookAdvisor")}
              </Link>
            </Button>
          ) : (
            careerCase && (
              <Button asChild variant="outline">
                <Link href={`/cases/${careerCase.id}`}>{t("openCase")}</Link>
              </Button>
            )
          )}
        </div>
      )}
      {mode === "advisor" && (
        <ReviewRecommendations studentId={studentId} recs={recs.map((r) => ({ id: r.id, title: pick(locale, r.career.titleEn, r.career.titleAr), score: r.matchScore, status: r.status }))} />
      )}
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("strengths")} description={t("assessedOn", { date: fmtDate(prefs, assessment.completedAt) })} />
          <div className="mb-4">
            <CareerReportButton studentId={studentId} />
          </div>
          <BarList
            rows={scores ? [...DIMENSIONS].sort((a, b) => scores[b] - scores[a]).map((d) => ({ label: pick(locale, DIMENSION_LABELS[d].en, DIMENSION_LABELS[d].ar), value: scores[d] })) : []}
            format={(n) => `${fmtNumber(prefs, n)}%`}
          />
        </Panel>
        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("topMatches")}</h2>
            <Link href="/career/explore" className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              {t("exploreAll")}
              <ArrowRight className="size-3 rtl:rotate-180" />
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {recs.slice(0, 6).map((r, i) => (
              <div key={r.id} className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-xs", r.careerId === chosenId && "border-brand ring-1 ring-brand/30")} data-testid={`match-${r.career.key}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{pick(locale, r.career.clusterEn, r.career.clusterAr)}</div>
                    <Link href={`/career/explore/${r.career.key}`} className="font-semibold hover:text-brand">
                      {i + 1}. {pick(locale, r.career.titleEn, r.career.titleAr)}
                    </Link>
                  </div>
                  <div className="text-end">
                    <div className="text-xl font-semibold tabular-nums text-violet-700">{r.matchScore}%</div>
                    <div className="text-[10px] text-muted-foreground">{t("match")}</div>
                  </div>
                </div>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{pick(locale, r.reasoningEn, r.reasoningAr)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {r.career.salaryMinAed && (
                    <span>{t("salary", { min: fmtNumber(prefs, r.career.salaryMinAed), max: fmtNumber(prefs, r.career.salaryMaxAed ?? r.career.salaryMinAed) })}</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="size-3" />
                    {t("demand", { n: r.career.uaeDemand })}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                  {r.status === "DRAFT" ? <Pill tone="warning">{t("preliminary")}</Pill> : <Pill tone="success">{t("reviewedByAdvisor")}</Pill>}
                  {mode === "student" && <ChooseCareerButton careerId={r.careerId} chosen={r.careerId === chosenId} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Panel>
        <PanelHeader title={t("shortlist")} icon={<GraduationCap className="size-4" />} description={t("shortlistHint")} />
        <Shortlist
          studentId={mode === "advisor" ? studentId : null}
          canApply={canApply}
          entries={entries.map((e) => ({
            id: e.id,
            applicationId: appFor(e),
            university: pick(locale, e.university.nameEn, e.university.nameAr),
            country: countryName(e.university.countryCode, locale),
            program: pick(locale, e.programEn, e.programAr),
            check: entryCheck(e),
            category: e.category,
            status: e.status,
            deadline: e.deadline ? fmtDate(prefs, e.deadline, "short") : null,
            requirements: e.requirements.map((r) => ({ id: r.id, label: pick(locale, r.labelEn, r.labelAr), done: r.done, due: r.dueAt ? fmtDate(prefs, r.dueAt, "short") : null })),
          }))}
          universities={universities.map((u) => ({ id: u.id, name: pick(locale, u.nameEn, u.nameAr), city: pick(locale, u.cityEn, u.cityAr), country: countryName(u.countryCode, locale), programs: u.programsEn, acceptance: u.acceptanceRate, rank: u.worldRank }))}
        />
      </Panel>
    </div>
  );
}
