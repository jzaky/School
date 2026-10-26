import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlarmClock, AlertTriangle, ArrowLeft, BarChart3, FileDown, FileSpreadsheet, FileText, Lock, Percent, UserX } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { gradeLevelValues } from "@/lib/grade-levels";
import { personName, pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { FilterBar } from "@/components/app/filter-bar";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { AttendanceTabs } from "@/components/attendance/attendance-tabs";
import { ReportFilters } from "@/components/attendance/report-filters";
import { TrendBars } from "@/components/attendance/trend-bars";
import { attViewer, seesReasons } from "@/server/attendance/registers";
import { buildReport, dailyTrend, reportAccess, resolveRange, scopeAllowed, scopeFromQuery, scopeKey, studentSummary, type StudentRow } from "@/server/attendance/reports";
import { attendancePct, band, latePct, unauthorisedPct, type Tally } from "@/server/attendance/maths";
import { loadSettings, localClock } from "@/server/attendance/settings";
import { resolveCode, visibleCode } from "@/server/attendance/codes";
import { keyToDate } from "@/server/timetable/cover";

export async function generateMetadata() {
  const t = await getTranslations("attendance.reports");
  return { title: t("title") };
}

type SP = { term?: string; from?: string; to?: string; scope?: string; student?: string; view?: string; page?: string };
const PAGE = 50;

export default async function AttendanceReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const v = attViewer(ctx);
  const access = await reportAccess(v);
  if (!access) notFound();
  const t = await getTranslations("attendance.reports");
  const tg = await getTranslations("gradeLevel");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const today = localClock(new Date(), v.timezone).dateKey;
  const { range, terms } = await resolveRange(db, { termId: sp.term, from: sp.from, to: sp.to }, today);
  let scope = scopeFromQuery(sp);
  if (!access.all && scope.kind === "school") scope = access.classIds.length ? { kind: "class", classId: access.classIds[0] } : scope;
  if (!(await scopeAllowed(db, access, scope))) {
    if (!access.all && !access.classIds.length) return <NoClasses />;
    notFound();
  }
  const settings = await loadSettings(db);
  const grade = (g: number) => tg("label", gradeLevelValues(g));
  const pct = (n: number | null) => (n === null ? "-" : `${fmtNumber(prefs, n, { maximumFractionDigits: 1 })}%`);
  const n = (x: number) => fmtNumber(prefs, x);
  const periodLabel = `${fmtDate(prefs, keyToDate(range.from), "medium")} - ${fmtDate(prefs, keyToDate(range.to), "medium")}`;
  const query = new URLSearchParams();
  if (sp.term) query.set("term", sp.term);
  if (sp.from && sp.to) {
    query.set("from", sp.from);
    query.set("to", sp.to);
  }
  if (scope.kind !== "school" && scope.kind !== "student") query.set("scope", scopeKey(scope));
  if (scope.kind === "student") query.set("student", scope.studentId);
  const exportHref = (format: "csv" | "xlsx") => `/api/attendance/export?${new URLSearchParams([...query.entries(), ["format", format], ["locale", locale]]).toString()}`;

  // Scope options: the school and grades for school-wide readers, then classes.
  const classes = await db.schoolClass.findMany({
    where: { academicYear: { isCurrent: true }, ...(access.all ? { isHomeroom: true } : { id: { in: access.classIds } }) },
    select: { id: true, nameEn: true, nameAr: true, gradeLevel: true },
    orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }],
  });
  const grades = [...new Set(classes.map((c) => c.gradeLevel))].sort((a, b) => a - b);
  const scopeGroups = [
    ...(access.all ? [{ label: t("scopeSchool"), options: [{ value: "school", label: t("wholeSchool") }, ...grades.map((g) => ({ value: `g:${g}`, label: grade(g) }))] }] : []),
    { label: access.all ? t("scopeHomerooms") : t("scopeMyClasses"), options: classes.map((c) => ({ value: `c:${c.id}`, label: pick(locale, c.nameEn, c.nameAr) })) },
  ];
  const scopeValue = scope.kind === "student" ? "" : scopeKey(scope);

  const header = (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          scope.kind !== "student" ? (
            <>
              <Button variant="outline" asChild>
                <a href={exportHref("csv")} data-testid="export-csv">
                  <FileText className="size-4" />
                  {t("exportCsv")}
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={exportHref("xlsx")} data-testid="export-xlsx">
                  <FileSpreadsheet className="size-4" />
                  {t("exportXlsx")}
                </a>
              </Button>
            </>
          ) : undefined
        }
      />
      <AttendanceTabs ctx={ctx} current="reports" />
      <ReportFilters
        terms={terms.map((x) => ({ value: x.id, label: pick(locale, x.nameEn, x.nameAr) }))}
        termId={range.termId}
        from={range.from}
        to={range.to}
        custom={!range.termId}
        scopeValue={scopeValue}
        scopeGroups={scopeGroups.filter((g) => g.options.length)}
      />
    </>
  );

  if (scope.kind === "student") return <StudentView studentId={scope.studentId} />;

  const report = await buildReport(db, scope, range);
  const trend = await dailyTrend(db, scope, range);
  const view = ["students", "lateness", "unauthorised"].includes(sp.view ?? "") ? sp.view! : "overview";
  const below = report.rows.filter((r) => r.pct !== null && r.pct < settings.persistentThreshold).length;
  const scopeTitle = scope.kind === "school" ? t("wholeSchool") : scope.kind === "grade" ? grade(scope.grade) : pick(locale, classes.find((c) => c.id === scope.classId)?.nameEn, classes.find((c) => c.id === scope.classId)?.nameAr);

  return (
    <PageBody>
      {header}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold" data-testid="report-scope">{scopeTitle}</h2>
        <span className="text-sm text-muted-foreground" dir="auto">{periodLabel}</span>
      </div>
      {report.total.possible === 0 ? (
        <EmptyState icon={<BarChart3 className="size-5" />} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("statAttendance")} value={pct(report.pct)} hint={t("statStudentDays", { attended: n(report.total.attended), possible: n(report.total.possible) })} icon={<Percent className="size-4" />} tone={band(report.pct, settings.persistentThreshold) === "concern" ? "danger" : "brand"} testId="stat-attendance" />
            <StatCard label={t("statUnauthorised")} value={pct(unauthorisedPct(report.total))} hint={t("statUnauthorisedHint", { n: n(report.total.unauthorised), unexplained: n(report.total.unexplained) })} icon={<UserX className="size-4" />} tone="danger" />
            <StatCard label={t("statLate")} value={n(report.total.late)} hint={t("statLateHint", { pct: pct(latePct(report.total)), minutes: n(report.total.minutesLate) })} icon={<AlarmClock className="size-4" />} tone="warning" />
            <StatCard label={t("statBelow", { threshold: settings.persistentThreshold })} value={n(below)} hint={t("statBelowHint", { total: n(report.rows.length) })} icon={<AlertTriangle className="size-4" />} tone={below ? "warning" : "success"} href={`/attendance/reports?${new URLSearchParams([...query.entries(), ["view", "students"]]).toString()}`} />
          </div>

          {trend.length > 1 && (
            <Panel>
              <PanelHeader title={t("trendTitle")} description={t("trendBody", { threshold: settings.persistentThreshold })} icon={<BarChart3 className="size-4" />} />
              <TrendBars points={trend.map((p) => ({ day: p.day, pct: p.pct, label: fmtDate(prefs, keyToDate(p.day), "short") }))} threshold={settings.persistentThreshold} label={t("trendTitle")} fmt={(x) => fmtNumber(prefs, x, { maximumFractionDigits: 1 })} />
            </Panel>
          )}

          <FilterBar
            tabParam="view"
            tabs={[
              { value: "overview", label: t("viewOverview") },
              { value: "students", label: t("viewStudents"), count: report.rows.length },
              { value: "lateness", label: t("viewLateness") },
              { value: "unauthorised", label: t("viewUnauthorised") },
            ]}
          />
          {view === "overview" ? <Overview /> : <Students />}
        </>
      )}
    </PageBody>
  );

  function TallyCells({ tally }: { tally: Tally }) {
    const p = attendancePct(tally);
    return (
      <>
        <td className="px-3 py-2 text-end tabular-nums">
          <span className={cn("font-semibold", band(p, settings.persistentThreshold) === "concern" && "text-danger")}>{pct(p)}</span>
        </td>
        <td className="hidden px-3 py-2 text-end tabular-nums sm:table-cell">{n(tally.possible)}</td>
        <td className="hidden px-3 py-2 text-end tabular-nums md:table-cell">{n(tally.authorised)}</td>
        <td className="px-3 py-2 text-end tabular-nums">{n(tally.unauthorised)}</td>
        <td className="hidden px-3 py-2 text-end tabular-nums sm:table-cell">{n(tally.late)}</td>
      </>
    );
  }

  function TableHead({ first }: { first: string }) {
    return (
      <thead className="bg-muted/40 text-xs text-muted-foreground">
        <tr>
          <th className="px-3 py-2 text-start font-medium">{first}</th>
          <th className="px-3 py-2 text-end font-medium">{t("colAttendance")}</th>
          <th className="hidden px-3 py-2 text-end font-medium sm:table-cell">{t("colPossible")}</th>
          <th className="hidden px-3 py-2 text-end font-medium md:table-cell">{t("colAuthorised")}</th>
          <th className="px-3 py-2 text-end font-medium">{t("colUnauthorised")}</th>
          <th className="hidden px-3 py-2 text-end font-medium sm:table-cell">{t("colLate")}</th>
        </tr>
      </thead>
    );
  }

  function Overview() {
    const rows = scope.kind === "school" ? report.grades.map((g) => ({ key: g.key, label: grade(g.gradeLevel ?? 0), href: `/attendance/reports?${new URLSearchParams([...query.entries(), ["scope", `g:${g.gradeLevel}`]]).toString()}`, students: g.students, tally: g.tally })) : scope.kind === "grade" ? report.classes.map((c) => ({ key: c.key, label: pick(locale, c.label.en, c.label.ar) || t("noHomeroom"), href: c.key !== "none" ? `/attendance/reports?${new URLSearchParams([...[...query.entries()].filter(([k]) => k !== "scope"), ["scope", `c:${c.key}`]]).toString()}` : null, students: c.students, tally: c.tally })) : null;
    if (!rows) return <Students />;
    return (
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full text-sm" data-testid="rollup">
          <TableHead first={scope.kind === "school" ? t("colGrade") : t("colClass")} />
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2">
                  {r.href ? (
                    <Link href={r.href} className="font-medium hover:text-brand">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.label}</span>
                  )}
                  <span className="ms-2 text-xs text-muted-foreground">{t("studentsN", { n: n(r.students) })}</span>
                </td>
                <TallyCells tally={r.tally} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function Students() {
    const sorted = [...report.rows].sort((a, b) =>
      view === "lateness" ? b.tally.late - a.tally.late || b.tally.minutesLate - a.tally.minutesLate : view === "unauthorised" ? b.tally.unauthorised - a.tally.unauthorised : (a.pct ?? 101) - (b.pct ?? 101) || a.lastNameEn.localeCompare(b.lastNameEn),
    );
    const list = view === "lateness" ? sorted.filter((r) => r.tally.late > 0) : view === "unauthorised" ? sorted.filter((r) => r.tally.unauthorised > 0) : sorted;
    const page = Math.max(1, Number(sp.page) || 1);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const shown = list.slice((page - 1) * PAGE, page * PAGE);
    const pageHref = (p: number) => `/attendance/reports?${new URLSearchParams([...query.entries(), ["view", view], ["page", String(p)]]).toString()}`;
    if (!list.length) return <EmptyState icon={<BarChart3 className="size-5" />} title={view === "lateness" ? t("noLate") : view === "unauthorised" ? t("noUnauthorised") : t("emptyTitle")} />;
    return (
      <div className="space-y-3">
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full text-sm" data-testid="student-table">
            <TableHead first={t("colStudent")} />
            <tbody className="divide-y">
              {shown.map((r: StudentRow) => (
                <tr key={r.id} data-testid="student-row">
                  <td className="px-3 py-2">
                    <Link href={`/attendance/reports?${new URLSearchParams([...[...query.entries()].filter(([k]) => k !== "scope"), ["student", r.id]]).toString()}`} className="font-medium hover:text-brand">
                      {personName(r, locale)}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.homeroom ? pick(locale, r.homeroom.en, r.homeroom.ar) : grade(r.gradeLevel)}
                      {view === "lateness" && r.tally.minutesLate > 0 ? ` · ${t("minutesTotal", { n: n(r.tally.minutesLate) })}` : ""}
                    </div>
                  </td>
                  <TallyCells tally={r.tally} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between text-sm" data-testid="pager">
            <span className="text-muted-foreground">{t("pageOf", { page, pages, total: list.length })}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(page - 1)}>{t("previousPage")}</Link>
                </Button>
              )}
              {page < pages && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={pageHref(page + 1)}>{t("nextPage")}</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  async function StudentView({ studentId }: { studentId: string }) {
    const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, studentNo: true, gradeLevel: true, section: true } });
    if (!student) notFound();
    const s = await studentSummary(db, studentId, range);
    const reasons = seesReasons(v);
    const certificate = ctx.can("attendance.view_all") || ctx.can("attendance.manage");
    const certHref = `/api/attendance/certificate?${new URLSearchParams([["student", studentId], ["from", range.from], ["to", range.to]]).toString()}`;
    const backQuery = new URLSearchParams([...query.entries()].filter(([k]) => k !== "student")).toString();
    return (
      <PageBody>
        {header}
        <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
          <Link href={`/attendance/reports${backQuery ? `?${backQuery}` : ""}`}>
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {t("backToReport")}
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold" data-testid="report-student">{personName(student, locale)}</h2>
            <p className="text-sm text-muted-foreground">
              <span dir="ltr">{student.studentNo}</span> · {grade(student.gradeLevel)} · {periodLabel}
            </p>
          </div>
          {certificate && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={`${certHref}&lang=en`} target="_blank" rel="noopener" data-testid="certificate-en">
                  <FileDown className="size-4" />
                  {t("certificateEn")}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`${certHref}&lang=ar`} target="_blank" rel="noopener" data-testid="certificate-ar">
                  <FileDown className="size-4" />
                  {t("certificateAr")}
                </a>
              </Button>
            </div>
          )}
        </div>
        {s.tally.possible === 0 ? (
          <EmptyState icon={<BarChart3 className="size-5" />} title={t("emptyTitle")} body={t("emptyBody")} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label={t("statAttendance")} value={pct(s.pct)} hint={t("statSessions", { attended: n(s.tally.attended), possible: n(s.tally.possible) })} icon={<Percent className="size-4" />} tone={band(s.pct, settings.persistentThreshold) === "concern" ? "danger" : "brand"} testId="student-pct" />
              <StatCard label={t("statAuthorised")} value={n(s.tally.authorised)} icon={<FileText className="size-4" />} tone="info" />
              <StatCard label={t("statUnauthorisedDays")} value={n(s.tally.unauthorised)} hint={s.tally.unexplained ? t("unexplainedN", { n: n(s.tally.unexplained) }) : undefined} icon={<UserX className="size-4" />} tone="danger" />
              <StatCard label={t("statLate")} value={n(s.tally.late)} hint={t("minutesTotal", { n: n(s.tally.minutesLate) })} icon={<AlarmClock className="size-4" />} tone="warning" />
            </div>
            <Panel>
              <PanelHeader
                title={t("dayByDay")}
                description={reasons ? t("dayByDayReasons") : t("dayByDayPrivate")}
                action={
                  !reasons ? (
                    <Pill tone="neutral">
                      <Lock className="size-3" />
                      {t("reasonsPrivate")}
                    </Pill>
                  ) : undefined
                }
              />
              <ul className="flex flex-wrap gap-1" data-testid="day-strip">
                {s.days.map((d) => {
                  const c = resolveCode(s.codes, d.code, d.status);
                  const vis = c ? visibleCode(s.codes, c, reasons) : null;
                  const tone = !c ? "bg-muted" : c.countsAs === "NOT_COUNTED" ? "bg-muted text-muted-foreground" : c.countsAs === "PRESENT" ? (c.late ? "bg-warning-soft text-[oklch(0.5_0.13_65)]" : "bg-success-soft text-success") : c.authorised ? "bg-info-soft text-info" : "bg-danger-soft text-danger";
                  return (
                    <li key={d.date.toISOString()} title={`${fmtDate(prefs, d.date, "long")}: ${vis ? pick(locale, vis.labelEn, vis.labelAr) : ""}${d.minutesLate ? ` (${t("minutesLateN", { n: d.minutesLate })})` : ""}`} className={cn("grid h-8 min-w-8 place-items-center rounded-md px-1 text-[11px] font-semibold", tone)} dir="ltr">
                      {vis?.code ?? "?"}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </>
        )}
      </PageBody>
    );
  }

  function NoClasses() {
    return (
      <PageBody>
        <PageHeader title={t("title")} description={t("subtitle")} />
        <EmptyState icon={<BarChart3 className="size-5" />} title={t("noClassesTitle")} body={t("noClassesBody")} />
      </PageBody>
    );
  }
}
