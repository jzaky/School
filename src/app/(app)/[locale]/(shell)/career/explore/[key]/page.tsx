import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, Briefcase, ChevronLeft, GraduationCap, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { BarList } from "@/components/charts/bar-list";
import { DIMENSIONS, DIMENSION_LABELS, type CareerWeights } from "@/server/career/dimensions";
import { subjectName } from "@/server/career/scoring";
import { ChooseCareerButton } from "@/components/career/career-client";
import { countryName } from "@/components/career/career-overview";

const KEYWORDS: Record<string, string[]> = {
  ai_engineer: ["Artificial Intelligence", "Machine Learning", "Computer Science", "Data Science"],
  software_developer: ["Computer Science", "Software"],
  data_scientist: ["Data Science", "Statistics", "Computer Science"],
};

export default async function CareerDetail({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("career");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const c = await db.career.findUnique({ where: { orgId_key: { orgId, key } } });
  if (!c) notFound();
  const words = KEYWORDS[key] ?? [c.titleEn.split(" ")[0]];
  const unis = (await db.university.findMany({ where: { orgId } })).filter((u) => u.programsEn.some((p) => words.some((w) => p.toLowerCase().includes(w.toLowerCase())))).slice(0, 8);
  const w = c.weights as CareerWeights;
  const profile = ctx.isStudent && ctx.membership.student ? await db.careerProfile.findUnique({ where: { studentId: ctx.membership.student.id } }) : null;
  return (
    <PageBody className="max-w-5xl">
      <Link href="/career/explore" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("explorer")}
      </Link>
      <Panel className="overflow-hidden p-0">
        <div className="bg-gradient-to-br from-brand to-violet-600 p-8 text-white">
          <div className="text-xs font-medium uppercase tracking-wide text-white/70">{pick(locale, c.clusterEn, c.clusterAr)}</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight" data-testid="career-title">
            {pick(locale, c.titleEn, c.titleAr)}
          </h1>
          <p className="mt-3 max-w-2xl text-white/85">{pick(locale, c.summaryEn, c.summaryAr)}</p>
          <div className="mt-5 flex flex-wrap gap-4 text-sm">
            {c.salaryMinAed && (
              <span className="inline-flex items-center gap-1.5">
                <Wallet className="size-4" />
                {t("salary", { min: fmtNumber(prefs, c.salaryMinAed), max: fmtNumber(prefs, c.salaryMaxAed ?? c.salaryMinAed) })}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="size-4" />
              {t("demand", { n: c.uaeDemand })}
            </span>
          </div>
          {ctx.isStudent && (
            <div className="mt-6 inline-flex rounded-lg bg-white/95 p-1">
              <ChooseCareerButton careerId={c.id} chosen={profile?.chosenCareerId === c.id} />
            </div>
          )}
        </div>
      </Panel>
      <div className="grid gap-6 md:grid-cols-2">
        <Panel>
          <PanelHeader title={t("dayInLife")} icon={<Briefcase className="size-4" />} />
          <p className="text-sm leading-relaxed">{pick(locale, c.dayInLifeEn, c.dayInLifeAr)}</p>
        </Panel>
        <Panel>
          <PanelHeader title={t("education")} icon={<GraduationCap className="size-4" />} />
          <p className="text-sm leading-relaxed">{pick(locale, c.educationEn, c.educationAr)}</p>
        </Panel>
        <Panel>
          <PanelHeader title={t("strengthsNeeded")} icon={<Sparkles className="size-4" />} />
          <BarList rows={[...DIMENSIONS].filter((d) => w[d] > 0).sort((a, b) => w[b] - w[a]).map((d) => ({ label: pick(locale, DIMENSION_LABELS[d].en, DIMENSION_LABELS[d].ar), value: w[d] }))} format={(n) => `${n}/5`} />
        </Panel>
        <Panel>
          <PanelHeader title={t("subjectsSkills")} icon={<BookOpen className="size-4" />} />
          <div className="mb-3 flex flex-wrap gap-1.5">
            {c.subjects.map((s) => (
              <Pill key={s} tone="brand">
                {subjectName(s, locale as "en" | "ar")}
              </Pill>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(locale === "ar" ? c.skillsAr : c.skillsEn).map((s) => (
              <Pill key={s}>{s}</Pill>
            ))}
          </div>
        </Panel>
      </div>
      {unis.length > 0 && (
        <Panel>
          <PanelHeader title={t("whereToStudy")} icon={<GraduationCap className="size-4" />} />
          <ul className="grid gap-2 sm:grid-cols-2">
            {unis.map((u) => (
              <li key={u.id} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{pick(locale, u.nameEn, u.nameAr)}</div>
                <div className="text-xs text-muted-foreground">
                  {pick(locale, u.cityEn, u.cityAr)}, {countryName(u.countryCode, locale)}
                  {u.worldRank ? ` · ${t("rank", { n: u.worldRank })}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageBody>
  );
}
