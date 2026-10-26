import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftRight, CalendarOff, ChevronLeft, ChevronRight, ClipboardCheck, Clock, DoorOpen, Lock, Plane, Sun, Users } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link, redirect } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { AttendanceTabs, attendanceAccess } from "@/components/attendance/attendance-tabs";
import { attViewer, myRegisters, neighbourDays, type RegisterItem } from "@/server/attendance/registers";
import { localClock, toMin } from "@/server/attendance/settings";
import { keyToDate } from "@/server/timetable/cover";

export async function generateMetadata() {
  const t = await getTranslations("attendance.today");
  return { title: t("title") };
}

export default async function AttendanceTodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const access = attendanceAccess(ctx);
  if (!access.today) {
    if (access.office) redirect({ href: "/attendance/office", locale: ctx.locale });
    if (access.reports) redirect({ href: "/attendance/reports", locale: ctx.locale });
    notFound();
  }
  const t = await getTranslations("attendance.today");
  const prefs = await formatPrefs(ctx);
  const v = attViewer(ctx);
  const now = new Date();
  const clock = localClock(now, v.timezone);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : clock.dateKey;
  const { items, holiday, schoolDay, settings } = await myRegisters(v, date, now);
  const { prev, next } = neighbourDays(date, v.weekDays);
  const isToday = date === clock.dateKey;
  const taken = items.filter((i) => i.takenAt && !i.coveredBy).length;
  const own = items.filter((i) => !i.coveredBy).length;

  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title={t("title")}
        description={settings.mode === "EXTERNAL" ? t("subtitleExternal") : t("subtitle")}
        actions={
          <div className="flex items-center gap-1" data-testid="date-nav">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/attendance?date=${prev}`} aria-label={t("previousDay")}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
            {!isToday && (
              <Button variant="outline" asChild>
                <Link href="/attendance">{t("backToToday")}</Link>
              </Button>
            )}
            <Button variant="outline" size="icon" asChild>
              <Link href={`/attendance?date=${next}`} aria-label={t("nextDay")}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        }
      />
      <AttendanceTabs ctx={ctx} current="today" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-lg font-semibold" data-testid="today-date">
            {fmtDate(prefs, keyToDate(date), "long")}
          </div>
          {own > 0 && (
            <div className="text-sm text-muted-foreground" data-testid="taken-summary">
              {t("takenSummary", { taken, total: own })}
            </div>
          )}
        </div>
        {isToday && <Pill tone="brand">{t("todayPill")}</Pill>}
      </div>

      {settings.mode === "EXTERNAL" && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground" data-testid="external-banner">
          <ArrowLeftRight className="mt-0.5 size-4 shrink-0" />
          {t("externalBanner")}
        </div>
      )}

      {!schoolDay ? (
        <EmptyState icon={<Sun className="size-5" />} title={t("weekendTitle")} body={t("weekendBody")} />
      ) : holiday ? (
        <EmptyState icon={<CalendarOff className="size-5" />} title={t("holidayTitle")} body={t("holidayBody")} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-5" />}
          title={t("noneTitle")}
          body={access.office ? t("noneBodyOffice") : t("noneBody")}
          action={
            access.office ? (
              <Button asChild variant="outline">
                <Link href="/attendance/office">{t("openOffice")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="register-list">
          {items.map((i) => (
            <li key={`${i.classId}:${i.periodNo}`}>
              <RegisterCard i={i} date={date} nowMin={isToday ? clock.minute : date < clock.dateKey ? 24 * 60 : -1} />
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );

  function RegisterCard({ i, date, nowMin }: { i: RegisterItem; date: string; nowMin: number }) {
    const href = `/attendance/take?class=${i.classId}&date=${date}&period=${i.periodNo}`;
    const started = nowMin >= toMin(i.start);
    const complete = i.marked >= i.students && i.students > 0;
    const status = i.coveredBy !== null ? (
      <Pill tone="neutral">
        <Plane className="size-3" />
        {i.coveredBy ? t("coveredBy", { name: i.coveredBy }) : t("covered")}
      </Pill>
    ) : i.closedAt ? (
      <Pill tone="neutral">
        <Lock className="size-3" />
        {t("closed")}
      </Pill>
    ) : complete ? (
      <Pill tone="success">{t("taken")}</Pill>
    ) : i.marked > 0 ? (
      <Pill tone="info">{t("partial", { marked: i.marked, total: i.students })}</Pill>
    ) : started ? (
      <Pill tone="warning">{t("notTaken")}</Pill>
    ) : (
      <Pill tone="neutral">{t("upcoming")}</Pill>
    );
    const body = (
      <div
        className={cn(
          "flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition",
          i.coveredBy === null && "hover:border-brand/30 hover:shadow-sm",
          i.coveredBy !== null && "opacity-70",
          i.coveredBy === null && started && !complete && !i.closedAt && "border-warning/40",
        )}
        data-testid="register-card"
        data-kind={i.kind}
        data-complete={complete}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Clock className="size-3.5" />
              <span dir="ltr">{i.end ? `${i.start} - ${i.end}` : i.start}</span>
              <span>·</span>
              <span>{i.kind === "DAILY" ? t("dailyRegister") : t("lessonN", { n: i.lessonNo ?? i.periodNo })}</span>
              {i.cover && <Pill tone="violet">{t("coverBadge")}</Pill>}
            </div>
            <div className="mt-1 truncate text-base font-semibold">{pick(ctx.locale, i.className.en, i.className.ar)}</div>
            {i.subject && i.kind === "LESSON" && <div className="truncate text-sm text-muted-foreground">{pick(ctx.locale, i.subject.en, i.subject.ar)}</div>}
          </div>
          {status}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" />
            {t("studentsN", { n: fmtNumber(prefs, i.students) })}
          </span>
          {i.room && (
            <span className="inline-flex items-center gap-1">
              <DoorOpen className="size-3.5" />
              {t("roomN", { room: i.room })}
            </span>
          )}
          {i.marked > 0 && <span className="text-danger">{t("absentN", { n: i.absent })}</span>}
          {i.late > 0 && <span className="text-[oklch(0.5_0.13_65)]">{t("lateN", { n: i.late })}</span>}
        </div>
        {i.coveredBy === null && (
          <div className="text-sm font-medium text-brand">{complete || i.closedAt || nowMin === 24 * 60 ? t("openRegister") : t("takeRegister")}</div>
        )}
      </div>
    );
    return i.coveredBy !== null ? body : <Link href={href} className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-brand">{body}</Link>;
  }
}
