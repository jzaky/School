import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookOpen, CalendarRange, ChevronLeft, ExternalLink, ListChecks, Quote, Scale } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { StudentPicker } from "@/components/pathways/pathway-client";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { ConfidenceBadge, LineStatusIcon, StatusChip } from "@/components/pathway-engine/ui";
import { lineText, subjectList, type Tr } from "@/components/pathway-engine/labels";
import { engineFocus, pathwayHref, subjectNames } from "@/server/pathway-engine/page-data";
import { getCurrentPlan, getProgramDetail, loadStudentProfile } from "@/server/pathway-engine/service";
import { evaluate } from "@/server/pathway-engine/evaluate";
import type { EvalResult, LineResult, RequirementRow, StudentProfile } from "@/server/pathway-engine/types";

export async function generateMetadata() {
  const t = await getTranslations("engine");
  return { title: t("program.title") };
}

const emptyProfile = (curriculum: string): StudentProfile => ({ curriculum: curriculum as StudentProfile["curriculum"], gradeLevel: 12, courses: [], overall: {}, tests: [] });

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ student?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getCtx();
  if (!ctx.can("pathways.view")) notFound();
  const t = await getTranslations("engine");
  const tr = t as unknown as Tr;
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const { locale } = ctx;
  const detail = await getProgramDetail(ctx.db, ctx.orgId, id);
  if (!detail) notFound();
  const { meta, program, intakes } = detail;
  const focus = await engineFocus(ctx, sp.student);
  const names = await subjectNames(ctx);
  let result: EvalResult | null = null;
  if (focus.student) {
    const plan = await getCurrentPlan(focus.actor, focus.student.id);
    const loaded = await loadStudentProfile(focus.actor, focus.student.id, { planId: plan?.id ?? null });
    result = evaluate(loaded.profile, program);
  }
  const rowsById = new Map(program.requirements.map((r) => [r.id, r]));
  const ownRows = result ? result.rowIds.map((r) => rowsById.get(r)!).filter(Boolean) : [];
  const otherRows = program.requirements.filter((r) => !ownRows.includes(r));
  const describe = (r: RequirementRow): LineResult[] => evaluate(emptyProfile(r.curriculum ?? "OTHER"), { id: program.id, requirements: [r] }).lines;
  const rowTitle = (r: RequirementRow) => (r.curriculum ? t(`curriculum.${r.curriculum}`) : t("program.general"));
  const back = focus.student ? pathwayHref(ctx, focus.student.id) : "/career/pathways";
  const checkedAt = program.requirements.map((r) => r.checkedAt).find(Boolean);
  const sourceUrl = program.requirements.map((r) => r.sourceUrl).find(Boolean) ?? meta.sourceUrl;
  const confidence = program.requirements[0]?.confidence ?? "UNKNOWN";

  const LineRow = ({ l, rows, withStatus }: { l: LineResult; rows: RequirementRow[]; withStatus: boolean }) => (
    <li className="flex gap-2.5 py-2.5" data-testid="req-line" data-status={withStatus ? l.status : undefined}>
      {withStatus ? <LineStatusIcon status={l.status} advisory={l.advisory} className="mt-0.5" /> : <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium">{lineText(tr, l, names, locale, rows)}</span>
          {l.advisory && <Pill>{l.kind === "additional" ? t("program.step") : t("program.advice")}</Pill>}
        </div>
        {withStatus && l.satisfiedBy && l.satisfiedBy.length > 0 && l.status !== "not_met" && (
          <div className="text-xs text-muted-foreground">
            {t("program.satisfiedBy", {
              courses: l.satisfiedBy.map((c) => `${pick(locale, c.nameEn, c.nameAr)}${c.grade ? ` (${c.grade})` : ""}`).join(t("line.and")),
            })}
            {l.basis && <Pill className="ms-1.5">{t(`basis.${l.basis}`)}</Pill>}
          </div>
        )}
        {withStatus && l.status === "met" && !l.satisfiedBy?.length && l.basis && <div className="text-xs text-muted-foreground">{t(`basis.${l.basis}`)}{l.have !== null && l.have !== undefined ? `: ${l.have}` : ""}</div>}
        {withStatus && l.status === "not_met" && !l.advisory && (
          <div className="text-xs text-danger">{l.have !== null && l.have !== undefined && l.have !== "" ? t("program.have", { have: String(l.have) }) : t("program.missing")}</div>
        )}
        {withStatus && l.status === "unknown" && l.reason && <div className="text-xs text-info">{t(`reason.${l.reason}`)}</div>}
        {(l.noteEn || l.noteAr) && <div className="text-xs text-muted-foreground">{pick(locale, l.noteEn ?? "", l.noteAr ?? l.noteEn ?? "")}</div>}
        {l.evidenceQuote && (
          <div className="flex items-start gap-1 text-xs text-muted-foreground" data-testid="evidence-quote">
            <Quote className="mt-0.5 size-3 shrink-0" />
            <q className="italic">{l.evidenceQuote}</q>
          </div>
        )}
      </div>
    </li>
  );

  return (
    <PageBody>
      <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>
      <PageHeader
        eyebrow={`${pick(locale, meta.university.nameEn, meta.university.nameAr)} · ${pick(locale, meta.university.cityEn, meta.university.cityAr)}, ${countryLabel(meta.university.countryCode, locale)}`}
        title={pick(locale, meta.nameEn, meta.nameAr)}
        description={t("program.meta", { degree: meta.degree, years: fmt(meta.durationYears), language: meta.teachingLanguage ? t(`language.${meta.teachingLanguage}`) : "-" })}
        actions={
          <>
            {focus.options.length > 0 && focus.student && <StudentPicker students={focus.options} current={focus.student.id} />}
            <Button asChild variant="outline" size="sm">
              <Link href={`/career/universities/programs/${meta.id}`}>{t("program.browser")}</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <div className="text-xs text-muted-foreground">{t("program.tuition")}</div>
          <div className="mt-1 text-sm font-medium">{meta.tuitionPerYear !== null && meta.tuitionCurrency ? t("program.tuitionValue", { amount: fmt(meta.tuitionPerYear), currency: meta.tuitionCurrency }) : t("program.tuitionUnknown")}</div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" />
            {t("program.intakes")}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5" data-testid="intakes">
            {intakes.length ? intakes.map((i) => <Pill key={i.intakeYear}>{t("program.intake", { year: String(i.intakeYear) })}</Pill>) : <span className="text-sm">{t("program.noIntakes")}</span>}
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-muted-foreground">{t("program.source")}</div>
          <div className="mt-1 space-y-1.5 text-sm">
            <ConfidenceBadge confidence={confidence} />
            <div className="text-xs text-muted-foreground">{checkedAt ? t("program.checked", { date: fmtDate(prefs, checkedAt) }) : t("program.notChecked")}</div>
            {sourceUrl && (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline" data-testid="source-link">
                {t("program.openSource")}
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </Panel>
      </div>
      {confidence === "EXAMPLE" && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm" data-testid="example-label">
          {t("program.exampleNote")}
        </p>
      )}

      {program.requirements.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted-foreground">{t("program.noRows")}</p>
        </Panel>
      ) : focus.student && result ? (
        <Panel>
          <PanelHeader
            title={ctx.isStudent ? t("program.forYou") : t("program.forStudent", { name: focus.student.name })}
            icon={<ListChecks className="size-4" />}
            description={t("program.forCurriculum", { curriculum: t(`curriculum.${focus.student.curriculum}`) })}
            action={<StatusChip status={result.status} />}
          />
          {!result.covered && <p className="mb-3 rounded-lg bg-warning-soft/50 px-3 py-2 text-sm">{t("program.notCovered")}</p>}
          <p className="mb-2 text-xs text-muted-foreground">{t(`statusHint.${result.status}`)}</p>
          {ownRows.map((r) => (
            <div key={r.id} className="border-t pt-3 first-of-type:border-t-0" data-testid={`row-${r.curriculum ?? "GENERAL"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{rowTitle(r)}</h3>
                <span className="text-xs text-muted-foreground">{t("program.version", { version: r.version, year: String(r.intakeYear) })}</span>
              </div>
              {(r.notesEn || r.notesAr) && <p className="mt-1 text-xs text-muted-foreground">{pick(locale, r.notesEn ?? "", r.notesAr ?? "")}</p>}
              <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground" data-testid="evidence">
                <Quote className="mt-0.5 size-3 shrink-0" />
                {r.evidenceLocator ? t("program.evidence", { where: r.evidenceLocator }) : t("program.evidenceNone")}
              </p>
              <ul className="divide-y">
                {result!.lines
                  .filter((l) => l.rowId === r.id)
                  .map((l) => (
                    <LineRow key={l.id} l={l} rows={ownRows} withStatus />
                  ))}
              </ul>
            </div>
          ))}
          {(result.classesToTake.length > 0 || result.scoreGaps.length > 0) && (
            <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
              {result.classesToTake.length > 0 && (
                <div data-testid="classes-to-take">
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                    <BookOpen className="size-4" />
                    {t("program.classesToTake")}
                  </div>
                  <ul className="space-y-1 text-sm">
                    {result.classesToTake.map((c) => (
                      <li key={c.lineId}>{t("program.classLine", { subjects: subjectList(c.subjectKeys, names, locale, tr), level: c.minimumLevel ? t(`level.${c.minimumLevel}`) : "-" })}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.scoreGaps.length > 0 && (
                <div data-testid="score-gaps">
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                    <Scale className="size-4" />
                    {t("program.scoreGaps")}
                  </div>
                  <ul className="space-y-1 text-sm">
                    {result.scoreGaps.map((g) => (
                      <li key={g.lineId}>{t("program.gapLine", { kind: t.has(`test.${g.kind}`) ? t(`test.${g.kind}`) : t.has(`kind.${g.kind.toLowerCase()}`) ? t(`kind.${g.kind.toLowerCase()}`) : g.kind, have: fmt(g.have), required: fmt(g.required) })}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">{t("program.disclaimer")}</p>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title={t("program.requirements")} icon={<ListChecks className="size-4" />} description={t("program.pickStudent")} />
        </Panel>
      )}

      {otherRows.length > 0 && (
        <Panel>
          <PanelHeader title={focus.student ? t("program.otherCurricula") : t("program.requirements")} description={t("program.otherDesc")} />
          <div className="grid gap-3 md:grid-cols-2">
            {otherRows.map((r) => (
              <div key={r.id} className="rounded-lg border p-3" data-testid={`other-${r.curriculum ?? "GENERAL"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{rowTitle(r)}</h3>
                  <ConfidenceBadge confidence={r.confidence} />
                </div>
                <ul className="divide-y">
                  {describe(r).map((l) => (
                    <LineRow key={l.id} l={l} rows={[r]} withStatus={false} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </PageBody>
  );
}
