import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, BookOpen, CalendarDays, CheckCircle2, Clock, Lock, UserRoundX } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { WeekGrid } from "@/components/timetable/week-grid";
import { TeacherSubjectsTable, type TeacherRow } from "@/components/timetable/teacher-subjects";
import { BellEditor } from "@/components/timetable/bell-editor";
import { AssignPanel, type SectionRow } from "@/components/timetable/assign-panel";
import { GenerateButton } from "@/components/timetable/generate-button";
import { ViewPicker } from "@/components/timetable/view-picker";
import { dayName } from "@/components/timetable/day-name";
import { names, periodsOf, slotLessons, yearOf, type GridData } from "@/server/timetable/queries";
import { DEFAULT_PERIODS } from "@/server/timetable/service";
import { assignTeachers } from "@/server/timetable/assign";
import type { GenerateReport } from "@/server/timetable/service";

export async function generateMetadata() {
  const t = await getTranslations("timetable");
  return { title: t("adminTitle") };
}

const TABS = ["teachers", "bell", "assign", "generate", "views"] as const;
type Tab = (typeof TABS)[number];

export default async function AdminTimetablePage({ searchParams }: { searchParams: Promise<{ tab?: string; by?: string; id?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("timetable.manage")) notFound();
  const t = await getTranslations("timetable");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "generate";
  const year = await yearOf(ctx);
  if (!year) {
    return (
      <PageBody>
        <PageHeader title={t("adminTitle")} description={t("adminSubtitle")} />
        <EmptyState icon={<CalendarDays className="size-5" />} title={t("noYear")} body={t("noYearBody")} />
      </PageBody>
    );
  }

  const [classes, offerings, quals, subjects, slotCount, lockedCount, periods, staff] = await Promise.all([
    db.schoolClass.findMany({ where: { academicYearId: year.id, isHomeroom: false, subjectId: { not: null } }, include: { subject: true }, orderBy: [{ gradeLevel: "asc" }, { nameEn: "asc" }] }),
    db.subjectOffering.findMany({ where: { academicYearId: year.id } }),
    db.teacherSubject.findMany(),
    db.subject.findMany({ orderBy: { nameEn: "asc" } }),
    db.timetableSlot.count({ where: { academicYearId: year.id } }),
    db.timetableSlot.count({ where: { academicYearId: year.id, locked: true } }),
    periodsOf(ctx, year.id),
    db.membership.findMany({
      where: { status: { in: ["ACTIVE", "INVITED"] }, OR: [{ roles: { some: { role: { key: { in: ["teacher", "department_head"] } } } } }, { id: { in: (await db.teacherSubject.findMany({ select: { membershipId: true } })).map((q) => q.membershipId) } }] },
      include: { user: true, staffProfile: { include: { department: true } } },
      orderBy: { user: { nameEn: "asc" } },
    }),
  ]);
  const offeringOf = (c: (typeof classes)[number]) => offerings.find((o) => o.subjectId === c.subjectId && o.gradeLevel === c.gradeLevel);
  const periodsOfClass = (c: (typeof classes)[number]) => offeringOf(c)?.periodsPerWeek ?? DEFAULT_PERIODS;
  const blockOf = (c: (typeof classes)[number]) => c.optionBlock ?? (offeringOf(c)?.kind === "OPTION" ? (offeringOf(c)?.optionBlock ?? null) : null);
  const required = classes.reduce((n, c) => n + periodsOfClass(c), 0);
  const unassigned = classes.filter((c) => !c.teacherMembershipId).length;
  const lessonPeriods = periods.filter((p) => p.kind === "LESSON").length;
  const subjName = (id: string) => {
    const s = subjects.find((x) => x.id === id);
    return s ? pick(locale, s.nameEn, s.nameAr) : "";
  };
  const staffName = (id: string | null) => {
    const m = staff.find((x) => x.id === id);
    return m ? pick(locale, m.user.nameEn, m.user.nameAr) : "";
  };

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "generate", label: t("tabGenerate") },
    { key: "views", label: t("tabViews") },
    { key: "assign", label: t("tabAssign"), count: unassigned || undefined },
    { key: "teachers", label: t("tabTeachers") },
    { key: "bell", label: t("tabBell") },
  ];

  return (
    <PageBody>
      <PageHeader
        title={t("adminTitle")}
        description={t("adminSubtitle")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/cover">{t("coverTitle")}</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("statSections")} value={fmtNumber(prefs, classes.length)} icon={<BookOpen className="size-4" />} />
        <StatCard label={t("statPlaced")} value={`${fmtNumber(prefs, slotCount)} / ${fmtNumber(prefs, required)}`} icon={<CheckCircle2 className="size-4" />} tone={slotCount >= required ? "success" : "warning"} testId="stat-placed" />
        <StatCard label={t("statLocked")} value={fmtNumber(prefs, lockedCount)} icon={<Lock className="size-4" />} tone="info" />
        <StatCard label={t("statNoTeacher")} value={fmtNumber(prefs, unassigned)} icon={<UserRoundX className="size-4" />} tone={unassigned ? "danger" : "success"} />
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t("adminTitle")}>
        {tabs.map((x) => (
          <Link key={x.key} href={`/admin/timetable?tab=${x.key}`} className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition", tab === x.key ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground")} data-testid={`tab-${x.key}`}>
            {x.label}
            {x.count ? <span className="rounded-full bg-danger-soft px-1.5 text-xs text-danger">{x.count}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "teachers" && teachersTab()}
      {tab === "bell" && bellTab()}
      {tab === "assign" && assignTab()}
      {tab === "generate" && (await generateTab())}
      {tab === "views" && (await viewsTab())}
    </PageBody>
  );

  function teachersTab() {
    const rows: TeacherRow[] = staff.map((m) => {
      const mine = quals.filter((q) => q.membershipId === m.id);
      const load = classes.filter((c) => c.teacherMembershipId === m.id).reduce((n, c) => n + periodsOfClass(c), 0);
      return {
        id: m.id,
        name: pick(locale, m.user.nameEn, m.user.nameAr),
        department: m.staffProfile?.department ? pick(locale, m.staffProfile.department.nameEn, m.staffProfile.department.nameAr) : "",
        max: mine.length ? Math.max(...mine.map((q) => q.maxPeriodsPerWeek)) : 24,
        load,
        quals: mine.map((q) => ({ subjectId: q.subjectId, subject: subjName(q.subjectId), grades: q.gradeLevels })).sort((a, b) => a.subject.localeCompare(b.subject)),
      };
    });
    return <TeacherSubjectsTable rows={rows} subjects={subjects.map((s) => ({ id: s.id, name: pick(locale, s.nameEn, s.nameAr) }))} />;
  }

  function bellTab() {
    const days = (ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5]).map((d) => ({ day: d, name: dayName(locale, d) }));
    return <BellEditor days={days} periods={periods.map((p) => ({ day: p.day, periodNo: p.periodNo, startTime: p.start, endTime: p.end, kind: p.kind }))} hasLessons={slotCount > 0} />;
  }

  function assignTab() {
    const preview = assignTeachers({
      sections: classes.map((c) => ({ id: c.id, subjectId: c.subjectId, gradeLevel: c.gradeLevel, teacherId: c.teacherMembershipId, periods: periodsOfClass(c), optionBlock: blockOf(c) })),
      qualifications: quals.map((q) => ({ teacherId: q.membershipId, subjectId: q.subjectId, gradeLevels: q.gradeLevels, maxPeriodsPerWeek: q.maxPeriodsPerWeek })),
    });
    const rows: SectionRow[] = classes.map((c) => {
      const qualified = quals.filter((q) => q.subjectId === c.subjectId && q.gradeLevels.includes(c.gradeLevel)).map((q) => q.membershipId);
      return {
        id: c.id,
        name: pick(locale, c.nameEn, c.nameAr),
        grade: c.gradeLevel,
        block: blockOf(c),
        periods: periodsOfClass(c),
        teacherId: c.teacherMembershipId,
        teacherName: staffName(c.teacherMembershipId),
        qualified,
        problem: preview.unassigned.find((u) => u.sectionId === c.id)?.reason ?? null,
        suggestion: preview.assignments.find((a) => a.sectionId === c.id)?.teacherId ?? null,
      };
    });
    const teacherOptions = staff.map((m) => ({ id: m.id, name: pick(locale, m.user.nameEn, m.user.nameAr) }));
    return <AssignPanel rows={rows} teachers={teacherOptions} suggestionNames={Object.fromEntries(rows.filter((r) => r.suggestion).map((r) => [r.id, staffName(r.suggestion)]))} />;
  }

  async function generateTab() {
    const last = await db.auditEvent.findFirst({ where: { action: "timetable.generate" }, orderBy: { createdAt: "desc" } });
    const report = (last?.meta ?? null) as GenerateReport | null;
    const byClass = new Map(classes.map((c) => [c.id, c]));
    const counts = await db.timetableSlot.groupBy({ by: ["classId"], where: { academicYearId: year!.id }, _count: { _all: true } });
    const short = classes.filter((c) => (counts.find((x) => x.classId === c.id)?._count._all ?? 0) < periodsOfClass(c));
    const reasonFor = (id: string) => report?.unplaced.find((u) => u.classId === id)?.reason;
    const who = await names(ctx, last?.actorId ? [last.actorId] : []);
    return (
      <div className="space-y-4">
        <Panel>
          <PanelHeader
            title={t("generateTitle")}
            description={t("generateBody")}
            icon={<Clock className="size-4" />}
            action={<GenerateButton disabledReason={lessonPeriods === 0 ? t("needBell") : classes.length === 0 ? t("needSections") : null} hasLessons={slotCount > 0} />}
          />
          {last && report ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" data-testid="last-run">
              <span>{t("lastRun", { when: fmtDateTime(prefs, last.createdAt), who: who.get(last.actorId ?? "") ?? t("system") })}</span>
              <Pill tone="info">{t("runMs", { ms: report.stats.ms })}</Pill>
              <Pill tone={report.unplaced.length ? "warning" : "success"}>{t("runPlaced", { placed: report.stats.lessonsPlaced, required: report.stats.lessonsRequired })}</Pill>
              {report.stats.lockedKept > 0 && <Pill>{t("runLocked", { n: report.stats.lockedKept })}</Pill>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("neverRun")}</p>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("notPlacedTitle")} description={t("notPlacedBody")} icon={<AlertTriangle className="size-4" />} />
          {short.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success" data-testid="all-placed">
              <CheckCircle2 className="size-4" />
              {slotCount > 0 ? t("allPlaced") : t("nothingYet")}
            </p>
          ) : (
            <ul className="divide-y" data-testid="unplaced-list">
              {short.map((c) => {
                const have = counts.find((x) => x.classId === c.id)?._count._all ?? 0;
                const r = reasonFor(c.id);
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="text-sm font-medium">{pick(locale, c.nameEn, c.nameAr)}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{t("placedOf", { have, need: periodsOfClass(c) })}</span>
                      <Pill tone="warning">{r ? t(`reason.${r}`) : t("reason.NOT_RUN")}</Pill>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {report && report.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
              {report.warnings.map((w, i) => (
                <li key={i}>
                  {t(`warning.${w.kind}`, { n: "count" in w ? w.count : w.classIds.length, classes: w.classIds.map((id) => (byClass.get(id) ? pick(locale, byClass.get(id)!.nameEn, byClass.get(id)!.nameAr) : "")).filter(Boolean).slice(0, 4).join(", ") })}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  async function viewsTab() {
    const by = ["grade", "class", "teacher", "room"].includes(sp.by ?? "") ? (sp.by as "grade" | "class" | "teacher" | "room") : "grade";
    const grades = [...new Set(classes.map((c) => c.gradeLevel))].sort((a, b) => a - b);
    const rooms = [...new Set((await db.timetableSlot.findMany({ where: { academicYearId: year!.id, room: { not: null } }, select: { room: true }, distinct: ["room"] })).map((r) => r.room!))].sort();
    const teacherIds = [...new Set(classes.map((c) => c.teacherMembershipId).filter(Boolean) as string[])];
    const options = {
      grade: grades.map((g) => ({ value: String(g), label: t("gradeN", { grade: g }) })),
      class: classes.map((c) => ({ value: c.id, label: pick(locale, c.nameEn, c.nameAr) })),
      teacher: teacherIds.map((id) => ({ value: id, label: staffName(id) })).sort((a, b) => a.label.localeCompare(b.label)),
      room: rooms.map((r) => ({ value: r, label: r })),
    };
    const id = options[by].some((o) => o.value === sp.id) ? sp.id! : (options[by][0]?.value ?? "");
    const days = (ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5]).filter((d) => periods.some((p) => p.day === d));
    let lessons: GridData["lessons"] = [];
    if (id) {
      if (by === "grade") lessons = await slotLessons(ctx, year!.id, { classId: { in: classes.filter((c) => c.gradeLevel === Number(id)).map((c) => c.id) } }, "both");
      if (by === "class") lessons = await slotLessons(ctx, year!.id, { classId: id }, "teacher");
      if (by === "teacher") lessons = await slotLessons(ctx, year!.id, { teacherMembershipId: id }, "class");
      if (by === "room") lessons = await slotLessons(ctx, year!.id, { room: id }, "both");
    }
    return (
      <div className="space-y-3">
        <ViewPicker by={by} id={id} options={options} />
        <p className="text-xs text-muted-foreground">{t("viewsHelp")}</p>
        {lessons.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-5" />} title={t("noLessons")} body={slotCount === 0 ? t("generateFirst") : t("noLessonsView")} />
        ) : (
          <WeekGrid data={{ days, periods: periods.filter((p) => days.includes(p.day)), lessons }} mode="manage" />
        )}
      </div>
    );
  }
}
