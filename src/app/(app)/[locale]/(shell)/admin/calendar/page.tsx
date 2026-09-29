import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarDays, CalendarOff, ClipboardList, FilePen, GraduationCap } from "lucide-react";
import type { CalendarEventKind } from "@prisma/client";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber, fmtTime, localeTag } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Pill, type Tone } from "@/components/app/badges";
import { EventDeleteButton, EventDialog, EventPublishSwitch, type EventDraft } from "@/components/calendar-admin/event-dialog";
import { HolidaysDialog } from "@/components/calendar-admin/holidays-dialog";
import { NewYearDialog, SetCurrentYearButton } from "@/components/calendar-admin/year-dialog";
import { proposeUaeHolidays } from "@/server/calendar/uae-holidays";
import { addDays, dayKey, weekdayOf } from "@/server/exams/schedule";

export async function generateMetadata() {
  const t = await getTranslations("calendarAdmin");
  return { title: t("title") };
}

const KIND_TONE: Record<CalendarEventKind, Tone> = { EVENT: "brand", DEADLINE: "danger", HOLIDAY: "success", EXAM: "warning", FOLLOW_UP: "neutral" };
const KINDS: CalendarEventKind[] = ["EVENT", "DEADLINE", "HOLIDAY", "EXAM"];
const GRADES = [6, 7, 8, 9, 10, 11, 12];

