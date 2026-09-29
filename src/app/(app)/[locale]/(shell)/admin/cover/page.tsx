import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, CalendarX, ChevronLeft, ChevronRight, ClipboardCheck, UserRoundCheck, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill, type Tone } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CancelAbsenceButton, ReassignCoverButton, ReportAbsenceDialog } from "@/components/timetable/cover-actions";
import { names, periodsOf, yearOf } from "@/server/timetable/queries";
import { addDays, dateKey, keyToDate, weekdayOfKey } from "@/server/timetable/cover";
import { dubaiDateKey } from "@/server/appointments/slots";

export async function generateMetadata() {
  const t = await getTranslations("timetable");
  return { title: t("coverTitle") };
}

const STATUS_TONE: Record<string, Tone> = { ASSIGNED: "success", DONE: "neutral", UNCOVERED: "danger", DECLINED: "warning" };
const ABS_TONE: Record<string, Tone> = { COVERED: "success", PARTLY_COVERED: "warning", REPORTED: "info", CANCELLED: "neutral" };

export default async function CoverPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("cover.manage")) notFound();
  const t = await getTranslations("timetable");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const today = dubaiDateKey(new Date());
  const weekDays = ctx.org.weekDays.length ? ctx.org.weekDays : [1, 2, 3, 4, 5];
  let date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  if (!sp.date) while (!weekDays.includes(weekdayOfKey(date))) date = addDays(date, 1);
  const step = (dir: 1 | -1) => {
    let k = addDays(date, dir);
    while (!weekDays.includes(weekdayOfKey(k))) k = addDays(k, dir);
    return k;
  };
  const year = await yearOf(ctx);
  const periods = year ? await periodsOf(ctx, year.id) : [];
  const since = addDays(today, -60);

  const [dayCovers, upcoming, history, upcomingProblems, teachersRaw] = await Promise.all([
    db.coverAssignment.findMany({ where: { date: keyToDate(date) }, orderBy: [{ periodNo: "asc" }, { createdAt: "asc" }] }),
    db.staffAbsence.findMany({ where: { status: { not: "CANCELLED" }, endsOn: { gte: keyToDate(today) } }, include: { covers: true }, orderBy: { startsOn: "asc" }, take: 50 }),
    db.staffAbsence.findMany({ where: { endsOn: { lt: keyToDate(today), gte: keyToDate(since) } }, include: { covers: true }, orderBy: { startsOn: "desc" }, take: 50 }),
    db.coverAssignment.count({ where: { date: { gte: keyToDate(today) }, status: { in: ["UNCOVERED", "DECLINED"] } } }),
    db.membership.findMany({
      where: { status: "ACTIVE", roles: { some: { role: { key: { in: ["teacher", "department_head"] } } } } },
      select: { id: true, user: { select: { nameEn: true, nameAr: true } } },
      orderBy: { user: { nameEn: "asc" } },
    }),
  ]);
  const totals = await db.coverAssignment.groupBy({ by: ["substituteId"], where: { status: { in: ["ASSIGNED", "DONE"] }, substituteId: { not: null }, date: { gte: keyToDate(since) } }, _count: { _all: true } });
  const weekStart = addDays(today, -((weekdayOfKey(today) + 6) % 7));
  const weekTotals = await db.coverAssignment.groupBy({ by: ["substituteId"], where: { status: { in: ["ASSIGNED", "DONE"] }, substituteId: { not: null }, date: { gte: keyToDate(weekStart), lte: keyToDate(addDays(weekStart, 6)) } }, _count: { _all: true } });

  const classes = await db.schoolClass.findMany({ where: { id: { in: dayCovers.map((c) => c.classId) } } });
  const slots = await db.timetableSlot.findMany({ where: { id: { in: dayCovers.map((c) => c.slotId) } }, select: { id: true, room: true } });
  const who = await names(ctx, [...dayCovers.flatMap((c) => [c.substituteId, c.originalTeacherId]), ...upcoming.map((a) => a.membershipId), ...history.map((a) => a.membershipId), ...totals.map((x) => x.substituteId)]);
  const teachers = teachersRaw.map((m) => ({ id: m.id, name: pick(locale, m.user.nameEn, m.user.nameAr) }));
  const wd = weekdayOfKey(date);
  const pOf = (no: number) => periods.find((p) => p.day === wd && p.periodNo === no);
  const lessonPeriods = periods.filter((p) => p.day === (weekDays[0] ?? 1) && p.kind === "LESSON").map((p) => ({ periodNo: p.periodNo, label: t("lessonNTime", { n: p.lessonNo ?? p.periodNo, time: p.start }) }));

  const dayAbsent = new Set(dayCovers.map((c) => c.originalTeacherId)).size;
  const dayCovered = dayCovers.filter((c) => c.status === "ASSIGNED" || c.status === "DONE").length;
  const dayProblems = dayCovers.length - dayCovered;
  const byPeriod = [...new Set(dayCovers.map((c) => c.periodNo))];
  const fair = totals
    .map((x) => ({ id: x.substituteId!, total: x._count._all, week: weekTotals.find((w) => w.substituteId === x.substituteId)?._count._all ?? 0 }))
    .sort((a, b) => b.total - a.total || (who.get(a.id) ?? "").localeCompare(who.get(b.id) ?? ""));
  const maxTotal = Math.max(1, ...fair.map((f) => f.total));

  return (
    <PageBody>
      <PageHeader title={t("coverTitle")} description={t("coverSubtitle")} actions={<ReportAbsenceDialog teachers={teachers} periods={lessonPeriods} today={today} triggerLabel={t("markAbsent")} />} />

      {upcomingProblems > 0 && (
        <Alert variant="destructive" data-testid="uncovered-alert">
          <AlertTriangle className="size-4" />
          <AlertDescription>{t("uncoveredAlert", { n: upcomingProblems })}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("statAbsent")} value={fmtNumber(prefs, dayAbsent)} icon={<CalendarX className="size-4" />} tone="info" />
        <StatCard label={t("statLessons")} value={fmtNumber(prefs, dayCovers.length)} icon={<ClipboardCheck className="size-4" />} />
        <StatCard label={t("statCovered")} value={fmtNumber(prefs, dayCovered)} icon={<UserRoundCheck className="size-4" />} tone="success" />
        <StatCard label={t("statUncovered")} value={fmtNumber(prefs, dayProblems)} icon={<AlertTriangle className="size-4" />} tone={dayProblems ? "danger" : "success"} testId="stat-uncovered" />
      </div>

      <Panel>
        <PanelHeader
          title={t("coverBoard")}
          description={fmtDate(prefs, keyToDate(date), "long")}
          action={
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" asChild>
                <Link href={`/admin/cover?date=${step(-1)}`} aria-label={t("previousDay")}>
                  <ChevronLeft className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/cover">{t("today")}</Link>
              </Button>
              <Button variant="outline" size="icon" asChild>
                <Link href={`/admin/cover?date=${step(1)}`} aria-label={t("nextDay")}>
                  <ChevronRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
            </div>
          }
        />
        {dayCovers.length === 0 ? (
          <EmptyState icon={<UserRoundCheck className="size-5" />} title={t("noCoverDay")} body={t("noCoverDayBody")} />
        ) : (
          <div className="space-y-4" data-testid="cover-board">
            {byPeriod.map((no) => {
              const p = pOf(no);
              return (
                <section key={no}>
                  <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    {t("lessonN", { n: p?.lessonNo ?? no })}
                    {p && (
                      <span className="ms-2 font-normal tabular-nums" dir="ltr">
                        {p.start} - {p.end}
                      </span>
                    )}
                  </h3>
                  <ul className="divide-y rounded-lg border">
                    {dayCovers
                      .filter((c) => c.periodNo === no)
                      .map((c) => {
                        const cls = classes.find((x) => x.id === c.classId);
                        const room = slots.find((s) => s.id === c.slotId)?.room ?? cls?.room;
                        const problem = c.status === "UNCOVERED" || c.status === "DECLINED";
                        const label = `${cls ? pick(locale, cls.nameEn, cls.nameAr) : ""} · ${t("lessonN", { n: p?.lessonNo ?? no })}`;
                        return (
                          <li key={c.id} className={`grid gap-2 p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center ${problem ? "bg-danger-soft/40" : ""}`} data-testid="cover-row" data-status={c.status}>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{cls ? pick(locale, cls.nameEn, cls.nameAr) : ""}</div>
                              {room && (
                                <div className="text-xs text-muted-foreground">
                                  {t("room")} <span dir="ltr">{room}</span>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 text-xs text-muted-foreground">
                              {t("absentTeacher")}: <span className="text-foreground">{who.get(c.originalTeacherId)}</span>
                            </div>
                            <div className="min-w-0 space-y-1">
                              <Pill tone={STATUS_TONE[c.status]} dot>
                                {t(`coverStatus.${c.status}`)}
                              </Pill>
                              {c.substituteId && c.status !== "DECLINED" && <div className="truncate text-sm font-medium">{who.get(c.substituteId)}</div>}
                              {c.status === "DECLINED" && c.substituteId && <div className="text-xs text-muted-foreground">{t("declinedBy", { name: who.get(c.substituteId) ?? "" })}</div>}
                              {c.reasonEn && <div className="text-xs text-muted-foreground">{t("declineReasonShown", { reason: c.reasonEn })}</div>}
                            </div>
                            <div className="sm:text-end">{date >= today && <ReassignCoverButton coverId={c.id} label={label} />}</div>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t("upcomingAbsences")} description={t("upcomingAbsencesBody")} />
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noUpcoming")}</p>
          ) : (
            <ul className="divide-y">
              {upcoming.map((a) => (
                <AbsenceRow key={a.id} a={a} name={who.get(a.membershipId) ?? ""} cancel />
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <PanelHeader title={t("fairness")} description={t("fairnessBody")} icon={<Users className="size-4" />} />
          {fair.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
          ) : (
            <ul className="space-y-2" data-testid="fairness">
              {fair.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{who.get(f.id)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("fairCounts", { total: f.total, week: f.week })}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.round((f.total / maxTotal) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title={t("history")} description={t("historyBody")} />
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
        ) : (
          <ul className="divide-y">
            {history.map((a) => (
              <AbsenceRow key={a.id} a={a} name={who.get(a.membershipId) ?? ""} />
            ))}
          </ul>
        )}
      </Panel>
    </PageBody>
  );

  function AbsenceRow({ a, name, cancel }: { a: (typeof upcoming)[number]; name: string; cancel?: boolean }) {
    const ok = a.covers.filter((c) => c.status === "ASSIGNED" || c.status === "DONE").length;
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="absence-row">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(prefs, a.startsOn)}
            {dateKey(a.endsOn) !== dateKey(a.startsOn) && ` - ${fmtDate(prefs, a.endsOn)}`}
            {" · "}
            {a.allDay ? t("wholeDay") : t("someLessons")}
            {" · "}
            {t("coveredOf", { covered: ok, total: a.covers.length })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={ABS_TONE[a.status]} dot>
            {t(`absenceStatus.${a.status}`)}
          </Pill>
          {cancel && <CancelAbsenceButton absenceId={a.id} />}
        </div>
      </li>
    );
  }
}
