// Server views for transcript import, the course record, the school course catalog and the counselor
// dashboard. Pages under /career/pathways are thin wrappers around these.
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, BookMarked, CalendarClock, ClipboardList, FileSpreadsheet, FileText, GitCompareArrows, GraduationCap, Inbox, LayoutDashboard, Library, ListChecks, Route, Upload } from "lucide-react";
import type { SchoolCurriculum } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { personName, pick, userName } from "@/lib/i18n-data";
import { fmtDate, fmtNumber } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Button } from "@/components/ui/button";
import { actorFromCtx } from "@/server/pathway-engine/access";
import { subjectNames, type EngineFocus } from "@/server/pathway-engine/page-data";
import { CURRICULA, type LineResult } from "@/server/pathway-engine/types";
import { canUpload, canViewRecord } from "@/server/transcripts/access";
import { getCourseRecord, getImport, listImports } from "@/server/transcripts/service";
import { canManageCatalog, listSchoolCatalog } from "@/server/transcripts/catalog";
import { loadDashboard, type DashboardFilters } from "@/server/transcripts/dashboard";
import { loadCards, PRE_SUBMISSION_STAGES } from "@/server/applications/page-data";
import { lineText, STATUS_ORDER, subjectList, type Tr } from "@/components/pathway-engine/labels";
import { StatusChip } from "@/components/pathway-engine/ui";
import { EngineHeader } from "@/components/pathway-engine/views";
import { ConfidenceMeter, CourseStatusChip, MappingChip, SourceChip } from "./ui";
import { CommitButton, NewImportForm, RowActions } from "./import-client";
import { AddCourseButton, RecordRowMenu, UseAverageButton } from "./record-client";
import { AddSchoolCourse, CatalogRowControls } from "./catalog-client";
import { DashboardFilters as DashFilterBar, InlinePlanReview, RecomputeButton } from "./dashboard-client";

const studentHref = (id: string) => `/career/pathways/${id}`;

/** Staff pages link here; students use the short path. */
export const recordHref = (ctx: Ctx, studentId: string) => (ctx.isStudent ? "/career/pathways/courses" : `/career/pathways/${studentId}/courses`);

function StaffLinks({ current, canCatalog, canDash }: { current: "dashboard" | "imports" | "catalog"; canCatalog: boolean; canDash: boolean }) {
  return <StaffLinksInner current={current} canCatalog={canCatalog} canDash={canDash} />;
}

async function StaffLinksInner({ current, canCatalog, canDash }: { current: string; canCatalog: boolean; canDash: boolean }) {
  const t = await getTranslations("transcripts.links");
  const links = [
    ...(canDash ? [{ key: "dashboard", href: "/career/pathways/dashboard", icon: <LayoutDashboard className="size-4" /> }] : []),
    { key: "imports", href: "/career/pathways/imports", icon: <Upload className="size-4" /> },
    ...(canCatalog ? [{ key: "catalog", href: "/career/pathways/catalog", icon: <Library className="size-4" /> }] : []),
    { key: "students", href: "/career/pathways", icon: <GraduationCap className="size-4" /> },
  ].filter((l) => l.key !== current);
  return (
    <>
      {links.map((l) => (
        <Button key={l.key} asChild variant="outline" size="sm">
          <Link href={l.href} data-testid={`link-${l.key}`}>
            {l.icon}
            {t(l.key)}
          </Link>
        </Button>
      ))}
    </>
  );
}

/** Header links on the staff student list (/career/pathways). */
export function StaffPathwayLinks({ ctx }: { ctx: Ctx }) {
  const dash = ctx.can("planner.approve") || ctx.can("pathways.manage");
  if (!dash) return null;
  return <StaffLinksInner current="students" canCatalog={ctx.can("pathways.manage")} canDash />;
}

// ---------------------------------------------------------------------------------------------
// Imports list and new import