export default async function AdminCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string; kind?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("calendar.manage")) notFound();
  const t = await getTranslations("calendarAdmin");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const years = await db.academicYear.findMany({ orderBy: { startsOn: "desc" }, include: { terms: { orderBy: { startsOn: "asc" } } } });
  const year = years.find((y) => y.id === sp.year) ?? years.find((y) => y.isCurrent) ?? years[0];
  const tab = sp.tab === "list" ? "list" : "year";
  const kindFilter = KINDS.includes(sp.kind as CalendarEventKind) ? (sp.kind as CalendarEventKind) : null;
  const today = dayKey(new Date());
  const nextStartYear = years.length ? Math.max(...years.map((y) => Number(dayKey(y.startsOn).slice(0, 4)))) + 1 : Number(today.slice(0, 4));

  if (!year) {
    return (
      <PageBody>
        <PageHeader title={t("title")} description={t("subtitle")} actions={<NewYearDialog nextStartYear={nextStartYear} />} />
        <EmptyState icon={<CalendarDays className="size-5" />} title={t("noYear")} body={t("noYearBody")} />
      </PageBody>
    );
  }

  const startKey = dayKey(year.startsOn);
  const endKey = dayKey(year.endsOn);
  const events = await db.calendarEvent.findMany({ where: { startsAt: { lt: new Date(year.endsOn.getTime() + 86400_000) }, endsAt: { gt: year.startsOn } }, orderBy: { startsAt: "asc" } });
  const [examLinks, tripLinks] = await Promise.all([
    db.examSitting.findMany({ where: { calendarEventId: { in: events.map((e) => e.id) } }, select: { calendarEventId: true } }),
    db.trip.findMany({ where: { calendarEventId: { in: events.map((e) => e.id) } }, select: { id: true, calendarEventId: true } }),
  ]);
  const examIds = new Set(examLinks.map((x) => x.calendarEventId));
  const tripById = new Map(tripLinks.map((x) => [x.calendarEventId, x.id]));
  const holidayEvents = events.filter((e) => e.kind === "HOLIDAY");
  const proposals = proposeUaeHolidays(startKey, endKey).map((p) => ({
    ...p,
    exists: holidayEvents.some((e) => {
      const s = dayKey(e.startsAt);
      const last = dayKey(new Date(e.endsAt.getTime() - 1));
      return s <= addDays(p.startKey, p.days + 1) && last >= addDays(p.startKey, -2);
    }),
  }));

  // Day classification for the year view.
  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const last = e.allDay ? dayKey(new Date(e.endsAt.getTime() - 1)) : dayKey(e.startsAt);
    for (let k = dayKey(e.startsAt); k <= last; k = addDays(k, 1)) byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const inTerm = (k: string) => year.terms.some((tm) => dayKey(tm.startsOn) <= k && dayKey(tm.endsOn) >= k);
  const tag = localeTag(prefs);
  const months: string[] = [];
  for (let m = `${startKey.slice(0, 7)}-01`; m <= endKey; m = `${addDays(`${m.slice(0, 8)}28`, 7).slice(0, 7)}-01`) months.push(m);
  const weekDays = ctx.org.weekDays;
  const wdNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(tag, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))));

  const list = events.filter((e) => e.kind !== "FOLLOW_UP" && (!kindFilter || e.kind === kindFilter));
  const counts = {
    holidays: holidayEvents.length,
    events: events.filter((e) => e.kind === "EVENT" || e.kind === "DEADLINE").length,
    exams: examIds.size,
    drafts: events.filter((e) => !e.published).length,
  };
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base = { year: year.id, tab, kind: kindFilter, ...patch };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/admin/calendar?${p.toString()}`;
  };
  const draftOf = (e: (typeof events)[number]): EventDraft => ({
    id: e.id,
    kind: e.kind === "FOLLOW_UP" ? "EVENT" : e.kind,
    titleEn: e.titleEn,
    titleAr: e.titleAr,
    descEn: e.descEn ?? "",
    descAr: e.descAr ?? "",
    locationEn: e.locationEn ?? "",
    locationAr: e.locationAr ?? "",
    allDay: e.allDay,
    startDate: dayKey(e.startsAt),
    endDate: e.allDay ? dayKey(new Date(e.endsAt.getTime() - 1)) : dayKey(e.endsAt),
    startTime: new Date(e.startsAt.getTime() + 4 * 3600_000).toISOString().slice(11, 16),
    endTime: new Date(e.endsAt.getTime() + 4 * 3600_000).toISOString().slice(11, 16),
    audience: e.audience.includes("all") ? ["staff", "student", "parent"] : e.audience.filter((a) => ["staff", "student", "parent"].includes(a)),
    gradeLevels: e.gradeLevels,
    published: e.published,
  });
  const defaultDate = today >= startKey && today <= endKey ? today : startKey;

  return (
    <PageBody className="max-w-[1400px]">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <NewYearDialog nextStartYear={nextStartYear} />
            <HolidaysDialog proposals={proposals} yearName={pick(locale, year.nameEn, year.nameAr)} />
            <EventDialog grades={GRADES} defaultDate={defaultDate} />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {years.map((y) => (
          <Link key={y.id} href={`/admin/calendar?year=${y.id}&tab=${tab}`} className={cn("rounded-full border px-3 py-1 text-sm font-medium", y.id === year.id ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground hover:text-foreground")} data-testid="year-chip">
            {pick(locale, y.nameEn, y.nameAr)}
            {y.isCurrent && <span className="ms-1.5 text-xs">{t("current")}</span>}
          </Link>
        ))}
        {!year.isCurrent && <SetCurrentYearButton id={year.id} />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statHolidays")} value={fmtNumber(prefs, counts.holidays)} icon={<CalendarOff className="size-5" />} tone="success" />
        <StatCard label={t("statEvents")} value={fmtNumber(prefs, counts.events)} icon={<CalendarDays className="size-5" />} />
        <StatCard label={t("statExams")} value={fmtNumber(prefs, counts.exams)} icon={<GraduationCap className="size-5" />} tone="warning" href="/admin/exams" />
        <StatCard label={t("statDrafts")} value={fmtNumber(prefs, counts.drafts)} icon={<FilePen className="size-5" />} tone="info" href={qs({ tab: "list" })} />
      </div>

      <Panel>
        <PanelHeader title={t("terms")} icon={<ClipboardList className="size-4" />} description={`${fmtDate(prefs, year.startsOn)} - ${fmtDate(prefs, year.endsOn)}`} />
        <div className="grid gap-3 sm:grid-cols-3">
          {year.terms.map((tm) => {
            const now = today >= dayKey(tm.startsOn) && today <= dayKey(tm.endsOn);
            const weeks = Math.round((tm.endsOn.getTime() - tm.startsOn.getTime()) / (7 * 86400_000));
            return (
              <div key={tm.id} className={cn("rounded-lg border p-3", now && "border-brand/40 bg-brand-soft/40")} data-testid="term-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{pick(locale, tm.nameEn, tm.nameAr)}</span>
                  {now && <Pill tone="brand">{t("now")}</Pill>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {fmtDate(prefs, tm.startsOn)} - {fmtDate(prefs, tm.endsOn)}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t("weeks", { count: weeks })}</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="flex rounded-lg bg-muted p-1 sm:w-fit">
        {(["year", "list"] as const).map((v) => (
          <Link key={v} href={qs({ tab: v })} className={cn("flex-1 whitespace-nowrap rounded-md px-4 py-1.5 text-center text-sm font-medium", tab === v ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")} data-testid={`tab-${v}`}>
            {t(`tab.${v}`)}
          </Link>
        ))}
      </div>

      {tab === "year" ? (
        <>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-brand-soft ring-1 ring-brand/20" />{t("legendTerm")}</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-success/80" />{t("legendHoliday")}</span>
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-danger" />{t("legendExam")}</span>
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-brand" />{t("legendEvent")}</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-dashed border-muted-foreground/50" />{t("legendDraft")}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="year-view">
            {months.map((m) => {
              const lead = (weekdayOf(m) + 6) % 7;
              const cells: Array<string | null> = Array.from({ length: lead }, () => null);
              for (let k = m; k.slice(0, 7) === m.slice(0, 7); k = addDays(k, 1)) cells.push(k);
              return (
                <Panel key={m} className="p-3">
                  <div className="mb-2 text-sm font-semibold">{new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}T12:00:00Z`))}</div>
                  <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
                    {wdNames.map((n, i) => (
                      <div key={i}>{n}</div>
                    ))}
                  </div>
                  <div className="mt-0.5 grid grid-cols-7 gap-0.5">
                    {cells.map((k, i) => {
                      if (!k) return <div key={i} />;
                      const evs = byDay.get(k) ?? [];
                      const holiday = evs.some((e) => e.kind === "HOLIDAY" && e.published);
                      const exam = evs.some((e) => e.kind === "EXAM");
                      const other = evs.some((e) => e.kind === "EVENT" || e.kind === "DEADLINE");
                      const draft = evs.some((e) => !e.published);
                      const weekend = !weekDays.includes(weekdayOf(k));
                      const cls = cn(
                        "relative grid aspect-square place-items-center rounded-sm text-[11px] tabular-nums",
                        holiday ? "bg-success/80 font-semibold text-white" : inTerm(k) && !weekend ? "bg-brand-soft/70" : "",
                        weekend && !holiday && "text-muted-foreground/60",
                        draft && "outline-1 outline-dashed outline-muted-foreground/60",
                        k === today && "ring-2 ring-brand",
                      );
                      const label = new Intl.DateTimeFormat(tag, { day: "numeric", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
                      const dots = (
                        <span className="absolute bottom-0.5 flex gap-0.5">
                          {exam && <span className="size-1 rounded-full bg-danger" />}
                          {other && <span className="size-1 rounded-full bg-brand" />}
                        </span>
                      );
                      return evs.length ? (
                        <Link key={k} href={`/calendar?view=day&d=${k}`} className={cn(cls, "hover:ring-1 hover:ring-brand/50")} title={evs.map((e) => pick(locale, e.titleEn, e.titleAr)).join("\n")} data-testid="year-day">
                          {label}
                          {dots}
                        </Link>
                      ) : (
                        <div key={k} className={cls}>
                          {label}
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Link href={qs({ kind: null })} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !kindFilter ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground")}>
              {t("allKinds")}
            </Link>
            {KINDS.map((k) => (
              <Link key={k} href={qs({ kind: k })} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", kindFilter === k ? "border-brand bg-brand-soft text-brand" : "bg-card text-muted-foreground")}>
                {t(`kind.${k}`)}
              </Link>
            ))}
          </div>
          {list.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-5" />} title={t("emptyList")} body={t("emptyListBody")} />
          ) : (
            <Panel padded={false} className="overflow-hidden">
              <ul className="divide-y" data-testid="event-list">
                {list.map((e) => {
                  const linkedTrip = tripById.get(e.id);
                  const linked = linkedTrip ? `/trips/${linkedTrip}` : examIds.has(e.id) ? "/admin/exams" : null;
                  const lastDay = e.allDay ? new Date(e.endsAt.getTime() - 1) : e.endsAt;
                  const multi = dayKey(e.startsAt) !== dayKey(lastDay);
                  const estimated = e.kind === "HOLIDAY" && (e.descEn ?? "").startsWith("Estimated");
                  return (
                    <li key={e.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid="event-row">
                      <div className="w-44 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtDate(prefs, e.startsAt)}
                        {multi && ` - ${fmtDate(prefs, lastDay, "short")}`}
                        {!e.allDay && <div>{fmtTime(prefs, e.startsAt)} - {fmtTime(prefs, e.endsAt)}</div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{pick(locale, e.titleEn, e.titleAr)}</span>
                          <Pill tone={KIND_TONE[e.kind]}>{t(`kind.${e.kind}`)}</Pill>
                          {estimated && <Pill tone="warning">{t("estimate")}</Pill>}
                          {!e.published && <Pill tone="neutral">{t("draft")}</Pill>}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {(e.audience.includes("all") ? ["staff", "student", "parent"] : e.audience).filter((a) => t.has(`audience.${a}`)).map((a) => t(`audience.${a}`)).join(" · ")}
                          {e.gradeLevels.length > 0 && ` · ${e.gradeLevels.map((g) => t("gradeN", { grade: g })).join(", ")}`}
                          {pick(locale, e.locationEn, e.locationAr) && ` · ${pick(locale, e.locationEn, e.locationAr)}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {e.audience.some((a) => !["all", "staff", "student", "parent"].includes(a)) ? (
                          <span className="text-xs text-muted-foreground">{t("managedElsewhere")}</span>
                        ) : linked ? (
                          <Link href={linked} className="text-xs font-medium text-brand hover:underline">
                            {linkedTrip ? t("managedInTrips") : t("managedInExams")}
                          </Link>
                        ) : (
                          <>
                            <EventPublishSwitch id={e.id} published={e.published} />
                            <EventDialog grades={GRADES} defaultDate={defaultDate} initial={draftOf(e)} />
                            <EventDeleteButton id={e.id} title={pick(locale, e.titleEn, e.titleAr)} />
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </>
      )}
    </PageBody>
  );
}
