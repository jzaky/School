import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ClipboardCheck, ExternalLink, Languages, Route, Sparkles } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { AddToShortlistButton, AdvicePanel, StudentPicker } from "@/components/pathways/pathway-client";
import { CheckSummary, CheckTable, countryLabel, curriculumNote, englishLines, requirementLines, SourceNote, subjectLabel, testLabel } from "@/components/pathways/pathway-ui";
import { pathwayFocus, withStudent } from "@/server/pathways/page-data";
import { checkProgram, nextOccurrence } from "@/server/pathways/profile";
import { REQ_CURRICULA, type EnglishReq, type ProgramRequirements } from "@/server/pathways/types";

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ student?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const t = await getTranslations("pathways");
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { db, locale } = ctx;
  const p = await db.universityProgram.findUnique({ where: { id } });
  if (!p) notFound();
  const uni = await db.university.findUnique({ where: { id: p.universityId } });
  if (!uni) notFound();
  const focus = await pathwayFocus(ctx, sp.student);
  const link = (href: string) => withStudent(href, focus.student?.id, ctx.isStudent);
  const req = p.requirements as ProgramRequirements;
  const en = p.englishReq as EnglishReq | null;
  const check = focus.data ? checkProgram(p, focus.data) : null;
  const inShortlist = focus.student ? !!(await db.shortlistEntry.findFirst({ where: { studentId: focus.student.id, universityId: uni.id, programEn: p.nameEn } })) : false;
  const verify = p.lastVerifiedAt ? await db.auditEvent.findFirst({ where: { entityType: "UniversityProgram", entityId: p.id, action: "pathways.program.verify" }, orderBy: { createdAt: "desc" } }) : null;
  const verifier = verify?.actorId ? await db.membership.findUnique({ where: { id: verify.actorId }, include: { user: true } }) : null;
  const notes = pick(locale, p.notesEn, p.notesAr);
  const enLines = englishLines(t, en, fmt, locale);
  const own = focus.data?.curriculum;

  return (
    <PageBody>
      <Link href={link(`/career/universities/${uni.id}`)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {pick(locale, uni.nameEn, uni.nameAr)}
      </Link>
      <PageHeader
        eyebrow={`${pick(locale, uni.cityEn, uni.cityAr)}, ${countryLabel(uni.countryCode, locale)}`}
        title={pick(locale, p.nameEn, p.nameAr)}
        description={t("programMeta", { degree: p.degree, years: fmt(p.durationYears), field: t(`field.${p.field}`) })}
        actions={
          <>
            {focus.options.length > 0 && <StudentPicker students={focus.options} current={focus.student?.id ?? null} />}
            {focus.student && focus.canAdd && <AddToShortlistButton programId={p.id} studentId={focus.student.id} inShortlist={inShortlist} />}
          </>
        }
      />
      <SourceNote sourceUrl={p.sourceUrl} lastVerifiedAt={p.lastVerifiedAt} indicative={p.indicative} prefs={prefs} checkedBy={verifier ? pick(locale, verifier.user.nameEn, verifier.user.nameAr) : null} />
      {notes && <p className="text-sm text-muted-foreground">{notes}</p>}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 lg:col-span-2">
          {focus.student && check && (
            <Panel>
              <PanelHeader
                title={ctx.isStudent ? t("checker.titleSelf") : t("checker.title")}
                icon={<ClipboardCheck className="size-4" />}
                description={t("checker.desc", { curriculum: t(`curriculum.${check.curriculum}`) })}
                action={<CheckSummary check={check} />}
              />
              {!check.listed && <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs">{t("checker.notListed")}</p>}
              <CheckTable check={check} prefs={prefs} />
              {check.classesToTake.length > 0 && (
                <div className="mt-4 rounded-lg border p-3" data-testid="classes-to-take">
                  <div className="mb-1 text-sm font-medium">{t("checker.classes")}</div>
                  <ul className="space-y-1 text-sm">
                    {check.classesToTake.map((c) => (
                      <li key={c.code} className="flex flex-wrap items-center gap-2">
                        <span>{subjectLabel(t, c.code)}</span>
                        <Pill tone={c.required ? "danger" : "neutral"}>{c.required ? t("checker.required") : t("checker.recommended")}</Pill>
                        {c.offered === false && <span className="text-xs text-muted-foreground">{t("checker.notOffered")}</span>}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0">
                    <Link href="/subjects">{t("checker.goSubjects")}</Link>
                  </Button>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">{t("checker.disclaimer")}</p>
                <Button asChild variant="outline" size="sm">
                  <Link href={link("/career/universities/results")}>{t("checker.editResults")}</Link>
                </Button>
              </div>
            </Panel>
          )}
          {focus.student && (
            <Panel>
              <PanelHeader title={t("advice.title")} icon={<Sparkles className="size-4" />} description={t("advice.desc")} />
              <AdvicePanel programId={p.id} studentId={focus.student.id} />
            </Panel>
          )}
          <Panel>
            <PanelHeader title={t("requirementsByCurriculum")} description={t("requirementsHint")} />
            <div className="grid gap-3 sm:grid-cols-2">
              {REQ_CURRICULA.map((c) => {
                const lines = requirementLines(t, c, req, fmt);
                const note = curriculumNote(c, req, locale);
                return (
                  <div key={c} className={cn("rounded-lg border p-3 text-sm", own === c && "border-brand bg-brand-soft/40 ring-1 ring-brand/30")} data-testid={`req-${c}`}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-medium">{t(`curriculum.${c}`)}</span>
                      {own === c && <Pill tone="brand">{t("yourCurriculum")}</Pill>}
                    </div>
                    {lines.length || note ? (
                      <>
                        {lines.map((l, i) => (
                          <div key={i}>{l}</div>
                        ))}
                        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("notListed")}</p>
                    )}
                  </div>
                );
              })}
            </div>
            {(p.requiredSubjects.length > 0 || p.recommendedSubjects.length > 0) && (
              <div className="mt-3 space-y-1 text-sm">
                {p.requiredSubjects.length > 0 && <div>{t("requiredSubjects", { subjects: p.requiredSubjects.map((s) => subjectLabel(t, s)).join(t("req.sep")) })}</div>}
                {p.recommendedSubjects.length > 0 && <div className="text-muted-foreground">{t("recommendedSubjects", { subjects: p.recommendedSubjects.map((s) => subjectLabel(t, s)).join(t("req.sep")) })}</div>}
              </div>
            )}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t("route.title")} icon={<Route className="size-4" />} />
            <div className="space-y-2 text-sm">
              <div className="font-medium">{req.route ? t(`route.${req.route.via}`) : uni.applyVia ? t(`route.${uni.applyVia}`) : t("uni.checkSite")}</div>
              {(req.route?.deadlines ?? []).length > 0 ? (
                <ul className="space-y-1" data-testid="deadlines">
                  {req.route!.deadlines!.map((d, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{t(`deadline.${d.kind}`)}</span>
                      <span>{fmtDate(prefs, nextOccurrence(d.month, d.day ?? 15))}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("noDeadline")}</p>
              )}
              {(req.admissionsTests ?? []).length > 0 && <div>{t("admissionsTests", { tests: req.admissionsTests!.map((x) => testLabel(t, x)).join(t("req.sep")) })}</div>}
              {req.route?.url && (
                <a href={req.route.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                  {t("route.portal")}
                  <ExternalLink className="size-3" />
                </a>
              )}
              <p className="text-xs text-muted-foreground">{t("deadlineHint")}</p>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title={t("english")} icon={<Languages className="size-4" />} />
            {enLines.length ? (
              <ul className="space-y-1 text-sm">
                {enLines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("englishNotListed")}</p>
            )}
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
