import { getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { personName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { WeekGrid } from "@/components/timetable/week-grid";
import { CancelAbsenceButton, ReportAbsenceDialog } from "@/components/timetable/cover-actions";
import { periodsOf, slotLessons, studentClassIds, teacherWeek, weekOf, yearOf, type GridData } from "@/server/timetable/queries";
import { addDays, dateKey, keyToDate, weekdayOfKey } from "@/server/timetable/cover";
import { dubaiDateKey } from "@/server/appointments/slots";

export async function generateMetadata() {
  const t = await getTranslations("timetable");
  return { title: t("title") };
}

export default async function TimetablePage({ searchParams }: { searchParams: Promise<{ week?: string; child?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("timetable");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const year = await yearOf(ctx);
  const periods = year ? await periodsOf(ctx, year.id) : [];
  const weekDays = ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5];
  const days = weekDays.filter((d) => periods.some((p) => p.day === d));
  const today = dubaiDateKey(new Date());
  // At the weekend, show the coming week.
  let anchor = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today;
  if (!sp.week && !weekDays.includes(weekdayOfKey(today))) {
    while (!weekDays.includes(weekdayOfKey(anchor))) anchor = addDays(anchor, 1);
  }
  const { monday, dates } = weekOf(anchor, days);
  const todayDay = Object.entries(dates).find(([, k]) => k === today)?.[0];
  const canManage = ctx.can("timetable.manage");

  if (!year || periods.length === 0) {
    return (
      <PageBody>
        <PageHeader title={t("title")} description={t("subtitle")} />
        <EmptyState
          icon={<CalendarDays className="size-5" />}
          title={t("notPublished")}
          body={canManage ? t("notPublishedAdmin") : t("notPublishedBody")}
          action={
            canManage ? (
              <Button asChild>
                <Link href="/admin/timetable">{t("openSetup")}</Link>
              </Button>
            ) : undefined
          }
        />
      </PageBody>
    );
  }

  // Who we show: the student, a parent's chosen child, or the member of staff.
  let lessons: GridData["lessons"] = [];
  let heading = "";
  let children: Array<{ id: string; name: string; grade: number }> = [];
  let childId: string | null = null;
  if (ctx.isStudent && ctx.membership.student) {
    lessons = await slotLessons(ctx, year.id, { classId: { in: await studentClassIds(ctx, ctx.membership.student.id) } }, "teacher");
  } else if (ctx.isParent) {
    children = (ctx.membership.guardian?.links ?? []).map((l) => ({ id: l.studentId, name: personName(l.student, locale), grade: l.student.gradeLevel })).sort((a, b) => b.grade - a.grade);
    childId = children.find((c) => c.id === sp.child)?.id ?? children[0]?.id ?? null;
    if (childId) {
      lessons = await slotLessons(ctx, year.id, { classId: { in: await studentClassIds(ctx, childId) } }, "teacher");
      heading = children.find((c) => c.id === childId)?.name ?? "";
    }
  } else {
    lessons = await teacherWeek(ctx, year.id, ctx.membershipId, dates);
  }
  const data: GridData = { days, periods: periods.filter((p) => days.includes(p.day)), lessons, dates };
  const qs = (week: string) => `/timetable?week=${week}${childId ? `&child=${childId}` : ""}`;

  // Staff: absences and cover.
  const staffExtras = ctx.isStaff ? await staffPanels() : null;
  const lessonPeriods = periods.filter((p) => p.day === days[0] && p.kind === "LESSON").map((p) => ({ periodNo: p.periodNo, label: t("lessonNTime", { n: p.lessonNo ?? p.periodNo, time: p.start }) }));

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={ctx.isStudent ? t("subtitleStudent") : ctx.isParent ? t("subtitleParent") : t("subtitleStaff")}
        actions={
          <>
            {ctx.isStaff && ctx.can("absence.report") && <ReportAbsenceDialog periods={lessonPeriods} today={today} />}
            {canManage && (
              <Button variant="outline" asChild>
                <Link href="/admin/timetable">
                  <Settings2 className="size-4" />
                  {t("manage")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {ctx.isParent && children.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("chooseChild")}>
          {children.map((c) => (
            <Link key={c.id} href={`/timetable?child=${c.id}${sp.week ? `&week=${sp.week}` : ""}`} role="tab" aria-selected={c.id === childId} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition", c.id === childId ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:border-brand/40")} data-testid="child-tab">
              {c.name} <span className="opacity-75">· {t("gradeN", { grade: c.grade })}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {heading && <span className="me-2">{heading}</span>}
          <span className="text-muted-foreground">{t("weekOf", { date: fmtDate(prefs, keyToDate(monday), "long") })}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" asChild>
            <Link href={qs(addDays(monday, -7))} aria-label={t("previousWeek")}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={qs(today)}>{t("thisWeek")}</Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link href={qs(addDays(monday, 7))} aria-label={t("nextWeek")}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Link>
          </Button>
        </div>
      </div>

      {lessons.length === 0 ? (
        <EmptyState icon={<CalendarDays className="size-5" />} title={ctx.isParent && !childId ? t("noChildren") : t("noLessons")} body={ctx.isStaff ? t("noLessonsStaff") : t("noLessonsBody")} />
      ) : (
        <WeekGrid data={data} mode={ctx.isStaff ? "teacher" : "view"} todayDay={todayDay ? Number(todayDay) : null} />
      )}
      {staffExtras}
    </PageBody>
  );

  async function staffPanels() {
    const [absences, covers] = await Promise.all([
      db.staffAbsence.findMany({ where: { membershipId: ctx.membershipId, status: { not: "CANCELLED" }, endsOn: { gte: keyToDate(today) } }, include: { covers: true }, orderBy: { startsOn: "asc" }, take: 10 }),
      db.coverAssignment.findMany({ where: { substituteId: ctx.membershipId, status: { in: ["ASSIGNED", "DONE"] }, date: { gte: keyToDate(addDays(today, -60)) } }, select: { date: true } }),
    ]);
    const thisWeek = covers.filter((c) => dateKey(c.date) >= monday && dateKey(c.date) <= addDays(monday, 6)).length;
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t("myAbsences")} description={t("myAbsencesBody")} />
          {absences.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noAbsences")}</p>
          ) : (
            <ul className="divide-y">
              {absences.map((a) => {
                const ok = a.covers.filter((c) => c.status === "ASSIGNED" || c.status === "DONE").length;
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="my-absence">
                    <div>
                      <div className="text-sm font-medium">
                        {fmtDate(prefs, a.startsOn)}
                        {dateKey(a.endsOn) !== dateKey(a.startsOn) && ` - ${fmtDate(prefs, a.endsOn)}`}
                      </div>
                      <div className="text-xs text-muted-foreground">{t("coveredOf", { covered: ok, total: a.covers.length })}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={a.status === "COVERED" ? "success" : a.status === "PARTLY_COVERED" ? "warning" : "neutral"} dot>
                        {t(`absenceStatus.${a.status}`)}
                      </Pill>
                      <CancelAbsenceButton absenceId={a.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("myCover")} description={t("myCoverBody")} />
          <div className="flex gap-6">
            <div>
              <div className="text-2xl font-semibold tabular-nums">{thisWeek}</div>
              <div className="text-xs text-muted-foreground">{t("coverThisWeekLabel")}</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums">{covers.length}</div>
              <div className="text-xs text-muted-foreground">{t("coverLast60")}</div>
            </div>
          </div>
        </Panel>
      </div>
    );
  }
}