export async function ImportsView({ ctx, studentParam }: { ctx: Ctx; studentParam: string | null }) {
  if (ctx.isParent || !ctx.can("pathways.view")) notFound();
  const t = await getTranslations("transcripts");
  const prefs = await formatPrefs(ctx);
  const actor = await actorFromCtx(ctx);
  const selfId = ctx.isStudent ? (ctx.membership.student?.id ?? null) : null;
  if (!ctx.isStudent && !ctx.can("pathways.manage") && !ctx.can("planner.approve")) notFound();
  const manage = !ctx.isStudent && ctx.can("pathways.manage");
  const [imports, students] = await Promise.all([
    listImports(actor),
    ctx.isStudent
      ? ctx.db.student.findMany({ where: { id: selfId ?? "none", orgId: ctx.orgId } })
      : ctx.db.student.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", gradeLevel: { gte: 6 } }, orderBy: [{ gradeLevel: "desc" }, { lastNameEn: "asc" }], take: 600 }),
  ]);
  const names = new Map(students.map((s) => [s.id, personName(s, ctx.locale)]));
  const missing = imports.map((i) => i.studentId).filter((id): id is string => !!id && !names.has(id));
  if (missing.length) for (const s of await ctx.db.student.findMany({ where: { id: { in: missing }, orgId: ctx.orgId } })) names.set(s.id, personName(s, ctx.locale));
  const opts = students.map((s) => ({ id: s.id, label: personName(s, ctx.locale), grade: s.gradeLevel, curriculum: s.curriculum }));
  const self = ctx.isStudent ? (opts[0] ?? null) : null;
  const showForm = manage || (ctx.isStudent && !!self && canUpload(actor, self.id));
  return (
    <PageBody>
      <PageHeader title={t("imports.title")} description={ctx.isStudent ? t("imports.subtitleStudent") : t("imports.subtitle")} actions={ctx.isStudent ? undefined : <StaffLinks current="imports" canCatalog={ctx.can("pathways.manage")} canDash />} />
      <div className="grid gap-4 lg:grid-cols-5 [&>*]:min-w-0">
        {showForm && (
          <Panel className="lg:col-span-3">
            <PanelHeader title={t("new.title")} icon={<Upload className="size-4" />} description={ctx.isStudent ? t("new.descStudent") : t("new.desc")} />
            <NewImportForm students={ctx.isStudent ? null : opts.filter((o) => o.grade >= 8)} self={self} initialStudentId={studentParam && names.has(studentParam) ? studentParam : null} />
          </Panel>
        )}
        <Panel className={showForm ? "lg:col-span-2" : "lg:col-span-5"}>
          <PanelHeader title={t("imports.recent")} icon={<ClipboardList className="size-4" />} description={t("imports.recentDesc")} />
          {imports.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="size-5" />} title={t("imports.empty")} body={ctx.isStudent ? t("imports.emptyStudent") : t("imports.emptyBody")} />
          ) : (
            <ul className="divide-y" data-testid="import-list">
              {imports.map((i) => (
                <li key={i.id}>
                  <Link href={`/career/pathways/imports/${i.id}`} className="flex items-start gap-3 py-2.5 hover:bg-muted/30" data-testid="import-row">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{i.studentId ? (names.get(i.studentId) ?? "") : ""}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.fileName === "manual" ? t("imports.manual") : i.fileName} · {fmtDate(prefs, i.createdAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={i.status === "COMPLETED" ? "success" : "warning"} dot>
                        {t(`importStatus.${i.status}`)}
                      </Pill>
                      {i.needsReview > 0 && <span className="text-xs text-[oklch(0.55_0.14_65)]">{t("imports.needsReview", { n: i.needsReview })}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------------------------
// Mapping review

export async function ImportReviewView({ ctx, id }: { ctx: Ctx; id: string }) {
  if (ctx.isParent || !ctx.can("pathways.view")) notFound();
  const t = await getTranslations("transcripts");
  const tc = await getTranslations("engine.curriculum");
  const prefs = await formatPrefs(ctx);
  const actor = await actorFromCtx(ctx);
  const view = await getImport(actor, id).catch(() => null);
  if (!view) notFound();
  const [student, names, committer] = await Promise.all([
    ctx.db.student.findFirst({ where: { id: view.studentId, orgId: ctx.orgId } }),
    subjectNames(ctx),
    view.payload.lastCommit ? ctx.db.membership.findUnique({ where: { id: view.payload.lastCommit.byId }, include: { user: true } }) : null,
  ]);
  if (!student) notFound();
  const L = (en: string, ar: string) => pick(ctx.locale, en, ar);
  const rows = view.payload.rows;
  const needsReview = rows.filter((r) => r.decision === "NEEDS_REVIEW").length;
  const last = view.payload.lastCommit ?? null;
  const fmt = (n: number) => fmtNumber(prefs, n);
  const subjectsOf = (keys: string[]) => keys.slice(0, 4).map((k) => (names[k] ? L(names[k].en, names[k].ar) : k)).join(t("listSep"));
  return (
    <PageBody>
      <PageHeader
        eyebrow={t("review.eyebrow", { name: personName(student, ctx.locale), grade: student.gradeLevel })}
        title={t("review.title")}
        description={t("review.subtitle", { file: view.fileName === "manual" ? t("imports.manual") : view.fileName, curriculum: tc(view.payload.curriculum), date: fmtDate(prefs, view.createdAt) })}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={recordHref(ctx, student.id)} data-testid="open-record">
                <BookMarked className="size-4" />
                {t("review.openRecord")}
              </Link>
            </Button>
            {view.canManage && <CommitButton importId={view.id} needsReview={needsReview} committed={!!last} />}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="review-stats">
        {[
          { k: "rows", v: rows.length, tone: "" },
          { k: "auto", v: rows.filter((r) => r.decision === "AUTO").length, tone: "" },
          { k: "confirmed", v: rows.filter((r) => r.decision === "CONFIRMED" || r.decision === "LOCAL").length, tone: "" },
          { k: "needsReview", v: needsReview, tone: needsReview ? "text-[oklch(0.55_0.14_65)]" : "" },
        ].map((s) => (
          <div key={s.k} className="rounded-xl border bg-card p-3 shadow-xs">
            <div className={cn("text-2xl font-semibold tabular-nums", s.tone)}>{fmt(s.v)}</div>
            <div className="text-xs text-muted-foreground">{t(`review.stat.${s.k}`)}</div>
          </div>
        ))}
      </div>
      {!view.canManage && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm" data-testid="student-review-note">
          {view.status === "COMPLETED" ? t("review.studentDone") : t("review.studentWaiting")}
        </div>
      )}
      {view.problems.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t("review.problems")}</div>
            <ul className="mt-1 list-disc ps-5 text-xs">
              {view.problems.slice(0, 8).map((p, i) => (
                <li key={i}>{p.line ? t("review.problemLine", { line: p.line, problem: t(`problem.${p.code}`) }) : t(`problem.${p.code}`)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {last && (
        <div data-testid="commit-summary">
        <Panel>
          <PanelHeader
            title={t("review.lastCommit")}
            icon={<GitCompareArrows className="size-4" />}
            description={t("review.lastCommitLine", { date: fmtDate(prefs, last.at), name: committer ? userName(committer.user, ctx.locale) : "", created: last.created, updated: last.updated, skipped: last.skipped })}
          />
          {last.programs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("review.noChanges")}</p>
          ) : (
            <ul className="divide-y" data-testid="program-changes">
              {last.programs.slice(0, 10).map((p) => (
                <li key={p.programId} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-3">
                  <Link href={`/career/pathways/programs/${p.programId}?student=${view.studentId}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate text-sm font-medium">{L(p.nameEn, p.nameAr)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{L(p.uniEn, p.uniAr)}</span>
                  </Link>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <StatusChip status={p.before} />
                    <ArrowRight className="size-3.5 text-muted-foreground rtl:rotate-180" />
                    <StatusChip status={p.after} />
                    {p.missingBefore !== p.missingAfter && <span className="text-xs text-muted-foreground">{t("review.missingChange", { before: p.missingBefore, after: p.missingAfter })}</span>}
                  </span>
                </li>
              ))}
              {last.programs.length > 10 && <li className="py-2 text-xs text-muted-foreground">{t("review.morePrograms", { n: last.programs.length - 10 })}</li>}
            </ul>
          )}
        </Panel>
        </div>
      )}

      <Panel padded={false}>
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">{t("review.rowsTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("review.rowsDesc")}</p>
        </div>
        <ul className="divide-y" data-testid="review-rows">
          {rows.map((r) => {
            const course = r.courseId ? view.courses.get(r.courseId) : undefined;
            const effects = last?.rowEffects[String(r.i)] ?? [];
            const chosenByReviewer = r.decision === "CONFIRMED" && r.courseId !== r.match.courseId;
            const alternatives = r.match.alternatives
              .map((a) => ({ a, c: view.courses.get(a.courseId) }))
              .filter((x) => x.c && x.a.courseId !== r.courseId && x.a.confidence >= 0.3)
              .slice(0, 3)
              .map((x) => ({ id: x.a.courseId, label: `${L(x.c!.nameEn, x.c!.nameAr)}`, confidence: x.a.confidence }));
            const grade = r.finalGrade ? t("review.final", { grade: r.finalGrade }) : r.predictedGrade ? t("review.predicted", { grade: r.predictedGrade }) : null;
            return (
              <li key={r.i} className={cn("grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]", r.decision === "NEEDS_REVIEW" && "bg-warning-soft/20")} data-testid="review-row" data-decision={r.decision}>
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("review.onTranscript")}</div>
                  <div className="mt-0.5 break-words text-sm font-medium" dir="auto">
                    {r.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{t("review.gradeN", { grade: r.gradeLevel })}</span>
                    {r.schoolYear && <span dir="ltr">{r.schoolYear}</span>}
                    <CourseStatusChip status={r.status} />
                    {grade && <span className="font-medium text-foreground">{grade}</span>}
                    {r.curriculum !== view.payload.curriculum && <Pill>{tc(r.curriculum)}</Pill>}
                    {r.code && (
                      <span dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        {r.code}
                      </span>
                    )}
                  </div>
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("review.matchedTo")}</div>
                      {course ? (
                        <>
                          <div className="mt-0.5 text-sm font-medium">{L(course.nameEn, course.nameAr)}</div>
                          <div className="text-xs text-muted-foreground">
                            <span dir="ltr">{course.code}</span> · {tc(course.curriculum)}
                            {course.subjects.length > 0 && <> · {t("review.countsAs", { subjects: subjectsOf(course.subjects) })}</>}
                          </div>
                        </>
                      ) : (
                        <div className="mt-0.5 text-sm text-muted-foreground">{r.decision === "LOCAL" ? t("review.localOnly") : t("review.noMatch")}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <MappingChip status={r.decision} />
                      {chosenByReviewer ? <span className="text-xs text-muted-foreground">{t("review.chosen")}</span> : r.decision !== "LOCAL" && <ConfidenceMeter value={r.match.confidence} />}
                    </div>
                  </div>
                  {(effects.length > 0 || r.duplicateOf) && (
                    <div className="flex flex-wrap gap-1.5">
                      {effects.length > 0 && (
                        <Pill tone="success" dot>
                          <span data-testid="row-effect">{t("review.rowEffect", { n: effects.length })}</span>
                        </Pill>
                      )}
                      {r.duplicateOf && <Pill>{t("review.duplicate")}</Pill>}
                    </div>
                  )}
                  {view.canManage && <RowActions importId={view.id} row={r.i} curriculum={r.curriculum} hasSuggestion={!!r.courseId} decision={r.decision} alternatives={alternatives} />}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </PageBody>
  );
}

// ---------------------------------------------------------------------------------------------
// Course record

export async function CourseRecordView({ ctx, focus }: { ctx: Ctx; focus: EngineFocus }) {
  const t = await getTranslations("transcripts");
  const tc = await getTranslations("engine.curriculum");
  const s = focus.student!;
  if (!canViewRecord(focus.actor, s.id)) notFound();
  const [{ rows, canManage, imports }, names] = await Promise.all([getCourseRecord(focus.actor, s.id), subjectNames(ctx)]);
  const L = (en: string, ar: string) => pick(ctx.locale, en, ar);
  const review = rows.filter((r) => r.mappingStatus === "NEEDS_REVIEW").length;
  const grades = [...new Set(rows.map((r) => r.gradeLevel))].sort((a, b) => b - a);
  const uploadHref = ctx.isStudent ? "/career/pathways/imports" : `/career/pathways/imports?student=${s.id}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("record.title")}</h2>
          <p className="text-sm text-muted-foreground">{canManage ? t("record.descStaff") : t("record.descStudent")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpload(focus.actor, s.id) && (
            <Button asChild size="sm" variant="outline">
              <Link href={uploadHref} data-testid="record-import">
                <Upload className="size-4" />
                {ctx.isStudent ? t("record.uploadOwn") : t("record.import")}
              </Link>
            </Button>
          )}
          {canManage && <AddCourseButton studentId={s.id} curriculum={s.curriculum} defaultGrade={s.gradeLevel} />}
        </div>
      </div>
      {review > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm" data-testid="record-review-banner">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{canManage ? t("record.reviewBanner", { n: review }) : t("record.reviewBannerStudent", { n: review })}</span>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-5" />} title={t("record.empty")} body={canManage ? t("record.emptyBody") : t("record.emptyStudent")} />
      ) : (
        grades.map((g) => (
          <Panel key={g} padded={false}>
            <div className="border-b px-5 py-3 text-sm font-semibold">{t("record.gradeN", { grade: g })}</div>
            <ul className="divide-y" data-testid={`record-grade-${g}`}>
              {rows
                .filter((r) => r.gradeLevel === g)
                .map((r) => {
                  const title = r.course ? L(r.course.nameEn, r.course.nameAr) : r.localName;
                  const showLocal = r.course && r.localName !== r.course.nameEn && r.localName !== r.course.code;
                  const avg = r.average;
                  const canUseAvg = !!avg?.suggestion && avg.suggestion !== r.predictedGrade && (canManage || ctx.isStudent);
                  return (
                    <li key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:gap-4" data-testid="record-row">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium" dir="auto">
                          {title}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.course ? (
                            <>
                              <span dir="ltr">{r.course.code}</span> · {tc(r.course.curriculum)}
                              {r.course.subjects.length > 0 && <> · {t("review.countsAs", { subjects: r.course.subjects.slice(0, 3).map((k) => (names[k] ? L(names[k].en, names[k].ar) : k)).join(t("listSep")) })}</>}
                            </>
                          ) : (
                            t("record.notMapped")
                          )}
                          {showLocal && <span className="block">{t("record.asOnTranscript", { name: r.localName })}</span>}
                          {r.importId && imports.get(r.importId) && (
                            <Link href={`/career/pathways/imports/${r.importId}`} className="block hover:underline">
                              {t("record.fromImport", { file: imports.get(r.importId) === "manual" ? t("imports.manual") : imports.get(r.importId)! })}
                            </Link>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <CourseStatusChip status={r.status} />
                          <MappingChip status={r.mappingStatus} />
                          <SourceChip source={r.source} />
                          {r.schoolYear && (
                            <span className="text-xs text-muted-foreground" dir="ltr">
                              {r.schoolYear}
                            </span>
                          )}
                        </div>
                        {avg && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs" data-testid="grades-link">
                            <span>
                              {t("record.average", { subject: L(avg.subjectEn, avg.subjectAr), pct: avg.percent })}
                              {avg.suggestion ? ` ${t("record.suggests", { grade: avg.suggestion })}` : ` ${t("record.noConversion")}`}
                            </span>
                            {canUseAvg && <UseAverageButton id={r.id} suggestion={avg.suggestion!} />}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-start justify-between gap-3 sm:justify-end">
                        <dl className="grid grid-cols-2 gap-x-4 text-xs sm:text-end">
                          <dt className="text-muted-foreground">{t("record.final")}</dt>
                          <dt className="text-muted-foreground">{t("record.predicted")}</dt>
                          <dd className="text-sm font-semibold tabular-nums" dir="ltr">
                            {r.finalGrade ?? "-"}
                          </dd>
                          <dd className="text-sm font-semibold tabular-nums" dir="ltr" data-testid="predicted">
                            {r.predictedGrade ?? "-"}
                          </dd>
                        </dl>
                        <RecordRowMenu
                          row={{ id: r.id, name: title, status: r.status, gradeLevel: r.gradeLevel, schoolYear: r.schoolYear, finalGrade: r.finalGrade, predictedGrade: r.predictedGrade, mappingStatus: r.mappingStatus, hasCourse: !!r.courseId, curriculum: r.course?.curriculum ?? s.curriculum }}
                          canManage={canManage}
                          isStudent={ctx.isStudent}
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}

/** Whole page for /career/pathways/courses and /career/pathways/[studentId]/courses. */
export async function CourseRecordPage({ ctx, focus }: { ctx: Ctx; focus: EngineFocus }) {
  return (
    <PageBody>
      <EngineHeader ctx={ctx} focus={focus} tab="courses" />
      <CourseRecordView ctx={ctx} focus={focus} />
    </PageBody>
  );
}

// ---------------------------------------------------------------------------------------------
// School course catalog

export async function CatalogView({ ctx, sp }: { ctx: Ctx; sp: { track?: string; grade?: string; q?: string } }) {
  const actor = await actorFromCtx(ctx);
  if (!canManageCatalog(actor)) notFound();
  const t = await getTranslations("transcripts.catalog");
  const tc = await getTranslations("engine.curriculum");
  const [all, subjects] = await Promise.all([listSchoolCatalog(actor), ctx.db.subject.findMany({ where: { orgId: ctx.orgId }, orderBy: { nameEn: "asc" }, select: { id: true, nameEn: true, nameAr: true } })]);
  const L = (en: string | null, ar: string | null) => pick(ctx.locale, en ?? "", ar ?? "");
  const tracks = [...new Set(all.map((r) => r.curriculum))];
  const track = sp.track && tracks.includes(sp.track) ? sp.track : "all";
  const grade = Number(sp.grade) || null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = all.filter((r) => (track === "all" || r.curriculum === track) && (!grade || r.gradeLevels.includes(grade)) && (!q || r.nameEn.toLowerCase().includes(q) || r.nameAr.includes(q) || r.code.toLowerCase().includes(q)));
  const subjectOpts = subjects.map((s) => ({ value: s.id, label: L(s.nameEn, s.nameAr) }));
  const active = all.filter((r) => r.active).length;
  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <StaffLinks current="catalog" canCatalog canDash />
            <AddSchoolCourse subjects={subjectOpts} curriculum={track === "all" ? null : track} />
          </>
        }
      />
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <Route className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>{t("plannerNote", { active, inactive: all.length - active })}</span>
      </div>
      <FilterBar
        tabParam="track"
        tabs={[{ value: "all", label: t("allTracks"), count: all.length }, ...tracks.map((c) => ({ value: c, label: tc(c), count: all.filter((r) => r.curriculum === c).length }))]}
        chipParam="grade"
        chips={[{ value: "", label: t("allGrades") }, ...[9, 10, 11, 12].map((g) => ({ value: String(g), label: t("gradeN", { grade: g }) }))]}
        searchPlaceholder={t("search")}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Library className="size-5" />} title={all.length ? t("noResults") : t("empty")} body={all.length ? undefined : t("emptyBody")} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="catalog-rows">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4", !r.active && "bg-muted/30")} data-testid="catalog-row" data-active={r.active}>
              <div className="min-w-0 flex-1">
                <div className={cn("text-sm font-medium", !r.active && "text-muted-foreground")}>{L(r.nameEn, r.nameAr)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span dir="ltr">{r.code}</span>
                  <span>·</span>
                  <span>{tc(r.curriculum)}</span>
                  {r.subjectEn && (
                    <>
                      <span>·</span>
                      <span>{t("linkedSubject", { subject: L(r.subjectEn, r.subjectAr) })}</span>
                    </>
                  )}
                  {!r.isGlobal && <Pill tone="brand">{t("schoolOwn")}</Pill>}
                  {!r.active && <Pill>{t("inactive")}</Pill>}
                </div>
                {(r.notesEn || r.notesAr) && <p className="mt-1 text-xs">{L(r.notesEn, r.notesAr)}</p>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                <div className="flex flex-wrap gap-1">
                  {r.gradeLevels.map((g) => (
                    <Pill key={g} tone={r.active ? "brand" : "neutral"}>
                      {t("gradeN", { grade: g })}
                    </Pill>
                  ))}
                </div>
                <CatalogRowControls row={{ id: r.id, name: L(r.nameEn, r.nameAr), active: r.active, gradeLevels: r.gradeLevels, subjectId: r.subjectId, notesEn: r.notesEn, notesAr: r.notesAr }} subjects={subjectOpts} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}

// ---------------------------------------------------------------------------------------------
// Counselor dashboard

export async function DashboardView({ ctx, sp }: { ctx: Ctx; sp: { grade?: string; curriculum?: string; counselor?: string } }) {
  const actor = await actorFromCtx(ctx);
  if (!actor.isStaff || !(ctx.can("planner.approve") || ctx.can("pathways.manage"))) notFound();
  const t = await getTranslations("transcripts.dashboard");
  const te = await getTranslations("engine");
  const tc = await getTranslations("engine.curriculum");
  const ta = await getTranslations("applications.deadlineKind");
  const prefs = await formatPrefs(ctx);
  const now = new Date();
  const grade = [9, 10, 11, 12].includes(Number(sp.grade)) ? Number(sp.grade) : null;
  const curriculum = sp.curriculum && (CURRICULA as readonly string[]).includes(sp.curriculum) ? (sp.curriculum as SchoolCurriculum) : null;
  const filters: DashboardFilters = { grade, curriculum, counselor: sp.counselor || null };
  const d = await loadDashboard(actor, filters, now);
  const names = await subjectNames(ctx);
  const byId = new Map(d.students.map((s) => [s.id, s]));
  const nameOf = (id: string) => {
    const s = byId.get(id);
    return s ? personName(s, ctx.locale) : "";
  };
  const L = (en: string, ar: string | null) => pick(ctx.locale, en, ar ?? "");
  const fmt = (n: number) => fmtNumber(prefs, n);
  const ids = d.students.map((s) => s.id);
  const cards = ids.length ? await loadCards(ctx, prefs, { studentId: { in: ids }, stage: { in: PRE_SUBMISSION_STAGES as never } }, now) : [];
  const deadlines = cards
    .filter((c) => c.next && c.next.days !== null && c.next.days >= -1 && c.next.days <= 90)
    .sort((a, b) => a.next!.iso.localeCompare(b.next!.iso))
    .slice(0, 8);
  const proposers = await ctx.db.membership.findMany({ where: { id: { in: d.awaiting.map((a) => a.proposedById).filter((x): x is string => !!x) } }, include: { user: true } });
  const canApprove = ctx.can("planner.approve");
  const topText = (l: LineResult | null) => (l ? lineText(te as unknown as Tr, l, names, ctx.locale) : "");
  const tracks = [...new Set(d.students.map((s) => s.curriculum))];
  const studentLink = (id: string, extra?: React.ReactNode) => (
    <Link href={studentHref(id)} className="min-w-0 flex-1 hover:underline" data-testid="dash-student">
      <span className="block truncate text-sm font-medium">{nameOf(id)}</span>
      <span className="block truncate text-xs text-muted-foreground">
        {t("gradeLine", { grade: byId.get(id)?.gradeLevel ?? 0, curriculum: tc(byId.get(id)?.curriculum ?? "OTHER") })}
        {extra}
      </span>
    </Link>
  );
  const Section = ({ title, icon, desc, count, children, testid, className }: { title: string; icon: React.ReactNode; desc?: string; count: number; children: React.ReactNode; testid: string; className?: string }) => (
    <Panel className={className}>
      <PanelHeader title={title} icon={icon} description={desc} action={<Pill tone={count ? "brand" : "neutral"}>{fmt(count)}</Pill>} />
      <div data-testid={testid}>{children}</div>
    </Panel>
  );
  const none = (key: string) => <p className="text-sm text-muted-foreground">{t(key)}</p>;

  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<StaffLinks current="dashboard" canCatalog={ctx.can("pathways.manage")} canDash />} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <DashFilterBar
          grades={[9, 10, 11, 12].map((g) => ({ value: String(g), label: t("gradeN", { grade: g }) }))}
          curricula={[...new Set([...tracks, ...(curriculum ? [curriculum] : [])])].map((c) => ({ value: c, label: tc(c) }))}
          counselors={d.counselors.map((c) => ({ value: c.id, label: L(c.nameEn, c.nameAr) }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="computed-at">
            {d.lastComputedAt ? t("computedAt", { date: fmtDate(prefs, d.lastComputedAt) }) : t("neverComputed")}
          </span>
          <RecomputeButton filters={{ grade, curriculum, counselor: filters.counselor ?? null }} />
        </div>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("counts")}</h2>
          <span className="text-xs text-muted-foreground">{t("countsDesc", { students: d.studentsWithMatches, total: d.students.length })}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="dash-counts">
          {STATUS_ORDER.map((st) => (
            <div key={st} className="rounded-xl border bg-card p-3 shadow-xs">
              <div className="text-2xl font-semibold tabular-nums">{fmt(d.counts[st])}</div>
              <StatusChip status={st} className="mt-1" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section title={t("awaiting")} icon={<Inbox className="size-4" />} desc={t("awaitingDesc")} count={d.awaiting.length} testid="dash-awaiting" className="lg:col-span-2">
          {d.awaiting.length === 0
            ? none("awaitingEmpty")
            : (
                <ul className="divide-y">
                  {d.awaiting.map((a) => {
                    const by = proposers.find((p) => p.id === a.proposedById);
                    return (
                      <li key={a.planId} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-4">
                        {studentLink(a.studentId, <> · {t("planLine", { name: a.name, items: a.items, date: fmtDate(prefs, a.updatedAt) })}{by ? ` · ${t("proposedBy", { name: userName(by.user, ctx.locale) })}` : ""}</>)}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`${studentHref(a.studentId)}/plan`}>{t("openPlan")}</Link>
                          </Button>
                          {canApprove && <InlinePlanReview planId={a.planId} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
        </Section>

        <Section title={t("missing")} icon={<AlertTriangle className="size-4" />} desc={t("missingDesc")} count={d.missing.length} testid="dash-missing">
          {d.missing.length === 0
            ? none("missingEmpty")
            : (
                <ul className="divide-y">
                  {d.missing.slice(0, 12).map((m) => (
                    <li key={m.studentId} className="flex items-start gap-3 py-2.5">
                      {studentLink(m.studentId, m.top ? <span className="mt-0.5 block whitespace-normal text-danger">{t("topMissing", { text: topText(m.top), n: m.topCount })}</span> : null)}
                      <Pill tone="danger">{t("programsN", { n: m.programs, total: m.total })}</Pill>
                    </li>
                  ))}
                </ul>
              )}
        </Section>

        <Section title={t("notInPlan")} icon={<Route className="size-4" />} desc={t("notInPlanDesc")} count={d.notInPlan.length} testid="dash-not-in-plan">
          {d.notInPlan.length === 0
            ? none("notInPlanEmpty")
            : (
                <ul className="divide-y">
                  {d.notInPlan.slice(0, 12).map((n) => (
                    <li key={n.studentId} className="flex items-start gap-3 py-2.5">
                      {studentLink(n.studentId, <span className="mt-0.5 block whitespace-normal">{t("needsClasses", { classes: n.classes.map((c) => subjectList(c.subjectKeys, names, ctx.locale, te as unknown as Tr)).join(t("listSep")) })}</span>)}
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`${studentHref(n.studentId)}/plan`}>{t("openPlan")}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
        </Section>

        <Section title={t("mappings")} icon={<ListChecks className="size-4" />} desc={t("mappingsDesc")} count={d.mappings.reduce((n, m) => n + m.courses.length, 0) + d.pendingImports.reduce((n, i) => n + i.needsReview, 0)} testid="dash-mappings">
          {d.mappings.length === 0 && d.pendingImports.length === 0
            ? none("mappingsEmpty")
            : (
                <ul className="divide-y">
                  {d.pendingImports.map((i) => (
                    <li key={i.id} className="flex items-start gap-3 py-2.5">
                      {studentLink(i.studentId, <span className="mt-0.5 block">{t("pendingImport", { file: i.fileName, n: i.needsReview, rows: i.rows })}</span>)}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/career/pathways/imports/${i.id}`} data-testid="dash-review-import">
                          {t("review")}
                        </Link>
                      </Button>
                    </li>
                  ))}
                  {d.mappings.map((m) => (
                    <li key={m.studentId} className="flex items-start gap-3 py-2.5">
                      {studentLink(m.studentId, <span className="mt-0.5 block truncate">{t("coursesToCheck", { n: m.courses.length, names: m.courses.slice(0, 3).map((c) => c.name).join(t("listSep")) })}</span>)}
                      <Button asChild size="sm" variant="outline">
                        <Link href={`${studentHref(m.studentId)}/courses`}>{t("fix")}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
        </Section>

        <Section title={t("changes")} icon={<GitCompareArrows className="size-4" />} desc={t("changesDesc")} count={d.changes.length} testid="dash-changes">
          {d.changes.length === 0
            ? none("changesEmpty")
            : (
                <ul className="divide-y">
                  {d.changes.map((c) => {
                    const p = d.programNames.get(c.programId);
                    return (
                      <li key={c.id} className="space-y-1.5 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 text-sm font-medium">{p ? `${L(p.nameEn, p.nameAr)} · ${L(p.uniEn, p.uniAr)}` : ""}</span>
                          <span className="flex items-center gap-1.5">
                            {c.severity && <Pill tone={c.severity === "MAJOR" ? "danger" : c.severity === "NOTABLE" ? "warning" : "neutral"}>{t(`severity.${c.severity}`)}</Pill>}
                            <span className="text-xs text-muted-foreground">{fmtDate(prefs, c.detectedAt)}</span>
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{L(c.summaryEn, c.summaryAr)}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {c.studentIds.slice(0, 6).map((sid) => (
                            <Link key={sid} href={studentHref(sid)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">
                              {nameOf(sid)}
                            </Link>
                          ))}
                          {c.studentIds.length > 6 && <span className="text-xs text-muted-foreground">{t("more", { n: c.studentIds.length - 6 })}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
        </Section>

        <Section title={t("deadlines")} icon={<CalendarClock className="size-4" />} desc={t("deadlinesDesc")} count={deadlines.length} testid="dash-deadlines">
          {deadlines.length === 0
            ? none("deadlinesEmpty")
            : (
                <ul className="divide-y">
                  {deadlines.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 py-2.5">
                      {studentLink(c.studentId, <span className="mt-0.5 block truncate">{c.program ? `${c.university} · ${c.program}` : c.university}</span>)}
                      <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
                        <Pill tone={c.next!.bucket === "overdue" || c.next!.bucket === "urgent" ? "danger" : c.next!.bucket === "soon" ? "warning" : "neutral"}>{c.next!.date}</Pill>
                        <span className="text-muted-foreground">{ta.has(c.next!.kind) ? ta(c.next!.kind) : c.next!.kind}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          <Button asChild variant="link" size="sm" className="mt-2 h-auto px-0">
            <Link href="/career/applications/manage">
              {t("allApplications")}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Link>
          </Button>
        </Section>
      </div>
    </PageBody>
  );
}
