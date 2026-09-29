import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AlertTriangle, BarChart3, BookOpenCheck, ClipboardList, Eye, Layers, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { StatCard } from "@/components/app/stat-card";
import { Panel, PanelHeader } from "@/components/app/panel";
import { GradebookGrid } from "@/components/grades/gradebook-grid";
import { NewAssessmentButton, type AssessmentRow, type TermOption } from "@/components/grades/assessment-dialog";
import { BandSettings, ClassPicker } from "@/components/grades/grade-controls";
import { FamilyGrades, bandTone } from "@/components/grades/family-view";
import { canUseGradebook, defaultTerm, familyGrades, gradebookClasses, loadBands, loadGradebook, staffOverview, termFor, termHasPublished, viewerFromCtx } from "@/server/grades/queries";

export async function generateMetadata() {
  const t = await getTranslations("grades");
  return { title: t("title") };
}

type SP = { class?: string; view?: string; term?: string; student?: string; assessment?: string; below?: string };

export default async function GradesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const v = viewerFromCtx(ctx);
  const t = await getTranslations("grades");
  const prefs = await formatPrefs(ctx);
  const { locale } = ctx;

  // Students and parents: published grades only.
  if (ctx.isStudent || ctx.isParent) {
    if (!ctx.can("grades.view_own")) notFound();
    const children = ctx.isParent ? (ctx.membership.guardian?.links.map((l) => l.student) ?? []).filter((s) => s.status === "ACTIVE") : [];
    const studentId = ctx.isStudent ? ctx.membership.student?.id : sp.student && v.familyStudentIds.includes(sp.student) ? sp.student : children[0]?.id;
    const data = studentId ? await familyGrades(v, studentId, sp.term) : null;
    return (
      <PageBody>
        <PageHeader title={t("title")} description={ctx.isParent && data ? t("subtitleParent", { name: personName(data.student, locale) }) : t("subtitleStudent")} />
        {!data ? (
          <EmptyState icon={<BookOpenCheck className="size-5" />} title={t("familyEmpty")} body={t("noChildren")} />
        ) : (
          <FamilyGrades
            data={data}
            prefs={prefs}
            kids={children.map((c) => ({ id: c.id, name: personName(c, locale), grade: c.gradeLevel }))}
            activeChildId={data.student.id}
            highlight={sp.assessment}
            reportAvailable={!!data.term && (await termHasPublished(ctx.db, data.student.id, data.term.id))}
            isParent={ctx.isParent}
          />
        )}
      </PageBody>
    );
  }

  if (!canUseGradebook(v)) notFound();
  const canOverview = ctx.can("grades.view_all");
  const views = [
    { value: "gradebook", label: t("viewGradebook") },
    ...(canOverview ? [{ value: "overview", label: t("viewOverview") }] : []),
    { value: "bands", label: t("viewBands") },
  ];
  const view = views.some((x) => x.value === sp.view) ? sp.view! : "gradebook";

  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitleStaff")} />
      <FilterBar tabs={views} tabParam="view" />
      {view === "bands" ? <BandsView canEdit={ctx.can("school.manage")} /> : view === "overview" ? <OverviewView sp={sp} /> : <GradebookView sp={sp} />}
    </PageBody>
  );

  async function BandsView({ canEdit }: { canEdit: boolean }) {
    const { bands, custom } = await loadBands(ctx.db);
    return (
      <Panel className="max-w-xl">
        <PanelHeader title={t("bandsTitle")} description={t("bandsBody")} icon={<Layers className="size-4" />} />
        <BandSettings bands={bands} custom={custom} canEdit={canEdit} />
      </Panel>
    );
  }

  async function GradebookView({ sp }: { sp: SP }) {
    const classes = await gradebookClasses(v);
    if (!classes.length) return <EmptyState icon={<ClipboardList className="size-5" />} title={t("noClasses")} body={t("noClassesBody")} />;
    const selected = classes.find((c) => c.id === sp.class) ?? classes.find((c) => c.mine) ?? classes[0];
    const book = await loadGradebook(v, selected.id);
    if (!book) return <EmptyState icon={<ClipboardList className="size-5" />} title={t("noAccess")} body={t("noAccessBody")} />;

    const mine = classes.filter((c) => c.mine);
    const others = classes.filter((c) => !c.mine);
    const optionLabel = (c: (typeof classes)[number]) => `${pick(locale, c.nameEn, c.nameAr)}${c.teacher && !c.mine ? ` · ${pick(locale, c.teacher.en, c.teacher.ar)}` : ""}`;
    const groups = [
      ...(mine.length ? [{ label: t("myClasses"), options: mine.map((c) => ({ value: c.id, label: optionLabel(c) })) }] : []),
      ...(others.length ? [{ label: mine.length ? t("otherClasses") : t("allClasses"), options: others.map((c) => ({ value: c.id, label: optionLabel(c) })) }] : []),
    ];

    const terms: TermOption[] = book.terms.map((tt) => ({ id: tt.id, label: pick(locale, tt.nameEn, tt.nameAr), startsOn: tt.startsOn.toISOString(), endsOn: tt.endsOn.toISOString() }));
    const current = defaultTerm(book.terms);
    const termOf = (a: (typeof book.assessments)[number]) => a.termId ?? termFor(book.terms, a.dueAt ?? a.createdAt)?.id ?? null;
    const termId = sp.term === "all" ? null : sp.term && book.terms.some((x) => x.id === sp.term) ? sp.term : (current?.id ?? null);
    const visible = book.assessments.filter((a) => !termId || termOf(a) === termId);
    const rows: AssessmentRow[] = visible.map((a) => ({
      id: a.id,
      titleEn: a.titleEn,
      titleAr: a.titleAr,
      kind: a.kind,
      maxScore: a.maxScore,
      weight: a.weight,
      dueAt: a.dueAt ? a.dueAt.toISOString().slice(0, 10) : null,
      dueLabel: a.dueAt ? fmtDate(prefs, a.dueAt, "short") : null,
      termId: a.termId,
      publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    }));
    const grades = visible.flatMap((a) => a.grades.map((g) => ({ assessmentId: a.id, studentId: g.studentId, score: g.score, excused: g.excused, comment: (locale === "ar" ? g.commentAr || g.commentEn : g.commentEn || g.commentAr) ?? "" })));
    const drafts = visible.filter((a) => !a.publishedAt).length;
    const termChips = [
      ...book.terms.map((tt) => ({ value: tt.id === current?.id ? "" : tt.id, label: pick(locale, tt.nameEn, tt.nameAr) })),
      { value: "all", label: t("allTerms") },
    ];

    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ClassPicker value={selected.id} groups={groups} />
          {book.canEdit ? (
            <NewAssessmentButton classId={book.cls.id} terms={terms} defaultTermId={termId ?? current?.id ?? null} />
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{pick(locale, book.cls.nameEn, book.cls.nameAr)}</h2>
            <p className="text-sm text-muted-foreground">
              {[book.teacher ? pick(locale, book.teacher.en, book.teacher.ar) : null, t("studentsCount", { count: book.students.length }), t("assessmentsCount", { count: visible.length }), drafts ? t("draftsCount", { count: drafts }) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <FilterBar chips={termChips} chipParam="term" />
        </div>
        {!book.canEdit && (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="view-only">
            <Eye className="mt-0.5 size-4 shrink-0" />
            {t("viewOnlyBody")}
          </div>
        )}
        {book.students.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title={t("noStudents")} body={t("noStudentsBody")} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-5" />} title={t("noAssessments")} body={book.canEdit ? t("noAssessmentsBody") : t("noAssessmentsView")} />
        ) : (
          <GradebookGrid
            key={`${book.cls.id}:${termId ?? "all"}`}
            classId={book.cls.id}
            canEdit={book.canEdit}
            locale={locale}
            students={book.students.map((s) => ({ id: s.id, name: personName(s, locale), studentNo: s.studentNo }))}
            assessments={rows}
            grades={grades}
            bands={book.bands}
            terms={terms}
            defaultTermId={current?.id ?? null}
            termId={termId}
          />
        )}
      </div>
    );
  }

  async function OverviewView({ sp }: { sp: SP }) {
    const threshold = [50, 60, 70].includes(Number(sp.below)) ? Number(sp.below) : 60;
    const data = await staffOverview(v, threshold);
    if (!data) notFound();
    const pct = (n: number | null) => (n === null ? "-" : `${fmtNumber(prefs, n, { maximumFractionDigits: 1 })}%`);
    const canProfile = ctx.can("people.view");
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t("schoolAverage")} value={pct(data.overall)} icon={<BarChart3 className="size-4" />} />
          <StatCard label={t("classesTracked")} value={fmtNumber(prefs, data.classes.filter((c) => c.assessments > 0).length)} hint={t("ofClasses", { count: data.classes.length })} icon={<ClipboardList className="size-4" />} tone="info" />
          <StatCard label={t("belowThreshold", { threshold })} value={fmtNumber(prefs, new Set(data.below.map((b) => b.studentId)).size)} hint={t("belowHint")} icon={<AlertTriangle className="size-4" />} tone={data.below.length ? "warning" : "success"} testId="below-count" />
        </div>
        <Panel padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader title={t("bySubject")} description={t("bySubjectBody")} />
          </div>
          {data.subjects.length === 0 ? (
            <div className="p-5 pt-0">
              <EmptyState title={t("noClasses")} body={t("noClassesBody")} />
            </div>
          ) : (
            <ul className="divide-y border-t">
              {data.subjects.map((s) => (
                <li key={s.code} className="grid gap-3 px-5 py-3 md:grid-cols-[200px_minmax(0,1fr)] md:items-center" data-testid="overview-subject">
                  <div className="flex items-center justify-between gap-2 md:block">
                    <div className="text-sm font-medium">{pick(locale, s.en, s.ar)}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{pct(s.average)}</span>
                      {s.band && <span dir="ltr" className={cn("rounded px-1.5 py-0.5 font-semibold", bandTone(s.band, data.bands))}>{s.band}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {s.classes.map((c) => (
                      <Link key={c.id} href={`/grades?class=${c.id}`} className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs hover:border-brand/30 hover:bg-muted/40">
                        <span className="font-medium">{t("gradeLevel", { grade: c.gradeLevel })}</span>
                        <span className="h-1.5 w-14 rounded-full bg-muted">
                          <span className="block h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, c.average ?? 0))}%` }} />
                        </span>
                        <span className="tabular-nums">{pct(c.average)}</span>
                        {c.below > 0 && <span className="rounded bg-warning-soft px-1 text-[oklch(0.55_0.14_65)]">{t("belowShort", { count: c.below })}</span>}
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel padded={false}>
          <div className="flex flex-col gap-3 p-5 pb-3 sm:flex-row sm:items-start sm:justify-between">
            <PanelHeader title={t("supportTitle")} description={t("supportBody")} />
            <FilterBar chips={[50, 60, 70].map((n) => ({ value: n === 60 ? "" : String(n), label: t("belowChip", { threshold: n }) }))} chipParam="below" />
          </div>
          {data.below.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title={t("noneBelow")} body={t("noneBelowBody", { threshold })} />
            </div>
          ) : (
            <ul className="divide-y border-t">
              {data.below.slice(0, 25).map((b) => (
                <li key={`${b.studentId}:${b.classId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5" data-testid="below-row">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {canProfile ? (
                        <Link href={`/students/${b.studentId}`} className="hover:text-brand">
                          {personName(b.student, locale)}
                        </Link>
                      ) : (
                        personName(b.student, locale)
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      <Link href={`/grades?class=${b.classId}`} className="hover:text-brand">
                        {pick(locale, b.cls.nameEn, b.cls.nameAr)}
                      </Link>
                      {b.cls.teacher ? ` · ${pick(locale, b.cls.teacher.en, b.cls.teacher.ar)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">{pct(b.average)}</span>
                    <span dir="ltr" className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", bandTone(b.band, data.bands))}>{b.band ?? "-"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.below.length > 25 && <p className="border-t px-5 py-2 text-xs text-muted-foreground">{t("moreBelow", { count: data.below.length - 25 })}</p>}
        </Panel>
      </div>
    );
  }
}
